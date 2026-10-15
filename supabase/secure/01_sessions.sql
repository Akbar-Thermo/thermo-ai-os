-- ============================================================
-- THERMO — защита базы: вход через сервер, без входа данные не читаются и не меняются
--
-- Раньше: пароль проверялся в браузере, а ключ базы (anon) открыт в коде сайта — любой, кто знает ключ,
-- мог читать и менять все таблицы и видеть хэши паролей.
-- Теперь:
--   · вход — функция te_login на сервере; она выдаёт сессию (случайный токен на 30 дней, продлевается при работе);
--   · каждый запрос сайта несёт токен в заголовке x-te-session; правило (RLS) на всех таблицах пропускает
--     только запросы с живой сессией активного пользователя, иначе — ошибка te_session_required;
--   · хэши паролей перенесены в закрытую таблицу te_user_secrets (колонка users.pass_hash всегда пустая);
--   · аккаунты (кроме «сотрудников» staff) может менять только руководитель;
--   · 10 неверных паролей подряд — вход для этого логина закрыт на 15 минут.
-- Прямое подключение к базе (SQL Editor, бэкапы Supabase, эта миграция) не ограничивается.
-- Откат — rollback.sql (возвращает всё как было, включая прежние правила доступа).
-- ============================================================
begin;
set local client_min_messages = warning;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- служебные таблицы (закрыты для сайта полностью) ----------
create table if not exists public.te_sessions (
  token      text primary key,
  user_id    uuid not null,
  role       text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists te_sessions_user_idx on public.te_sessions (user_id);
create table if not exists public.te_user_secrets (
  user_id    uuid primary key,
  pass_hash  text,
  seed       text,
  updated_at timestamptz not null default now()
);
create table if not exists public.te_login_fails (
  id       bigserial primary key,
  username text not null,
  at       timestamptz not null default now()
);
create index if not exists te_login_fails_idx on public.te_login_fails (username, at);
-- прежние правила доступа — чтобы откат вернул ровно то, что было
create table if not exists public.te_policy_backup (
  tablename text, policyname text, permissive text, roles text[], cmd text, qual text, with_check text,
  saved_at timestamptz default now()
);
create table if not exists public.te_rls_backup (tablename text primary key, rls_enabled boolean, saved_at timestamptz default now());

alter table public.te_sessions      enable row level security;
alter table public.te_user_secrets  enable row level security;
alter table public.te_login_fails   enable row level security;
alter table public.te_policy_backup enable row level security;
alter table public.te_rls_backup    enable row level security;
revoke all on public.te_sessions, public.te_user_secrets, public.te_login_fails, public.te_policy_backup, public.te_rls_backup from public, anon, authenticated;
revoke all on sequence public.te_login_fails_id_seq from public, anon, authenticated;

-- ---------- пароли: из users → в закрытую таблицу ----------
do $$
declare has_seed boolean;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'need_seed_pass') into has_seed;
  if has_seed then
    execute $q$
      insert into public.te_user_secrets (user_id, pass_hash, seed)
      select id, pass_hash, need_seed_pass from public.users where pass_hash is not null or need_seed_pass is not null
      on conflict (user_id) do update set pass_hash = coalesce(excluded.pass_hash, te_user_secrets.pass_hash), seed = excluded.seed, updated_at = now()
    $q$;
    execute 'update public.users set pass_hash = null, need_seed_pass = null where pass_hash is not null or need_seed_pass is not null';
  else
    execute $q$
      insert into public.te_user_secrets (user_id, pass_hash)
      select id, pass_hash from public.users where pass_hash is not null
      on conflict (user_id) do update set pass_hash = excluded.pass_hash, updated_at = now()
    $q$;
    execute 'update public.users set pass_hash = null where pass_hash is not null';
  end if;
end $$;

-- ---------- сессия из заголовка запроса ----------
create or replace function public.te_via_api() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('request.headers', true), '') <> ''
      or coalesce(current_setting('request.jwt.claims', true), '') <> ''
      or coalesce(current_setting('request.method', true), '') <> ''
