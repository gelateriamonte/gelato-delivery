-- Migration 2026-06-29 — Email transazionali + annullamento self-service
-- Additiva e sicura (colonne nullable, nessun backfill distruttivo).
-- Applicare PRIMA di mandare in produzione il codice che le usa:
--   - orders.lang        : lingua scelta dal cliente (per email IT/EN). Oggi non persistita.
--   - orders.cancel_token : token segreto per-ordine per il link "Annulla ordine" in email.
-- Gli ordini preesistenti restano con lang/cancel_token NULL (non annullabili via email: ok, precedono la feature).

alter table orders add column if not exists lang text;
alter table orders add column if not exists cancel_token text;

-- Lookup per token nel flusso di annullamento (cancel-order.js).
create unique index if not exists orders_cancel_token_key on orders (cancel_token) where cancel_token is not null;
