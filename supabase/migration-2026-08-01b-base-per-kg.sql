-- 2026-08-01b — Base per kg di gelato, per gusto
--
-- flavors.prod_base_ratio: quanti kg di base servono per 1 kg di gelato di quel gusto.
-- 1.00 = 1 kg di base per kg; 0.75 = 750 g di base per kg.
-- Usata solo nel back office (tab Produzione) per il totale base dei gusti accesi:
-- somma(prod_kg * prod_base_ratio). NON entra nello scontrino di produzione.
-- Default 1.00 su tutti i gusti esistenti.

alter table public.flavors add column if not exists prod_base_ratio numeric(4,2) not null default 1.00;

alter table public.flavors drop constraint if exists flavors_prod_base_ratio_check;
alter table public.flavors add constraint flavors_prod_base_ratio_check
  check (prod_base_ratio >= 0 and prod_base_ratio <= 9.99);
