-- Бот остатка (функция Supabase «ostatka»): счёт-фактуры прихода/расхода из Telegram.
-- Доступ — только у функции (ключ service role): RLS включён, правил нет, у anon/authenticated прав нет.
-- Настройки и список «кто писал боту» — в requests (mode te_os / te_ospend), как у других ботов.

create table if not exists public.ostatka_invoices (
  id bigserial primary key,
  chat_id bigint not null,
  kind text check (kind in ('prixod', 'rasxod')),          -- null — файл ждёт «prixod»/«rasxod»
  uid text not null,                                         -- номер|дата|ИНН продавца — повтор не берётся
  number text not null,
  date date not null,
  supplier text, supplier_inn text, buyer text, buyer_inn text,
  total numeric(18, 2) not null default 0,
  file_name text,
  lines jsonb not null default '[]'::jsonb,                  -- строки товаров счёт-фактуры
  created_at timestamptz not null default now(),
  unique (chat_id, uid)
);
create index if not exists ostatka_invoices_chat on public.ostatka_invoices (chat_id, kind);

create table if not exists public.ostatka_chats (
  chat_id bigint primary key,
  mode text check (mode in ('prixod', 'rasxod')),            -- куда идут следующие файлы (30 минут)
  mode_at timestamptz,
  name text,
  batch jsonb not null default '[]'::jsonb,                  -- отчёт о пачке файлов (отправляется одним сообщением)
  batch_at text,
  updated_at timestamptz not null default now()
);

alter table public.ostatka_invoices enable row level security;
alter table public.ostatka_chats enable row level security;
revoke all on public.ostatka_invoices, public.ostatka_chats from anon, authenticated;
revoke all on sequence public.ostatka_invoices_id_seq from anon, authenticated;
