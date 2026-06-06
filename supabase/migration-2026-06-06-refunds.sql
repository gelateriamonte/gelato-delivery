-- ============================================================
-- Rimborsi: quando l'esercente RIFIUTA/ANNULLA un ordine già pagato, va rimborsato.
-- Additiva. (Già applicata via MCP il 2026-06-06.)
-- ============================================================

alter table orders add column if not exists payment_intent text;   -- pi_... necessario a refunds.create
alter table orders add column if not exists refunded_at    timestamptz;
alter table orders add column if not exists refund_id      text;