$$;
create or replace function public.te_hdr_token() returns text
language sql stable set search_path = public as $$
  select coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-te-session', ''),
    nullif(current_setting('request.header.x-te-session', true), '')
  )
$$;
-- сессия жива: токен не истёк, пользователь активен (если строки пользователя нет — например, идёт восстановление из бэкапа — сессия ещё действует)
create or replace function public.te_session_user() returns uuid
language sql stable security definer set search_path = public as $$
  select s.user_id from public.te_sessions s
  where s.token = public.te_hdr_token() and s.expires_at > now()
    and not exists (select 1 from public.users u where u.id = s.user_id and (u.status is distinct from 'active' or u.role = 'staff'))
  limit 1
$$;
create or replace function public.te_session_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select u.role from public.users u where u.id = s.user_id), s.role) from public.te_sessions s
  where s.token = public.te_hdr_token() and s.expires_at > now()
    and not exists (select 1 from public.users u where u.id = s.user_id and (u.status is distinct from 'active' or u.role = 'staff'))
  limit 1
$$;
-- правило для всех таблиц: через сайт — только с живой сессией (иначе понятная ошибка, а не «пустая база»)
create or replace function public.te_require_session() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.te_via_api() then return true; end if;
  if public.te_session_user() is null then
    raise exception 'te_session_required' using errcode = '42501', hint = 'Войдите в систему заново';
  end if;
  return true;
end $$;

