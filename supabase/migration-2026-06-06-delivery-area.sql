-- ============================================================
-- Zona di consegna disegnabile dal back office (Parametri)
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- Poligono singolo come array di punti [lat,lng] in jsonb.
-- NULL = fallback al confine del comune di San Teodoro (js/santeodoro-boundary.js).
-- L'admin disegna il poligono su mappa (Leaflet-Geoman); l'app cliente lo usa
-- come geofence e ne mostra il contorno.
-- ============================================================

alter table settings add column if not exists delivery_area jsonb;
