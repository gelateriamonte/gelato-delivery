-- ============================================================
-- 2026-06-07 — Peso vaschette (kg) come campo dedicato
-- Le vaschette si vendono a peso: il peso diventa un campo a parte
-- (weight_kg) e il nome cliente e' derivato dal peso (es. "Vaschetta 1Kg").
-- Il laboratorio usa weight_kg al posto del parse dal nome.
-- Solo categoria 'vaschetta' ha weight_kg; 'altro' resta NULL.
-- ============================================================

alter table formats add column if not exists weight_kg numeric(5,2);

-- Backfill vaschette esistenti: peso + nome pulito derivato dal peso.
update formats set weight_kg = 0.60, name = 'Vaschetta 600g'  where category = 'vaschetta' and name = 'Vaschetta 600gr';
update formats set weight_kg = 0.90, name = 'Vaschetta 900g'  where category = 'vaschetta' and name = 'Vaschetta 900gr Max 4 gusti';
update formats set weight_kg = 1.20, name = 'Vaschetta 1,2Kg' where category = 'vaschetta' and name = 'Vaschetta 1,2 Kg max 4 gusti';
update formats set weight_kg = 1.70, name = 'Vaschetta 1,7Kg' where category = 'vaschetta' and name = 'Vaschetta 1,7 Kg max 6 gusti';
