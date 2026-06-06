-- ============================================================
-- Coordinate di consegna — posizione precisa del pin sulla mappa
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- L'app cliente mostra una mappa (Leaflet/OSM), l'utente regola il pin
-- entro il comune di San Teodoro; lat/lng vengono salvate sull'ordine.
-- ============================================================

alter table orders add column if not exists delivery_lat double precision;
alter table orders add column if not exists delivery_lng double precision;
