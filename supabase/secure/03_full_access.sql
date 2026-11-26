-- «Как руководитель» (Аккаунты → ред. → галочка, te_perms.lines.<id>.perms.boss = true):
-- аккаунт с любой ролью (например, «Менеджер») в базе считается руководителем.
-- Дать или снять галочку может только руководитель (или аккаунт, у которого она уже есть).
-- Аккаунты с этой галочкой защищены как руководители: обычное право «Аккаунты» их не меняет.

create or replace function public.te_user_full(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.role = 'boss' or (u.role is distinct from 'staff' and coalesce((
      select (x.lines -> (u.id::text) -> 'perms' ->> 'boss') = 'true'
      from public.requests x where x.mode = 'te_perms' and jsonb_typeof(x.lines) = 'object' limit 1), false))
    from public.users u where u.id = p_id), false)
$$;

-- роль вошедшего: «как руководитель» → 'boss' (все проверки базы считают его руководителем)
create or replace function public.te_session_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.te_user_full(s.user_id) then 'boss'
              else coalesce((select u.role from public.users u where u.id = s.user_id), s.role) end
  from public.te_sessions s
  where s.token = public.te_hdr_token() and s.expires_at > now()
    and not exists (select 1 from public.users u where u.id = s.user_id and (u.status is distinct from 'active' or u.role = 'staff'))
  limit 1
$$;

