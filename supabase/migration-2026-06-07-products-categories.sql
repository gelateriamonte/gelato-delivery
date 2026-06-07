-- ============================================================
-- 2026-06-07 — Prodotti con categorie + gusti speciali
-- Sezione "Formati & prezzi" diventa "Prodotti", divisa in due
-- categorie: Vaschette ('vaschetta') e Altri prodotti ('altro').
-- I gusti possono essere marcati come "speciali" (stellina, solo
-- back office). Migrazione puramente additiva (idempotente).
-- ============================================================

-- Prodotti: categoria di raggruppamento (vaschetta | altro).
-- I prodotti esistenti (tutte vaschette) ereditano il default.
alter table formats add column if not exists category text not null default 'vaschetta';

-- Gusti: flag "speciale" (stellina). Metadato solo back office.
alter table flavors add column if not exists special boolean not null default false;
