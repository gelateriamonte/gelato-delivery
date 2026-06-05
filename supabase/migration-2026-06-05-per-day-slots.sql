-- ============================================================
-- Migration 2026-06-05 — fasce orarie per-giorno + data consegna
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- Idempotente: ri-eseguibile senza errori.
--
-- Modello: le fasce (time_slots) restano un CATALOGO condiviso da
-- tutti i giorni (label/aggiungi/elimina = globale). L'acceso/spento
-- diventa PER GIORNO tramite slot_day_state. Se per un (giorno, fascia)
-- non c'è riga → vale il default time_slots.active.
-- ============================================================

-- Stato acceso/spento di una fascia in uno specifico giorno.
create table if not exists slot_day_state (
  slot_id uuid not null references time_slots(id) on delete cascade,
  day     date not null,
  active  boolean not null,
  primary key (slot_id, day)
);

-- Data di consegna scelta dal cliente (snapshot sull'ordine).
alter table orders add column if not exists delivery_date date;

-- RLS permissiva (PROTOTIPO) + grant esplicito al ruolo anon.
alter table slot_day_state enable row level security;
do $$ begin
  create policy "proto anon slot_day_state" on slot_day_state
    for all to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

grant all on slot_day_state to anon;
