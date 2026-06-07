-- ============================================================
-- 2026-06-07 — Microdescrizione in inglese per i gusti del giorno
-- Il nome del gusto resta in italiano; la microdescrizione mostrata
-- in home ha una versione EN (fallback alla IT se vuota).
-- ============================================================

alter table flavors add column if not exists description_en text;

-- Backfill EN dei gusti del giorno con descrizione (al momento solo "Pistacchio croccante").
update flavors set description_en = 'Sweet almond base rippled with wafer bits and pistachios'
where lower(name) = lower('Pistacchio croccante');
