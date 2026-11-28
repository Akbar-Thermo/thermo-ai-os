-- Usta sahifasi (kompyuter): tovar qidiruvi — programmadagi «Товары» bazasidan, programmadagidek, lekin NARXSIZ.
-- Faqat shaxsiy havolasi (usta_keys) bor ustaga. Javob: { s: [[postavshik_id, nomi]], p: [[id, nomi, birlik, brend, o'lcham, qo'shimcha matn, kod, postavshik_id]] }.
-- «Перечисление» tovarlari (products.perech = true — alohida baza, alohida narxlar) ustaga ko'rsatilmaydi.
-- Narx, tannarx, qoldiq — berilmaydi. Tartib — programmadagidek: avval kod 1, 2, 3…, keyin qo'shilgan sanasi.
create or replace function public.usta_catalog(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.usta_keys k join public.masters m on m.id = k.master_id
                  where k.key = btrim(coalesce(p_key, '')) and coalesce(m.status, 'active') <> 'inactive') then
    raise exception 'usta_key';
  end if;
  return jsonb_build_object(
    's', (select coalesce(jsonb_agg(jsonb_build_array(s.id, btrim(s.name)) order by s.name), '[]'::jsonb)
            from public.suppliers s where coalesce(s.status, 'active') <> 'inactive' and btrim(coalesce(s.name, '')) <> ''),
    'p', (select coalesce(jsonb_agg(jsonb_build_array(p.id, btrim(p.name), coalesce(p.unit, ''), btrim(coalesce(p.brand, '')), btrim(coalesce(p.size, '')),
                    left(concat_ws(' ', p.alt_names, p.sku, p.category), 160), btrim(coalesce(p.code, '')), p.supplier_id)
                  order by (case when p.code ~ '^\d{1,9}$' then 0 else 1 end), (case when p.code ~ '^\d{1,9}$' then p.code::bigint else 0 end), p.created_at, p.name), '[]'::jsonb)
            from public.products p
           where coalesce(p.status, 'active') <> 'archive' and btrim(coalesce(p.name, '')) <> '' and not coalesce(p.perech, false))
  );
end $$;
revoke all on function public.usta_catalog(text) from public;
grant execute on function public.usta_catalog(text) to anon, authenticated;
