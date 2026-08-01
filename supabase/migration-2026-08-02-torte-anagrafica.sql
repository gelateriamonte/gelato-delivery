-- 2026-08-02 — Torte e anagrafica clienti (solo back office).
-- Nessun accesso anon: stesso schema di `orders`, non quello del catalogo pubblico.

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,
  -- norm_mobile e' IMMUTABLE: la colonna generata rende il doppione impossibile
  -- per costruzione, non per disciplina dell'operatore.
  phone_norm  text generated always as (public.norm_mobile(phone)) stored,
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists customers_phone_norm_key on public.customers (phone_norm);

create table if not exists public.cake_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  photo_url    text,
  -- "esiste questa variante" e' separato da "quanto costa": il Tiramisu' esiste
  -- solo grande, la Sfera Roche esiste in entrambe ma senza prezzi decisi.
  has_small    boolean not null default true,
  has_large    boolean not null default true,
  price_small  numeric(6,2),
  price_large  numeric(6,2),
  available    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.cake_orders (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references public.customers(id) on delete set null,
  -- campi congelati: lo storico deve restare leggibile anche se articolo o
  -- cliente vengono rinominati o cancellati.
  customer_name  text not null,
  customer_phone text not null,
  cake_item_id   uuid references public.cake_items(id) on delete set null,
  item_name      text not null,
  variant        text not null check (variant in ('piccola','grande')),
  price          numeric(6,2) not null,
  pickup_at      timestamptz not null,
  inscription    text,
  extras         text,
  notes          text,
  -- niente stato 'annullato': l'annullamento elimina la riga (scelta del titolare)
  status         text not null default 'in attesa' check (status in ('in attesa','consegnato')),
  delivered_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists cake_orders_status_pickup_idx on public.cake_orders (status, pickup_at);

alter table public.customers   enable row level security;
alter table public.cake_items  enable row level security;
alter table public.cake_orders enable row level security;

drop policy if exists "auth all customers"   on public.customers;
drop policy if exists "auth all cake_items"  on public.cake_items;
drop policy if exists "auth all cake_orders" on public.cake_orders;

create policy "auth all customers"   on public.customers   for all to authenticated using (true) with check (true);
create policy "auth all cake_items"  on public.cake_items  for all to authenticated using (true) with check (true);
create policy "auth all cake_orders" on public.cake_orders for all to authenticated using (true) with check (true);

grant all on public.customers, public.cake_items, public.cake_orders to authenticated;
-- ad anon NON si concede nulla: nessun grant, nessuna policy.
