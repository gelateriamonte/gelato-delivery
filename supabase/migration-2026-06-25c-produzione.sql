-- ============================================================
-- 2026-06-25c — Sezione "Produzione" (back office)
-- flavors: stato produzione indipendente dal catalogo.
-- print_jobs: supporto a job di stampa non legati a un ordine.
-- Eseguire in Supabase: SQL editor → incolla → Run.
-- RLS: invariata. `authenticated` ha già auth-all su flavors e print_jobs (Fase A -25a).
-- ============================================================

-- flavors: stato produzione (indipendente da sort_order / available)
alter table flavors add column if not exists prod_on    boolean not null default false;
alter table flavors add column if not exists prod_kg    int     not null default 3 check (prod_kg between 1 and 8);
alter table flavors add column if not exists prod_order int     not null default 0;

-- ordine iniziale di produzione = ordine catalogo attuale (poi indipendente)
update flavors set prod_order = sort_order where prod_order = 0;

-- print_jobs: job di produzione (niente ordine, contenuto in payload)
alter table print_jobs add column if not exists kind    text not null default 'order';
alter table print_jobs alter column order_id drop not null;
alter table print_jobs add column if not exists payload jsonb;
