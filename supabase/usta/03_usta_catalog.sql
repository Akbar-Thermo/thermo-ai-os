-- Usta sahifasi (kompyuter): tovar qidiruvi — programmadagi «Товары» bazasidan, lekin NARXSIZ.
-- Qator: [id, nomi, birlik, brend, o'lcham, qidiruv uchun qo'shimcha matn, kod].
-- Faqat shaxsiy havolasi (usta_keys) bor ustaga: nomi, birligi, brendi, o'lchami, kod/qo'shimcha nomlar (qidiruv uchun).
-- Narx, tannarx, postavshik, qoldiq — berilmaydi. Bir xil nom+birlik (turli postavshiklarda) — bitta qator.
create or replace function public.usta_catalog(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.usta_keys k join public.masters m on m.id = k.master_id
                  where k.key = btrim(coalesce(p_key, '')) and coalesce(m.status, 'active') <> 'inactive') then
    raise exception 'usta_key';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_array(x.id, x.name, x.unit, x.brand, x.size, x.s, x.code) order by x.o1, x.o2, x.o3), '[]'::jsonb)
    from (
      select distinct on (lower(btrim(p.name)), coalesce(p.unit, ''))
        p.id, btrim(p.name) as name, coalesce(p.unit, '') as unit,
        case when lower(btrim(coalesce(p.brand, ''))) = lower(btrim(coalesce(s.name, ''))) then '' else btrim(coalesce(p.brand, '')) end as brand,
        btrim(coalesce(p.size, '')) as size,
        btrim(coalesce(p.code, '')) as code,
        left(concat_ws(' ', p.alt_names, p.code, p.sku, p.category), 200) as s,
        case when p.code ~ '^\d{1,9}$' then 0 else 1 end as o1,
        case when p.code ~ '^\d{1,9}$' then p.code::bigint else 0 end as o2,
        p.created_at as o3
      from public.products p left join public.suppliers s on s.id = p.supplier_id
      where coalesce(p.status, 'active') <> 'archive' and btrim(coalesce(p.name, '')) <> ''
      order by lower(btrim(p.name)), coalesce(p.unit, ''), (case when p.code ~ '^\d{1,9}$' then 0 else 1 end), p.created_at
    ) x
  );
end $$;
revoke all on function public.usta_catalog(text) from public;
grant execute on function public.usta_catalog(text) to anon, authenticated;
