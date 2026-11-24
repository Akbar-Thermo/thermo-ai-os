-- «От мастеров»: личная ссылка мастера — /usta/?k=<код>. Без логина и пароля: код в ссылке и есть «аккаунт» мастера.
-- По ссылке имя и телефон мастера подставляются сами, а список приходит к нам привязанным к этому мастеру.
-- Коды создаёт программа (Мастера → карточка мастера → «Личная ссылка»); таблица закрыта, как остальные.
create table if not exists public.usta_keys (
  master_id  uuid primary key references public.masters(id) on delete cascade,
  key        text not null unique check (length(key) >= 12),
  created_at timestamptz not null default now()
);
alter table public.usta_keys enable row level security;
drop policy if exists te_session_only on public.usta_keys;
create policy te_session_only on public.usta_keys for all to anon, authenticated
  using ((select public.te_require_session())) with check ((select public.te_require_session()));

-- страница мастера по коду узнаёт, чья это ссылка (только имя и телефон)
create or replace function public.usta_me(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_key is null or length(btrim(p_key)) < 12 then raise exception 'usta_key'; end if;
  select m.name, m.phone into r from public.usta_keys k join public.masters m on m.id = k.master_id
   where k.key = btrim(p_key) and coalesce(m.status, 'active') <> 'inactive';
  if not found then raise exception 'usta_key'; end if;
  return jsonb_build_object('name', r.name, 'phone', coalesce(r.phone, ''));
end $$;
revoke all on function public.usta_me(text) from public;
grant execute on function public.usta_me(text) to anon, authenticated;

-- приём списка: по личной ссылке (key) — мастер известен точно; без ссылки — как раньше (имя + телефон)
create or replace function public.usta_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key   text := btrim(coalesce(p->>'key', ''));
  v_name  text := left(btrim(coalesce(p->>'name', '')), 80);
  v_phone text := left(btrim(coalesce(p->>'phone', '')), 30);
  v_obj   text := left(btrim(coalesce(p->>'object', '')), 200);
  v_note  text := left(btrim(coalesce(p->>'note', '')), 1000);
  v_lines jsonb := p->'lines';
  v_dig   text; v_mid uuid; v_id uuid; v_num bigint; e jsonb; clean jsonb := '[]'::jsonb; q text; r record;
begin
  if v_key <> '' then
    select m.id, m.name, m.phone into r from public.usta_keys k join public.masters m on m.id = k.master_id
     where k.key = v_key and coalesce(m.status, 'active') <> 'inactive';
    if not found then raise exception 'usta_key'; end if;
    v_mid := r.id; v_name := left(r.name, 80); v_phone := left(coalesce(nullif(r.phone, ''), '—'), 30);
    if (select count(*) from public.usta_lists where master_id = v_mid and created_at > now() - interval '1 hour') >= 30 then raise exception 'usta_rate'; end if;
  else
    if length(v_name) < 2 then raise exception 'usta_name'; end if;
    v_dig := regexp_replace(v_phone, '\D', '', 'g');
    if length(v_dig) < 9 or length(v_dig) > 12 then raise exception 'usta_phone'; end if;
    if (select count(*) from public.usta_lists where right(regexp_replace(usta_phone, '\D', '', 'g'), 9) = right(v_dig, 9) and created_at > now() - interval '1 hour') >= 15 then
      raise exception 'usta_rate';
    end if;
    select id into v_mid from public.masters
     where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 9
       and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_dig, 9)
     limit 1;
  end if;
  if (select count(*) from public.usta_lists where created_at > now() - interval '1 hour') >= 300 then raise exception 'usta_rate'; end if;
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 300 then raise exception 'usta_lines'; end if;
  for e in select * from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(e) <> 'object' or btrim(coalesce(e->>'name', '')) = '' then continue; end if;
    q := e->>'qty';
    clean := clean || jsonb_build_array(jsonb_build_object(
      'name', left(btrim(e->>'name'), 200),
      'vars', left(coalesce(e->>'vars', ''), 120),
      'size', left(coalesce(e->>'size', ''), 60),
      'qty', case when q ~ '^\d{1,7}(\.\d{1,3})?$' then q::numeric else null end,
      'unit', left(coalesce(e->>'unit', ''), 10),
      'raw', left(coalesce(e->>'raw', ''), 200),
      'known', coalesce(e->>'known', '') = 'true',
      'cat', left(coalesce(e->>'cat', ''), 20),
      'pid', case when coalesce(e->>'pid', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e->>'pid' else null end));
  end loop;
  if jsonb_array_length(clean) = 0 then raise exception 'usta_lines'; end if;
  insert into public.usta_lists(usta_name, usta_phone, object_text, note, lines, master_id)
  values (v_name, v_phone, nullif(v_obj, ''), nullif(v_note, ''), clean, v_mid)
  returning id, num into v_id, v_num;
  return jsonb_build_object('num', v_num);
end $$;
revoke all on function public.usta_submit(jsonb) from public;
grant execute on function public.usta_submit(jsonb) to anon, authenticated;