-- ---------- вход / кто я / выход ----------
create or replace function public.te_login(p_username text, p_hash text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  uname text := lower(trim(coalesce(p_username, '')));
  u public.users%rowtype;
  s public.te_user_secrets%rowtype;
  ok boolean := false;
  tok text;
begin
  delete from public.te_sessions where expires_at < now();
  delete from public.te_login_fails where at < now() - interval '1 day';
  if uname = '' or coalesce(p_hash, '') = '' then return jsonb_build_object('error', 'bad'); end if;
  if (select count(*) from public.te_login_fails where username = uname and at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('error', 'locked');
  end if;
  select * into u from public.users where lower(trim(username)) = uname and role is distinct from 'staff' order by created_at limit 1;
  if u.id is not null then
    select * into s from public.te_user_secrets where user_id = u.id;
    if s.user_id is not null then
      if s.pass_hash is not null then ok := s.pass_hash = p_hash;
      elsif s.seed is not null then ok := encode(digest('thermo:' || s.seed, 'sha256'), 'hex') = p_hash;
      end if;
    end if;
  end if;
  if not ok then
    insert into public.te_login_fails (username) values (uname);
    return jsonb_build_object('error', 'bad');
  end if;
  if u.status is distinct from 'active' then return jsonb_build_object('error', 'disabled'); end if;
  if s.pass_hash is null then update public.te_user_secrets set pass_hash = p_hash, seed = null, updated_at = now() where user_id = u.id; end if;
  tok := encode(gen_random_bytes(32), 'hex');
  insert into public.te_sessions (token, user_id, role, expires_at) values (tok, u.id, u.role, now() + interval '30 days');
  delete from public.te_login_fails where username = uname;
  return jsonb_build_object('token', tok, 'user', to_jsonb(u) - 'pass_hash' - 'need_seed_pass');
end $$;

create or replace function public.te_me() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public.te_session_user(); u public.users%rowtype;
begin
  if uid is null then return null; end if;
  update public.te_sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '30 days')
    where token = public.te_hdr_token() and last_seen < now() - interval '1 hour';
  select * into u from public.users where id = uid;
  if u.id is null then return null; end if;
  return to_jsonb(u) - 'pass_hash' - 'need_seed_pass';
end $$;

create or replace function public.te_logout() returns boolean
language sql volatile security definer set search_path = public as $$
  delete from public.te_sessions where token = public.te_hdr_token() returning true
$$;

-- сайт узнаёт, включена ли защита (и есть ли ещё не заданный первый пароль)
create or replace function public.te_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('secure', true, 'v', 1,
    'seed', exists (select 1 from public.te_user_secrets where pass_hash is null and seed is not null))
$$;

-- хэши паролей — только руководителю, для полного бэкапа (восстановление вернёт их обратно)
create or replace function public.te_user_hashes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.te_session_role() is distinct from 'boss' then raise exception 'te_forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(user_id::text, jsonb_build_object('pass_hash', pass_hash, 'need_seed_pass', seed)) from public.te_user_secrets), '{}'::jsonb);
end $$;

-- ---------- аккаунты: пароль сразу в закрытую таблицу; менять аккаунты — только руководитель ----------
create or replace function public.te_users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if public.te_via_api() then
    r := public.te_session_role();
    if r is distinct from 'boss' then
      -- менеджер может только добавлять / переименовывать / убирать «сотрудников» (staff) в финансах
      if tg_op = 'DELETE' then
        if old.role is distinct from 'staff' then raise exception 'te_forbidden: аккаунты меняет только руководитель' using errcode = '42501'; end if;
      elsif new.role is distinct from 'staff' or (tg_op = 'UPDATE' and old.role is distinct from 'staff') then
        raise exception 'te_forbidden: аккаунты меняет только руководитель' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.pass_hash is not null or (to_jsonb(new) ->> 'need_seed_pass') is not null then
    insert into public.te_user_secrets (user_id, pass_hash, seed)
    values (new.id, new.pass_hash, case when new.pass_hash is null then to_jsonb(new) ->> 'need_seed_pass' end)
    on conflict (user_id) do update
      set pass_hash = coalesce(excluded.pass_hash, te_user_secrets.pass_hash),
          seed = case when excluded.pass_hash is not null then null else coalesce(excluded.seed, te_user_secrets.seed) end,
          updated_at = now();
    new.pass_hash := null;
    if to_jsonb(new) ? 'need_seed_pass' then new := jsonb_populate_record(new, '{"need_seed_pass": null}'::jsonb); end if;
  end if;
  return new;
end $$;
drop trigger if exists te_users_guard on public.users;
create trigger te_users_guard before insert or update or delete on public.users for each row execute function public.te_users_guard();

-- удалили аккаунт — его сессии закрываются (кроме своей: при восстановлении из бэкапа руководитель не выбрасывается)
create or replace function public.te_users_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.te_sessions where user_id = old.id and token is distinct from public.te_hdr_token();
  return old;
end $$;
drop trigger if exists te_users_gone on public.users;
create trigger te_users_gone after delete on public.users for each row execute function public.te_users_gone();

-- ---------- правила доступа на всех таблицах сайта ----------
do $$
declare t text; p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not like 'te\_%' loop
    insert into public.te_rls_backup (tablename, rls_enabled)
      select t, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t
      on conflict (tablename) do nothing;
    for p in select * from pg_policies where schemaname = 'public' and tablename = t and policyname <> 'te_session_only' loop
      insert into public.te_policy_backup (tablename, policyname, permissive, roles, cmd, qual, with_check)
        values (t, p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check);
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists te_session_only on public.%I', t);
    execute format('create policy te_session_only on public.%I for all to anon, authenticated using ((select public.te_require_session())) with check ((select public.te_require_session()))', t);
  end loop;
end $$;

-- ---------- права на функции: сайту — только вход / кто я / выход / статус / хэши для бэкапа ----------
revoke all on function public.te_via_api(), public.te_hdr_token(), public.te_session_user(), public.te_session_role(),
  public.te_users_guard(), public.te_users_gone() from public, anon, authenticated;
revoke all on function public.te_login(text, text), public.te_me(), public.te_logout(), public.te_status(), public.te_user_hashes(), public.te_require_session() from public;
grant execute on function public.te_login(text, text), public.te_me(), public.te_logout(), public.te_status(), public.te_user_hashes(), public.te_require_session() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
