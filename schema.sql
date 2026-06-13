-- ============================================================
-- THERMO ENGINEERING — схема базы данных для Supabase
-- Вставьте целиком в Supabase → SQL Editor → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ПОСТАВЩИКИ ----------
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text,
  phone       text,
  currency    text default 'сум',
  segment     text default 'комфорт',
  terms       text,
  status      text default 'active',
  created_at  timestamptz default now(),
  updated_at  timestamptz
);

-- ---------- МАСТЕРА ----------
create table if not exists masters (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  specialty     text,
  bonus_percent numeric default 10,
  note          text,
  status        text default 'active',
  created_at    timestamptz default now(),
  updated_at    timestamptz
);

-- ---------- ТОВАРЫ ----------
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  sku           text,
  name          text not null,
  alt_names     text,
  category      text,
  brand         text,
  supplier_id   uuid references suppliers(id) on delete set null,
  segment       text default 'комфорт',
  size          text,
  unit          text default 'шт',
  cost          numeric default 0,
  price         numeric default 0,
  stock         numeric default 0,
  min_stock     numeric default 0,
  status        text default 'active',
  price_updated timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz
);
create index if not exists idx_products_supplier on products(supplier_id);
create index if not exists idx_products_segment  on products(segment);

-- ---------- ОБЪЕКТЫ (позиции хранятся в jsonb-поле items) ----------
create table if not exists objects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client      text,
  phone       text,
  master      text,
  master_id   uuid references masters(id) on delete set null,
  manager     text,
  address     text,
  segment     text default 'комфорт',
  status      text default 'draft',
  items       jsonb default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz
);
create index if not exists idx_objects_master on objects(master_id);

-- ---------- ФИНАНСОВЫЕ ОПЕРАЦИИ ----------
create table if not exists finance_ops (
  id           uuid primary key default gen_random_uuid(),
  object_id    uuid references objects(id) on delete cascade,
  supplier_id  uuid references suppliers(id) on delete set null,
  master_id    uuid references masters(id) on delete set null,
  type         text not null,           -- client_payment | supplier_payment | return | discount | expense | bonus | bonus_payment
  amount       numeric default 0,
  cost_amount  numeric default 0,       -- для возвратов
  qty          numeric,
  product_id   uuid,
  product_name text,
  item_id      text,
  item_name    text,                    -- бонус вещью
  unit         text,
  size         text,
  reason       text,
  note         text,
  op_date      date default current_date,
  batch_id     text,
  voided       boolean default false,
  edited       boolean default false,
  edit_log     jsonb default '[]'::jsonb,
  user_name    text,
  created_at   timestamptz default now()
);
create index if not exists idx_ops_object   on finance_ops(object_id);
create index if not exists idx_ops_supplier on finance_ops(supplier_id);
create index if not exists idx_ops_master   on finance_ops(master_id);

-- ---------- ЗАЯВКИ (аудит AI-подбора) ----------
create table if not exists requests (
  id         uuid primary key default gen_random_uuid(),
  object_id  uuid references objects(id) on delete cascade,
  segment    text,
  mode       text,
  source     text,
  lines      jsonb default '[]'::jsonb, -- исходный текст, выбор AI, выбор менеджера, исправления
  created_at timestamptz default now()
);

-- ---------- СКЛАД THERMO ----------
create table if not exists warehouse (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid,
  name        text,
  size        text,
  unit        text default 'шт',
  qty         numeric default 0,
  cost        numeric default 0,
  price       numeric default 0,
  supplier_id uuid references suppliers(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz
);

create table if not exists wh_moves (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid,
  name        text,
  qty         numeric default 0,
  dir         text,                     -- in | out
  object_id   uuid,
  object_name text,
  op_date     date default current_date,
  note        text,
  user_name   text,
  created_at  timestamptz default now()
);

-- ============================================================
-- ДОСТУП (на старте — упрощённо; ужесточите при росте команды)
-- ============================================================
alter table suppliers   enable row level security;
alter table masters     enable row level security;
alter table products    enable row level security;
alter table objects     enable row level security;
alter table finance_ops enable row level security;
alter table requests    enable row level security;
alter table warehouse   enable row level security;
alter table wh_moves    enable row level security;

-- Политика: любой залогиненный пользователь работает с данными.
-- (Разделение менеджер/руководитель пока на уровне интерфейса; позже
--  заменить на роли через таблицу profiles + проверку роли в политиках.)
do $$
declare t text;
begin
  foreach t in array array['suppliers','masters','products','objects','finance_ops','requests','warehouse','wh_moves']
  loop
    execute format('drop policy if exists auth_all on %I;', t);
    execute format('create policy auth_all on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
