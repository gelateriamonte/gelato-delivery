-- 2026-08-02f — Torte a peso: il prezzo sta sul kg, non sul formato.
--
-- Il formato piccola/grande sparisce dall'interfaccia. Le colonne restano a
-- database (has_small, has_large, price_small, price_large, variant) perche' gli
-- ordini gia' presi le hanno valorizzate e lo storico deve continuare a leggersi:
-- non si cancella niente, si smette di scriverci.

-- Listino: un solo prezzo, quello al kg. 30 e' il valore di partenza, modificabile
-- riga per riga dal back office. `not null` a differenza dei prezzi per formato:
-- li' esisteva il caso "prezzo ancora da decidere", qui no — senza prezzo al kg il
-- totale dell'ordine non e' calcolabile.
alter table public.cake_items
  add column if not exists price_kg numeric(6,2) not null default 30;

-- Ordine: peso e prezzo al kg CONGELATI accanto al totale. Senza il prezzo al kg
-- del giorno, un ritocco al listino renderebbe illeggibile il conto di un ordine
-- gia' preso. `extras_price` e' gia' compreso nel totale `price`: si tiene
-- separato solo per stamparne il dettaglio.
alter table public.cake_orders
  add column if not exists weight_kg    numeric(5,2),
  add column if not exists price_kg     numeric(6,2),
  add column if not exists extras_price numeric(6,2);

-- Nullable perche' lo storico anteriore a oggi non li ha; i nuovi ordini li
-- scrivono sempre. I CHECK valgono solo sul valorizzato: un peso a zero e un extra
-- negativo sono errori di digitazione, non dati.
alter table public.cake_orders drop constraint if exists cake_orders_peso_positivo;
alter table public.cake_orders add constraint cake_orders_peso_positivo
  check (weight_kg is null or weight_kg > 0);
alter table public.cake_orders drop constraint if exists cake_orders_extra_non_negativo;
alter table public.cake_orders add constraint cake_orders_extra_non_negativo
  check (extras_price is null or extras_price >= 0);

-- `variant` era not null: i nuovi ordini non hanno piu' un formato da scriverci.
-- Il CHECK esistente resta com'e': in Postgres un CHECK passa sul NULL.
alter table public.cake_orders alter column variant drop not null;

-- Nessun grant nuovo: `grant all on <tabella>` copre anche le colonne aggiunte
-- dopo, e ad anon su queste tabelle non e' concesso nulla.
