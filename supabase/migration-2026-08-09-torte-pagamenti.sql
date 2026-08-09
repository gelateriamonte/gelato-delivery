-- 2026-08-09 — Pagamenti torte: incasso alla consegna oppure differito.
--
-- Due colonne, nessun enum di stato: "da pagare" = consegnato con paid_at NULL.
-- Uno stato scritto a parte finirebbe prima o poi in disaccordo con paid_at.
alter table public.cake_orders
  add column if not exists paid_at timestamptz,
  add column if not exists payment_due_date date;

-- Gli ordini consegnati prima di oggi sono tutti incassati (scelta del titolare):
-- la lista "Da pagare" parte vuota, senza falsi sospesi da chiudere a mano.
update public.cake_orders
  set paid_at = coalesce(delivered_at, now())
  where status = 'consegnato' and paid_at is null;

-- Nessun grant nuovo: anon su cake_orders non ha nulla, authenticated ha il
-- grant di tabella che copre anche le colonne aggiunte dopo.