create or replace function public.te_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text; uid text; acc boolean; bot boolean; m text; o jsonb; n jsonb; k text; boss_ids text[];
begin
  if not public.te_via_api() then return case when tg_op = 'DELETE' then old else new end; end if;
  r := public.te_session_role();
  if r = 'boss' then return case when tg_op = 'DELETE' then old else new end; end if;
  uid := public.te_session_user()::text;
  acc := public.te_session_accounts();
  bot := public.te_session_tgbot();
  m := case when tg_op = 'DELETE' then old.mode else new.mode end;
  if tg_op = 'UPDATE' and old.mode is distinct from new.mode then
    raise exception 'te_forbidden: нельзя менять вид записи' using errcode = '42501';
  end if;

  -- группы Telegram-бота (где он вносит расходы и показывает кассу) разрешает руководитель или право «Аккаунты»
  -- бот поставщиков: какие группы чьи и группа расходов — руководитель / «Аккаунты»; его служебные записи — бот
  if m = 'te_zk' and not acc then
    raise exception 'te_forbidden: группы бота поставщиков настраивает только руководитель' using errcode = '42501';
  end if;
  if m in ('te_zkpend', 'te_zkst', 'te_zkord', 'te_zkinv', 'te_zktask') and not (acc or bot) then
    raise exception 'te_forbidden: эту запись меняет только Telegram-бот' using errcode = '42501';
  end if;
  if m = 'te_tg' and not acc then
    raise exception 'te_forbidden: группы Telegram-бота разрешает только руководитель' using errcode = '42501';
  end if;

  -- ссылки «Telegram ulash»: создаёт руководитель / право «Аккаунты»; бот удаляет использованную
  if m = 'te_tglink' then
    if tg_op = 'DELETE' and (acc or bot) then return old; end if;
    if not acc then raise exception 'te_forbidden: ссылки Telegram создаёт только руководитель' using errcode = '42501'; end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- кто чей в Telegram: бот (подключение по ссылке) или руководитель / право «Аккаунты» (отключить)
  if m = 'te_tgusers' and not (acc or bot) then
    raise exception 'te_forbidden: подключения Telegram меняет только руководитель' using errcode = '42501';
  end if;
  -- напоминания «/eslat», курс бота «/kurs», память диалога с ИИ, расход ИИ и действия, ждущие «✅», пишет только бот
  -- (руководитель / право «Аккаунты» — тоже)
  if m in ('te_tgremind', 'te_rate', 'te_tgmem', 'te_tgai', 'te_tgact', 'te_tgq', 'te_tgmatch', 'te_tgrules') and not (acc or bot) then
    raise exception 'te_forbidden: эту запись меняет только Telegram-бот' using errcode = '42501';
  end if;

  -- чат сотрудников: сообщение — всегда от имени вошедшего; изменить нельзя; удалить — только своё
  if m = 'te_chat' then
    if tg_op = 'INSERT' then
      new.lines := coalesce(new.lines, '{}'::jsonb) || jsonb_build_object('from', uid, 'author', coalesce(public.te_session_name(), ''));
      return new;
    end if;
    if coalesce(old.lines ->> 'from', '') <> uid then
      raise exception 'te_forbidden: чужое сообщение удаляет только руководитель' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'te_forbidden: сообщение нельзя изменить' using errcode = '42501';
  end if;
  -- «в сети» и «прочитано»: у каждого своя запись — менять только свою
  if m = 'te_seen' then
    if tg_op <> 'INSERT' and coalesce(old.lines ->> 'user_id', '') <> uid then
      raise exception 'te_forbidden: чужую отметку «в сети» менять нельзя' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    new.lines := coalesce(new.lines, '{}'::jsonb) || jsonb_build_object('user_id', uid);
    return new;
  end if;

  if m = 'te_note' then
    -- бот: заметки подключённых людей (из личного чата с ботом) — от их имени
    if bot then
      if tg_op = 'INSERT' and public.te_tg_linked(new.lines ->> 'user_id') then return new; end if;
      if tg_op = 'UPDATE' and public.te_tg_linked(old.lines ->> 'user_id') and (new.lines ->> 'user_id') is not distinct from (old.lines ->> 'user_id') then return new; end if;
      if tg_op = 'DELETE' and public.te_tg_linked(old.lines ->> 'user_id') then return old; end if;
    end if;
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
    -- руководители и аккаунты «как руководитель» (галочка в старой записи — до изменения)
    select coalesce(array_agg(u.id::text), '{}') into boss_ids from public.users u
      where u.role = 'boss' or (u.role is distinct from 'staff' and (o -> (u.id::text) -> 'perms' ->> 'boss') = 'true');
    for k in select key from (select key from jsonb_each(o) union select key from jsonb_each(n)) z loop
      if (o -> k) is distinct from (n -> k) then
        if m = 'te_perms' then
          if not acc then raise exception 'te_forbidden: права меняет только руководитель' using errcode = '42501'; end if;
          if k = uid then raise exception 'te_forbidden: свои права менять нельзя' using errcode = '42501'; end if;
          if k = any(boss_ids) then raise exception 'te_forbidden: права руководителя меняет только он' using errcode = '42501'; end if;
          if coalesce(n -> k -> 'perms' ->> 'boss', 'false') <> coalesce(o -> k -> 'perms' ->> 'boss', 'false') then
            raise exception 'te_forbidden: право «как руководитель» даёт только руководитель' using errcode = '42501';
          end if;
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

-- аккаунты: право «Аккаунты» не трогает руководителей и аккаунты «как руководитель»
create or replace function public.te_users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text; acc boolean;
begin
  if public.te_via_api() then
    r := public.te_session_role();
    -- право «Аккаунты» (Аккаунты → ред. → галочка): создавать и менять аккаунты, кроме руководителей
    acc := r is distinct from 'boss' and coalesce((
      select case when jsonb_typeof(x.lines) = 'object' then (x.lines -> (public.te_session_user()::text) -> 'perms' ->> 'accounts') = 'true' else false end
      from public.requests x where x.mode = 'te_perms' limit 1), false);
    if acc then
      if (tg_op <> 'INSERT' and (old.role = 'boss' or public.te_user_full(old.id))) or (tg_op <> 'DELETE' and new.role = 'boss') then
        raise exception 'te_forbidden: аккаунты руководителей меняет только руководитель' using errcode = '42501';
      end if;
    elsif r is distinct from 'boss' then
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
