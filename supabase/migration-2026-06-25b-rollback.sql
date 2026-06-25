-- ============================================================
-- ROLLBACK della Fase B (lockdown). Ripristina lo stato Fase A:
-- anon torna ad avere accesso pieno (come prima del lockdown),
-- mentre le policy "auth all *" e le RPC della Fase A restano.
-- Usare SOLO in emergenza se il lockdown rompe il sito pubblico.
-- ============================================================

begin;

-- Rimuovi le policy di sola lettura introdotte dal lockdown.
drop policy if exists "anon read flavors"        on public.flavors;
drop policy if exists "anon read formats"        on public.formats;
drop policy if exists "anon read time_slots"     on public.time_slots;
drop policy if exists "anon read slot_day_state" on public.slot_day_state;
drop policy if exists "anon read settings"       on public.settings;

-- Ripristina le policy permissive anon originali (nomi 1:1 con lo schema).
create policy "proto anon flavors"            on public.flavors        for all to anon using (true) with check (true);
create policy "proto anon formats"            on public.formats        for all to anon using (true) with check (true);
create policy "proto anon time_slots"         on public.time_slots     for all to anon using (true) with check (true);
create policy "proto anon slot_day_state"     on public.slot_day_state for all to anon using (true) with check (true);
create policy "proto anon settings"           on public.settings       for all to anon using (true) with check (true);
create policy "proto anon orders"             on public.orders         for all to anon using (true) with check (true);
create policy "proto anon discount_codes"     on public.discount_codes for all to anon using (true) with check (true);
create policy "proto anon print_jobs insert"  on public.print_jobs     for insert to anon with check (true);

grant all on all tables in schema public to anon;

commit;
