-- ============================================================
-- 2026-07-18 — Tempo di anticipo da inizio fascia in MINUTI
-- Nuova colonna slot_lead_minutes (int, nullable):
--   null  -> i client usano il fallback slot_lead_hours * 60 (comportamento invariato)
--   n>=0  -> anticipo in minuti (es. 30 = mezz'ora)
-- slot_lead_hours NON si elimina: i client col JS vecchio in cache continuano
-- a leggerla; l'admin la tiene allineata a ceil(minuti/60) (mai meno restrittiva).
-- Eseguire nel SQL Editor di Supabase (progetto rlrsyqmwtjfyuqkgzqso).
-- ============================================================
alter table settings add column if not exists slot_lead_minutes int;

-- valore richiesto dal titolare: 30 minuti (slot_lead_hours=1 per i client vecchi)
update settings set slot_lead_minutes = 30, slot_lead_hours = 1 where id = 1;
