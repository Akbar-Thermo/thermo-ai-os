-- ============================================================
-- THERMO — откат защиты базы: всё как было до 01_sessions.sql
-- (пароли возвращаются в users, прежние правила доступа восстанавливаются, служебные таблицы удаляются)
-- ============================================================
begin;
set local client_min_messages = warning;

drop trigger if exists te_users_guard on public.users;
drop trigger if exists te_users_gone on public.users;

do $$
declare has_seed boolean;
begin
  if to_regclass('public.te_user_secrets') is null then return; end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'need_seed_pass') into has_seed;
  if has_seed then
    execute 'update public.users u set pass_hash = s.pass_hash, need_seed_pass = case when s.pass_hash is null then s.seed end from public.te_user_secrets s where s.user_id = u.id';
  else
    execute 'update public.users u set pass_hash = s.pass_hash from public.te_user_secrets s where s.user_id = u.id';
  end if;
end $$;

do $$
declare t text; p record; restored int;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not like 'te\_%' loop
    execute format('drop policy if exists te_session_only on public.%I', t);
    restored := 0;
    if to_regclass('public.te_policy_backup') is not null then
      for p in select * from public.te_policy_backup where tablename = t loop
        execute format('drop policy if exists %I on public.%I', p.policyname, t);
        execute format('create policy %I on public.%I as %s for %s to %s%s%s',
          p.policyname, t, p.permissive, p.cmd,
          (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(p.roles) r),
          case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
          case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end);
        restored := restored + 1;
      end loop;
    end if;
    if to_regclass('public.te_rls_backup') is not null and exists (select 1 from public.te_rls_backup b where b.tablename = t and not b.rls_enabled) then
      execute format('alter table public.%I disable row level security', t);
    elsif restored = 0 then
      -- правил не было (или таблица появилась позже) — открываем, как работало до защиты
      execute format('drop policy if exists te_open on public.%I', t);
      execute format('create policy te_open on public.%I for all to anon, authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

drop function if exists public.te_login(text, text);
drop function if exists public.te_me();
drop function if exists public.te_logout();
drop function if exists public.te_status();
drop function if exists public.te_user_hashes();
drop function if exists public.te_users_guard();
drop function if exists public.te_users_gone();
drop function if exists public.te_require_session();
drop function if exists public.te_session_role();
drop function if exists public.te_session_user();
drop function if exists public.te_hdr_token();
drop function if exists public.te_via_api();
drop table if exists public.te_sessions;
drop table if exists public.te_login_fails;
drop table if exists public.te_user_secrets;
drop table if exists public.te_policy_backup;
drop table if exists public.te_rls_backup;

notify pgrst, 'reload schema';
commit;
