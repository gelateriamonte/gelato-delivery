-- ============================================================
-- FASE B: lockdown sottrattivo dell'accesso anon.
-- Esegui SOLO dopo che la Fase A (migration-2026-06-25a) e il frontend
-- aggiornato (admin.js auth + order.js RPC) sono LIVE e verificati.
-- Da qui la anon key pubblica NON puo' piu' leggere orders/discount_codes
-- ne' scrivere su alcuna tabella; il catalogo resta in sola lettura.
-- Wrappato in transazione: in caso di errore, niente viene applicato.
-- Nomi delle policy anon presi 1:1 da schema.sql e dalle migration esistenti.
-- ============================================================

begin;

-- 1) Rimuovi le policy permissive anon (for all using(true)).
drop policy if exists "proto anon flavors"            on public.flavors;
drop policy if exists "proto anon formats"            on public.formats;
drop policy if exists "proto anon time_slots"         on public.time_slots;
drop policy if exists "proto anon slot_day_state"     on public.slot_day_state;
drop policy if exists "proto anon settings"           on public.settings;
drop policy if exists "proto anon orders"             on public.orders;
drop policy if exists "proto anon discount_codes"     on public.discount_codes;
drop policy if exists "proto anon print_jobs insert"  on public.print_jobs;  -- nome reale: "... insert"

-- 2) Revoca i grant larghi su anon (schema.sql faceva `grant all ... to anon`).
revoke all on all tables in schema public from anon;

-- 3) Catalogo pubblico: SOLO lettura per anon.
grant select on
  public.flavors, public.formats, public.time_slots, public.slot_day_state, public.settings
  to anon;

create policy "anon read flavors"        on public.flavors        for select to anon using (true);
create policy "anon read formats"        on public.formats        for select to anon using (true);
create policy "anon read time_slots"     on public.time_slots     for select to anon using (true);
create policy "anon read slot_day_state" on public.slot_day_state for select to anon using (true);
create policy "anon read settings"       on public.settings       for select to anon using (true);

-- 4) orders / discount_codes / print_jobs / pending_orders: NESSUN accesso anon.
--    L'admin opera come `authenticated` (policy "auth all *" della Fase A).
--    Il checkout pubblico passa solo dalle function service-role e dalle RPC
--    SECURITY DEFINER (rpc_slot_availability, rpc_coupon_precheck), che restano
--    eseguibili da anon e leggono i dati come owner senza esporre PII.

commit;
