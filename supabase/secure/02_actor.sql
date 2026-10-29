-- ============================================================
-- THERMO — «никто не может действовать от имени другого» (ставится после 01_sessions.sql)
--
-- Через сайт (с токеном входа) база теперь сама следит:
--   · «Кто» в операциях (finance_ops), движениях склада (wh_moves) и в журнале (audit_log) — всегда тот,
--     кто вошёл: при записи имя подставляет база, при изменении записи его нельзя поменять;
--   · журнал действий (audit_log) — только дописывать: изменить или удалить запись нельзя;
--   · заметки: новая заметка — всегда от имени вошедшего; менять / удалять — только свою;
--   · права и роли (te_perms, te_roles) меняет руководитель или тот, у кого есть право «Аккаунты»
--     (себе права он менять не может);
--   · облачный пароль (te_2fa) — каждый только свой; чужие сбрасывает руководитель или право «Аккаунты»
--     (облачный пароль руководителя — только он сам);
--   · служебные записи (права, роли, облачные пароли) удаляет только руководитель;
--   · группы Telegram-бота (te_tg) разрешает руководитель или право «Аккаунты»;
--   · доставщик (если ему не открыты другие разделы, кроме «Доставка» и «Склад Thermo»): меняет только
--     отметки отгрузки в объектах, пишет в журнал и свои заметки — остальное в базе ему недоступно.
-- Руководитель не ограничивается: ему нужно восстанавливать базу из бэкапа (там имена из прошлых записей).
-- Прямое подключение к базе (SQL Editor, ночной бэкап) не ограничивается.
-- Откат — rollback.sql (снимает и эти правила).
-- ============================================================
begin;
set local client_min_messages = warning;

-- имя вошедшего — как его пишет сайт (name, а если пусто — логин)
create or replace function public.te_session_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(u.name), ''), u.username) from public.users u where u.id = public.te_session_user()
$$;
-- у вошедшего есть право «Аккаунты» (Аккаунты → ред. → галочка)
create or replace function public.te_session_accounts() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (x.lines -> (public.te_session_user()::text) -> 'perms' ->> 'accounts') = 'true'
    from public.requests x where x.mode = 'te_perms' and jsonb_typeof(x.lines) = 'object' limit 1), false)
$$;

-- «кто» в записи: при вставке — вошедший, при изменении — прежнее значение
create or replace function public.te_actor_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; r text; j jsonb := '{}'::jsonb; c text;
begin
  if not public.te_via_api() then return case when tg_op = 'DELETE' then old else new end; end if;
  r := public.te_session_role();
  if r = 'boss' then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_table_name = 'audit_log' and tg_op <> 'INSERT' then
    raise exception 'te_forbidden: журнал действий нельзя менять или удалять' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  nm := coalesce(public.te_session_name(), '—');
  foreach c in array array['user', 'user_name'] loop
    if to_jsonb(new) ? c then
      j := j || jsonb_build_object(c, case when tg_op = 'INSERT' then to_jsonb(nm) else to_jsonb(old) -> c end);
    end if;
  end loop;
  if tg_table_name = 'audit_log' and to_jsonb(new) ? 'role' then j := j || jsonb_build_object('role', r); end if;
  if j = '{}'::jsonb then return new; end if;
  return jsonb_populate_record(new, j);
end $$;

