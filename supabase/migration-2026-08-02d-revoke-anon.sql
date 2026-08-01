-- 2026-08-02d — Toglie ad anon i privilegi sulle tabelle di back office.
--
-- PERCHE'
-- Supabase ha un `alter default privileges in schema public grant all on tables
-- to anon, authenticated, service_role`: OGNI tabella creata in public nasce con
-- ALL concesso ad anon (SELECT, INSERT, UPDATE, DELETE). Il
-- `revoke all on all tables in schema public from anon` della migration
-- 2026-06-25b ha ripulito solo le tabelle esistenti in quel momento: non ha
-- toccato le default privileges, quindi le tabelle create dopo ripartono aperte.
--
-- Verificato il 2026-08-02 su produzione: customers, cake_items e cake_orders
-- avevano tutte e sette le privilegi per anon. L'unica barriera era la RLS.
-- Il pattern consolidato del progetto e' a DUE strati (grant + RLS): un domani
-- basterebbe un `disable row level security` per un debug, o una riesecuzione di
-- migration-2026-06-25b-rollback.sql, per rendere leggibile ad anon l'intera
-- rubrica clienti (nome, telefono, email, note).

revoke all on public.customers   from anon;
revoke all on public.cake_items  from anon;
revoke all on public.cake_orders from anon;

-- Nota per il futuro: ogni nuova tabella di back office va accompagnata da un
-- revoke esplicito come questo, finche' non si decide di cambiare le default
-- privileges dello schema public (decisione piu' ampia, da valutare a parte:
-- toccherebbe anche il comportamento atteso per le tabelle del catalogo pubblico).
