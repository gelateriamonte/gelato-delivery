-- ============================================================
-- Messaggi WhatsApp per stato ordine (modificabili dal back office)
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- Colonna jsonb sul singleton settings: { "<stato>": "<testo>" }.
-- Se NULL, l'app usa i default hardcoded in js/admin.js (WA_DEFAULTS).
-- Segnaposti supportati: {nome} {giorno} {fascia} {indirizzo} {totale}
-- ============================================================

alter table settings add column if not exists wa_templates jsonb;
