-- ============================================================
-- 2026-06-07 — Tempo di anticipo da inizio fascia (lead time)
-- Il cliente vede una fascia di consegna solo fino a N ore prima
-- del suo inizio (es. 2h -> la fascia 18:00 sparisce alle 16:00).
-- Parametro globale, editabile 1..6h nel back office (tab Fasce orarie).
-- ============================================================

alter table settings add column if not exists slot_lead_hours int not null default 2;
