-- ============================================================
-- Ritiro in negozio + orari di apertura
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- - settings.opening_hours: orari per giorno {lun..dom:{chiuso,apertura,chiusura}} (NULL = default in admin.js)
-- - orders.fulfillment: 'delivery' (consegna) | 'pickup' (ritiro). Default delivery (ordini esistenti).
-- ============================================================

alter table settings add column if not exists opening_hours jsonb;
alter table orders   add column if not exists fulfillment text not null default 'delivery';
