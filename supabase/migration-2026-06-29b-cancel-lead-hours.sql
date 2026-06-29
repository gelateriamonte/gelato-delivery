-- Migration 2026-06-29b — Parametro dedicato per la finestra di annullamento.
-- Distinto da slot_lead_hours (anticipo ordinabilità fascia): cancel_lead_hours
-- è il termine, in ore prima dell'inizio della fascia, entro cui il Cliente può
-- annullare self-service (T&C Art. 8.6). Configurabile nel back office (Parametri).
-- Additiva e sicura. Default 2 (allineato al valore storico del T&C).

alter table settings add column if not exists cancel_lead_hours integer not null default 2;