-- служебные записи и заметки в requests
create or replace function public.te_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text; uid text; acc boolean; m text; o jsonb; n jsonb; k text; boss_ids text[];
begin
  if not public.te_via_api() then return case when tg_op = 'DELETE' then old else new end; end if;
  r := public.te_session_role();
  if r = 'boss' then return case when tg_op = 'DELETE' then old else new end; end if;
  uid := public.te_session_user()::text;
  acc := public.te_session_accounts();
  m := case when tg_op = 'DELETE' then old.mode else new.mode end;
  if tg_op = 'UPDATE' and old.mode is distinct from new.mode then
    raise exception 'te_forbidden: нельзя менять вид записи' using errcode = '42501';
  end if;

  -- группы Telegram-бота (где он вносит расходы и показывает кассу) разрешает руководитель или право «Аккаунты»
  if m = 'te_tg' and not acc then
    raise exception 'te_forbidden: группы Telegram-бота разрешает только руководитель' using errcode = '42501';
  end if;

  if m = 'te_note' then
    if tg_op = 'INSERT' then
      new.lines := coalesce(new.lines, '{}'::jsonb) || jsonb_build_object('user_id', uid, 'author', coalesce(public.te_session_name(), ''));
      return new;
    end if;
    if coalesce(old.lines ->> 'user_id', '') <> uid then
      raise exception 'te_forbidden: чужую заметку меняет или удаляет только руководитель' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    new.lines := coalesce(new.lines, '{}'::jsonb) || jsonb_build_object('user_id', uid);
    return new;
  end if;

  if m in ('te_perms', 'te_roles', 'te_2fa') then
    if tg_op = 'DELETE' then
      raise exception 'te_forbidden: служебные записи удаляет только руководитель' using errcode = '42501';
    end if;
    o := case when tg_op = 'UPDATE' and jsonb_typeof(old.lines) = 'object' then old.lines else '{}'::jsonb end;
    n := case when jsonb_typeof(new.lines) = 'object' then new.lines else '{}'::jsonb end;
    if m = 'te_roles' then
      if not acc then raise exception 'te_forbidden: роли меняет только руководитель' using errcode = '42501'; end if;
      return new;
    end if;
    select coalesce(array_agg(id::text), '{}') into boss_ids from public.users where role = 'boss';
    for k in select key from (select key from jsonb_each(o) union select key from jsonb_each(n)) z loop
      if (o -> k) is distinct from (n -> k) then
        if m = 'te_perms' then
          if not acc then raise exception 'te_forbidden: права меняет только руководитель' using errcode = '42501'; end if;
          if k = uid then raise exception 'te_forbidden: свои права менять нельзя' using errcode = '42501'; end if;
          if k = any(boss_ids) then raise exception 'te_forbidden: права руководителя меняет только он' using errcode = '42501'; end if;
        else -- te_2fa
          if k <> uid and (not acc or k = any(boss_ids)) then
            raise exception 'te_forbidden: чужой облачный пароль сбрасывает только руководитель' using errcode = '42501';
          end if;
        end if;
      end if;
    end loop;
    return new;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;


-- доставщик: только «Доставка» и «Склад Thermo» (без цен)? — как в программе (accessOf): свои разделы аккаунта, иначе разделы роли
create or replace function public.te_session_driver_only() returns boolean
language sql stable security definer set search_path = public as $$
  with u as (select id, role from public.users where id = public.te_session_user()),
  cfg as (select lines from public.requests where mode = 'te_roles' and jsonb_typeof(lines) = 'array' limit 1),
  base as (
    select case
      when (select role from u) in ('boss', 'manager', 'driver') then (select role from u)
      else coalesce((select case when e ->> 'base' = 'driver' then 'driver' else 'manager' end
                     from cfg, jsonb_array_elements(cfg.lines) e where e ->> 'id' = (select role from u) limit 1), 'manager')
    end as b),
  own as (select x.lines -> ((select id from u)::text) -> 'tabs' as t from public.requests x
          where x.mode = 'te_perms' and jsonb_typeof(x.lines) = 'object' limit 1),
  rt as (select e -> 'tabs' as t from cfg, jsonb_array_elements(cfg.lines) e where e ->> 'id' = (select role from u) limit 1),
  tabs as (
    select case
      when jsonb_typeof((select t from own)) = 'array' and jsonb_array_length((select t from own)) > 0 then (select t from own)
      when jsonb_typeof((select t from rt)) = 'array' then (select t from rt)
      else '["delivery", "wh"]'::jsonb
    end as t)
  select coalesce((select b from base) = 'driver', false)
    and not exists (select 1 from tabs, jsonb_array_elements_text(tabs.t) z where z not in ('delivery', 'wh'))
$$;
create or replace function public.te_driver_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.te_via_api() and public.te_session_driver_only()
     and not ((tg_table_name = 'objects' and tg_op = 'UPDATE') or (tg_table_name = 'audit_log' and tg_op = 'INSERT') or tg_table_name = 'requests') then
    raise exception 'te_forbidden: доставщику это действие недоступно' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- триггеры (только на те таблицы, что есть в базе)
do $$
declare t text;
begin
  foreach t in array array['finance_ops', 'wh_moves', 'audit_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists te_actor_guard on public.%I', t);
      execute format('create trigger te_actor_guard before insert or update or delete on public.%I for each row execute function public.te_actor_guard()', t);
    end if;
  end loop;
  if to_regclass('public.requests') is not null then
    drop trigger if exists te_requests_guard on public.requests;
    create trigger te_requests_guard before insert or update or delete on public.requests for each row execute function public.te_requests_guard();
  end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not like 'te\_%' loop
    execute format('drop trigger if exists te_driver_guard on public.%I', t);
    execute format('create trigger te_driver_guard before insert or update or delete on public.%I for each row execute function public.te_driver_guard()', t);
  end loop;
end $$;

revoke all on function public.te_session_name(), public.te_session_accounts(), public.te_actor_guard(), public.te_requests_guard(),
  public.te_session_driver_only(), public.te_driver_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
