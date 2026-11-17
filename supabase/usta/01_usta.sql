-- «От мастеров»: списки материалов, которые мастера присылают со страницы /usta (без входа в программу).
-- Таблица закрыта так же, как остальные (только с сессией сотрудника). Мастер пишет только через функцию usta_submit.
create table if not exists public.usta_lists (
  id          uuid primary key default gen_random_uuid(),
  num         bigint generated always as identity,
  created_at  timestamptz not null default now(),
  usta_name   text not null,
  usta_phone  text not null,
  object_text text,
  note        text,
  lines       jsonb not null default '[]'::jsonb, -- [{ name, vars, size, qty, unit, raw, known, cat }]
  status      text not null default 'new',        -- new | done
  master_id   uuid references public.masters(id) on delete set null,
  handled_by  text,
  handled_at  timestamptz
);
create index if not exists idx_usta_lists_created on public.usta_lists(created_at desc);
alter table public.usta_lists enable row level security;
drop policy if exists te_session_only on public.usta_lists;
create policy te_session_only on public.usta_lists for all to anon, authenticated
  using ((select public.te_require_session())) with check ((select public.te_require_session()));

-- приём списка от мастера: проверки, ограничение частоты, мастер по номеру телефона
create or replace function public.usta_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name  text := left(btrim(coalesce(p->>'name', '')), 80);
  v_phone text := left(btrim(coalesce(p->>'phone', '')), 30);
  v_obj   text := left(btrim(coalesce(p->>'object', '')), 200);
  v_note  text := left(btrim(coalesce(p->>'note', '')), 1000);
  v_lines jsonb := p->'lines';
  v_dig   text; v_mid uuid; v_id uuid; v_num bigint; e jsonb; clean jsonb := '[]'::jsonb; q text;
begin
  if length(v_name) < 2 then raise exception 'usta_name'; end if;
  v_dig := regexp_replace(v_phone, '\D', '', 'g');
  if length(v_dig) < 9 or length(v_dig) > 12 then raise exception 'usta_phone'; end if;
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 300 then raise exception 'usta_lines'; end if;
  if (select count(*) from public.usta_lists where right(regexp_replace(usta_phone, '\D', '', 'g'), 9) = right(v_dig, 9) and created_at > now() - interval '1 hour') >= 15
     or (select count(*) from public.usta_lists where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'usta_rate';
  end if;
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
      'cat', left(coalesce(e->>'cat', ''), 20)));
  end loop;
  if jsonb_array_length(clean) = 0 then raise exception 'usta_lines'; end if;
  select id into v_mid from public.masters
   where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 9
     and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_dig, 9)
   limit 1;
  insert into public.usta_lists(usta_name, usta_phone, object_text, note, lines, master_id)
  values (v_name, v_phone, nullif(v_obj, ''), nullif(v_note, ''), clean, v_mid)
  returning id, num into v_id, v_num;
  return jsonb_build_object('num', v_num);
end $$;
revoke all on function public.usta_submit(jsonb) from public;
grant execute on function public.usta_submit(jsonb) to anon, authenticated;
