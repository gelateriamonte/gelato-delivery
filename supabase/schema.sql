-- ============================================================
-- Gelato Delivery — schema prototipo
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- Crea tabelle parametri (back office) + ordini, seed di esempio,
-- RLS permissiva (PROTOTIPO) e realtime sugli ordini.
-- ============================================================

-- ---------- TABELLE ----------

-- GUSTI ordinabili
create table if not exists flavors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  available   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- FORMATI / QUANTITA' (contenitore con prezzo e n. gusti ammessi)
create table if not exists formats (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                 -- es. "Coppetta media (2 gusti)"
  max_flavors int  not null default 1,
  price       numeric(8,2) not null default 0,
  available   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- FASCE ORARIE di consegna (CATALOGO condiviso da tutti i giorni)
create table if not exists time_slots (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,                 -- es. "18:00 - 18:30"
  active         boolean not null default true, -- default per i giorni senza override
  max_deliveries int,                           -- max consegne/giorno (NULL = illimitato)
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

-- STATO acceso/spento di una fascia in uno specifico giorno.
-- Nessuna riga per (giorno, fascia) ⇒ vale time_slots.active.
create table if not exists slot_day_state (
  slot_id     uuid not null references time_slots(id) on delete cascade,
  day         date not null,
  active      boolean not null,
  primary key (slot_id, day)
);

-- PARAMETRI GLOBALI (riga singola)
create table if not exists settings (
  id            int primary key default 1,
  delivery_cost numeric(8,2) not null default 0,
  min_order     numeric(8,2) not null default 0,
  constraint settings_singleton check (id = 1)
);

-- ORDINI
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  customer_name  text not null,
  customer_phone text not null,
  email          text,
  address        text not null,
  delivery_lat   double precision,            -- posizione precisa del pin (mappa)
  delivery_lng   double precision,
  delivery_date  date,                        -- giorno di consegna scelto
  slot_label     text,                        -- snapshot fascia scelta
  items          jsonb not null default '[]'::jsonb,  -- [{format, gusti[], qty, prezzo_unit}]
  subtotal       numeric(8,2) not null default 0,
  delivery_cost  numeric(8,2) not null default 0,
  total          numeric(8,2) not null default 0,
  notes          text,
  status         text not null default 'ricevuto',
  created_at     timestamptz not null default now()
);

-- ---------- SEED DI ESEMPIO ----------

insert into settings (id, delivery_cost, min_order)
values (1, 3.50, 15.00)
on conflict (id) do nothing;

insert into flavors (name, sort_order) values
  ('Fiordilatte', 1), ('Cioccolato', 2), ('Pistacchio', 3),
  ('Nocciola', 4), ('Stracciatella', 5), ('Limone', 6), ('Fragola', 7);

insert into formats (name, max_flavors, price, sort_order) values
  ('Coppetta piccola (1 gusto)', 1, 2.50, 1),
  ('Coppetta media (2 gusti)',   2, 3.50, 2),
  ('Coppetta grande (3 gusti)',  3, 4.50, 3),
  ('Vaschetta 500g (3 gusti)',   3, 9.00, 4),
  ('Vaschetta 750g (4 gusti)',   4, 13.00, 5);

insert into time_slots (label, sort_order) values
  ('18:00 - 18:30', 1), ('18:30 - 19:00', 2),
  ('19:00 - 19:30', 3), ('21:00 - 21:30', 4);

-- ---------- ROW LEVEL SECURITY ----------
-- ⚠️ PROTOTIPO: policy permissive. Chiunque abbia la anon key può
-- leggere/scrivere. NON usare in produzione: serve auth reale + policy
-- ristrette (back office solo authenticated, ordini insert pubblico).

alter table flavors        enable row level security;
alter table formats        enable row level security;
alter table time_slots     enable row level security;
alter table slot_day_state enable row level security;
alter table settings       enable row level security;
alter table orders         enable row level security;

create policy "proto anon flavors"        on flavors        for all to anon using (true) with check (true);
create policy "proto anon formats"        on formats        for all to anon using (true) with check (true);
create policy "proto anon time_slots"     on time_slots     for all to anon using (true) with check (true);
create policy "proto anon slot_day_state" on slot_day_state for all to anon using (true) with check (true);
create policy "proto anon settings"       on settings       for all to anon using (true) with check (true);
create policy "proto anon orders"         on orders         for all to anon using (true) with check (true);

-- grant esplicito al ruolo anon (alcune config Data API non lo fanno in automatico)
grant usage on schema public to anon;
grant all on all tables in schema public to anon;

-- ---------- REALTIME ----------
-- Il back office riceve i nuovi ordini in tempo reale.
alter publication supabase_realtime add table orders;
