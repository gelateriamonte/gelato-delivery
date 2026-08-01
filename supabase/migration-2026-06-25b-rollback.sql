-- ============================================================
-- ROLLBACK della Fase B (lockdown). Ripristina lo stato Fase A:
-- anon torna ad avere accesso pieno (come prima del lockdown),
-- mentre le policy "auth all *" e le RPC della Fase A restano.
-- Usare SOLO in emergenza se il lockdown rompe il sito pubblico.
--
-- ⚠️ AVVERTENZA — QUESTO SCRIPT RIAPRE FALLE NOTE, NON "RIPRISTINA UNO STATO SICURO" ⚠️
-- "Accesso pieno per anon" significa: chiunque, con la anon key pubblica che sta in
-- config.js ed è leggibile da qualsiasi visitatore, torna a poter fare quello che
-- il lockdown del 2026-06-25 ha chiuso. Nel dettaglio, dopo questo file:
--   orders          -> anon LEGGE e SCRIVE gli ordini: nome, telefono, email,
--                      indirizzo, importi. Sono PII di clienti reali.
--   discount_codes  -> anon legge tutti i codici sconto e può crearli/modificarli/cancellarli.
--   settings        -> anon legge l'INTERA riga (production_note, wa_templates,
--                      cancel_lead_hours incluse) e può anche riscriverla.
--   flavors         -> anon legge/scrive anche i campi del piano di produzione
--                      (prod_on, prod_kg, prod_order, prod_base_ratio).
--   formats / time_slots / slot_day_state -> di nuovo scrivibili da anon, non solo leggibili.
--   print_jobs      -> resta solo INSERT (qui sotto si ricrea solo la policy di insert),
--                      ma il grant di tabella diventa comunque pieno.
--   pending_orders  -> nessuna policy anon viene ricreata, quindi la RLS continua a
--                      bloccarlo; regge solo finché la RLS su quella tabella resta attiva.
-- In più i grant per colonna introdotti dopo il lockdown (settings, e le eventuali
-- migration analoghe sulle altre tabelle) vengono scavalcati: vedi la nota sulla riga
-- `grant all` in fondo al file.
--
-- SE ESEGUI QUESTO ROLLBACK, SUBITO DOPO:
--   1) trattalo come una finestra di esposizione aperta: finché resta applicato, le PII
--      degli ordini sono leggibili da chiunque abbia la anon key (cioè da chiunque);
--   2) risolvi la causa vera (di solito è il frontend, non il DB) e richiudi appena puoi
--      riapplicando, IN QUEST'ORDINE:
--        a. supabase/migration-2026-06-25b-rls-lockdown.sql
--        b. supabase/migration-2026-08-01c-settings-column-grants.sql
--           (richiude production_note, wa_templates, cancel_lead_hours);
--        c. supabase/migration-2026-08-01d-flavors-column-grants.sql
--           (richiude prod_on, prod_kg, prod_order, prod_base_ratio);
--        (+ ogni migration successiva di grant per colonna: NON sopravvivono
--         a questo script, vanno rieseguite tutte);
--   3) verifica che sia richiuso davvero: `node test/security-assert.mjs --strict`
--      (nessuna riga FAIL: orders e discount_codes 401, e le colonne private di
--       settings/flavors di nuovo DENIED).
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

-- ⚠️ RIGA PIU' PERICOLOSA DEL FILE ⚠️
-- `grant all` = select+insert+update+delete per anon su OGNI tabella di public
-- esistente al momento dell'esecuzione, non solo sulle 5 del catalogo pubblico.
-- Effetti collaterali che non si vedono leggendo la riga:
--   • scavalca i grant per colonna della migration-2026-08-01c: il SELECT di tabella
--     prevale su quelli di colonna, quindi settings torna leggibile per intero e
--     production_note (nota interna del titolare) torna nel payload di ogni visitatore
--     che chieda `select=*`. Stessa cosa per i campi di produzione di flavors
--     (prod_base_ratio & co.) se nel frattempo sono stati ristretti per colonna.
--   • dà ad anon anche INSERT/UPDATE/DELETE su settings, orders, discount_codes:
--     non serve a "far ripartire il sito", che ha bisogno solo di leggere.
-- E' PIU' LARGA DEL NECESSARIO, di proposito: questo file deve riprodurre ALLA LETTERA
-- lo stato pre-lockdown (schema.sql, riga `grant all on all tables in schema public to
-- anon`), perché un rollback che non riporta indietro davvero è peggio di nessun rollback.
-- NON restringerla qui. Se ti serve solo riaprire la LETTURA del catalogo, non eseguire
-- questo file: esegui a mano il minimo indispensabile, cioè
--   grant select on public.flavors, public.formats, public.time_slots,
--                   public.slot_day_state, public.settings to anon;
grant all on all tables in schema public to anon;

commit;
