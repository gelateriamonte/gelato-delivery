-- ============================================================
-- Capacità per fascia oraria — max consegne/giorno
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- NULL = illimitato (comportamento attuale). Valore >=1 = limite.
-- La capienza conta gli ordini "in lavorazione" del giorno per quella
-- fascia (status NOT IN consegnato/rifiutato/annullato); a >= max la
-- fascia non viene più offerta al cliente per quel giorno.
-- ============================================================

alter table time_slots
  add column if not exists max_deliveries int;

-- (Nessun backfill: le fasce esistenti restano illimitate finché
--  l'admin non imposta un valore.)
