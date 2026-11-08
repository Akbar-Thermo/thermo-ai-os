-- Перечисление — отдельная база товаров и отдельные оплаты поставщикам.
--   products.perech    — товар базы перечисления (свои цена и себестоимость; на наличные не влияет, даже при одинаковом названии)
--   finance_ops.perech — оплата поставщику по перечислению (уменьшает только долг по объектам перечисления)
-- Только добавляет колонки (по умолчанию false — все нынешние товары и оплаты остаются наличными); повторный запуск безопасен.
alter table public.products add column if not exists perech boolean not null default false;
alter table public.finance_ops add column if not exists perech boolean not null default false;
create index if not exists products_perech_idx on public.products (perech) where perech;
notify pgrst, 'reload schema';
