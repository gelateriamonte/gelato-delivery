-- 2026-08-01 — Sezione Note in Produzione + massimale kg per gusto 8 -> 16
--
-- 1) settings.production_note: nota di testo libero del back office (riga singleton id=1),
--    stampabile sulla termica via print_jobs kind='note'.
-- 2) flavors.prod_kg: il vincolo esistente flavors_prod_kg_check limitava a 8 kg.
--    Si allarga a 16. Nessun dato esistente viola il vincolo nuovo.

alter table public.settings add column if not exists production_note text;

alter table public.flavors drop constraint if exists flavors_prod_kg_check;
alter table public.flavors add constraint flavors_prod_kg_check check (prod_kg between 1 and 16);
