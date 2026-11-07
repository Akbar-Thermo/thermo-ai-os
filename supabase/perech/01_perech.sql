-- Раздел «Перечисление» (клиент платит через банк).
-- Только добавляет колонки, данные не меняет; повторный запуск безопасен.
--   objects.perech  — реквизиты покупателя, курсы поставок, договор и доп. соглашения (jsonb)
--   products.ikpu   — ИКПУ (17 цифр) для счёт-фактуры в Didox; pack_code / pack_name — код и название упаковки
-- Применено к СИНОВ-базе (thermo-sinov) 07.11.2026. В рабочую базу — перед тем, как выкладывать раздел в main.
alter table public.objects add column if not exists perech jsonb;
alter table public.products add column if not exists ikpu text;
alter table public.products add column if not exists pack_code text;
alter table public.products add column if not exists pack_name text;
notify pgrst, 'reload schema';
