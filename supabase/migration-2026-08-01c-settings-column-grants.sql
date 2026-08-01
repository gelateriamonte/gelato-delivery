-- ============================================================
-- 2026-08-01c — Grant per COLONNA su public.settings per il ruolo anon.
--
-- PERCHE'
-- Fino ad ora anon aveva `grant select` sull'INTERA tabella settings
-- (migration-2026-06-25b-rls-lockdown.sql, punto 3). Conseguenza: ogni colonna
-- aggiunta a settings diventa PUBBLICA per default, senza che nessuno decida.
-- E' già successo: `production_note` (nota interna del titolare, aggiunta con
-- migration-2026-08-01-note-produzione.sql) veniva servita a ogni visitatore
-- della pagina d'ordine, perché js/order.js faceva `select("*")` su settings.
--
-- Questa migration inverte il default: anon perde il SELECT di tabella e
-- riceve il SELECT solo sulle colonne che il sito pubblico usa davvero.
-- Da qui in poi ogni colonna nuova di settings NASCE PRIVATA: per esporla
-- serve un `grant select (colonna)` esplicito, cioè una decisione consapevole.
--
-- La RLS non cambia: la policy "anon read settings" (for select using(true))
-- resta attiva. RLS decide QUALI RIGHE, i grant per colonna QUALI COLONNE.
-- I due livelli sono complementari: senza grant di colonna la policy non basta.
--
-- Le Netlify Functions non sono toccate: girano con la service_role key, che
-- bypassa RLS e grant (cancel-order.js legge cancel_lead_hours,
-- create-checkout.js legge delivery_cost — continuano a funzionare).
-- Il back office opera come ruolo `authenticated` e mantiene l'accesso pieno.
--
-- ⚠️ AVVERTENZA — ORDINE DI APPLICAZIONE OBBLIGATORIO ⚠️
-- Applicare questa migration SOLO DOPO che il nuovo js/order.js (quello con le
-- colonne esplicite al posto di select("*")) è ONLINE su produzione e verificato.
-- Se la si applica prima, il sito live continua a chiedere `select=*` su settings
-- e PostgreSQL risponde `permission denied for table settings` (42501): la pagina
-- d'ordine non carica più il menù. Sequenza corretta:
--   1) git push del nuovo js/order.js  →  2) verifica che sia live
--      (curl -s https://gelato26.netlify.app/js/order.js | grep slot_lead_minutes)
--   3) solo allora esegui questa migration.
--
-- ROLLBACK — procedura d'emergenza (questa, non il grant di tabella)
-- Ri-concede ad anon le SOLE colonne pubbliche, cioè rimette lo stato che questa
-- migration vuole (è idempotente, equivale a rieseguirla):
--   revoke select on public.settings from anon;
--   grant  select (id, delivery_cost, min_order, max_advance_days, slot_lead_minutes,
--                  slot_lead_hours, opening_hours, delivery_area, home_content)
--     on public.settings to anon;
-- Se il sito pubblico è rotto perché al codice manca UNA colonna, aggiungi quella
-- e basta, senza riaprire il resto —
--   grant select (nome_colonna) on public.settings to anon;
--
-- ⚠️ NON usare il grant di TABELLA `grant select on public.settings to anon` ⚠️
-- È il rollback che "ripristina il comportamento precedente", e il comportamento
-- precedente è esattamente la falla: rimette il ruolo anon — cioè la anon key
-- pubblica di config.js, in mano a chiunque apra il sito — in condizione di leggere
-- OGNI colonna di settings, comprese production_note (nota interna del titolare),
-- wa_templates e cancel_lead_hours, più ogni colonna che verrà aggiunta in futuro,
-- di default e per sempre. La scrittura resta chiusa (il grant è di sola lettura e
-- la policy "anon read settings" è for select).
--
-- SE LO ESEGUI COMUNQUE, SUBITO DOPO:
--   1) considera production_note pubblica finché non richiudi;
--   2) rimetti online un js/order.js che non faccia select("*") su settings;
--   3) riapplica QUESTA migration (è idempotente: revoke + grant per colonna);
--   4) verifica: `node test/security-assert.mjs --strict` — la riga
--      settings.production_note deve essere DENIED, non "1 rows".
--
-- Nota: anche supabase/migration-2026-06-25b-rollback.sql riapre questo stesso buco,
-- in modo ancora più largo (`grant all on all tables in schema public to anon`) e
-- senza dirlo nel nome. Se lo esegui, questa migration va rieseguita dopo.
-- ============================================================

begin;

-- 1) Via il grant di tabella: è quello che rende pubblica ogni colonna futura.
--    Revoca anche i grant per colonna eventualmente già presenti, così la
--    migration è idempotente e l'elenco sotto è l'unica fonte di verità.
revoke select on public.settings from anon;

-- 2) Sola lettura sulle colonne effettivamente usate dal codice pubblico.
--    Ogni colonna qui sotto ha un consumatore reale; se ne togli una, si rompe:
--      id                 -> filtro ?id=eq.1 di ogni query pubblica
--                            (js/order.js, js/footer-nap.js, index.html).
--                            In PostgreSQL serve il SELECT di colonna anche solo
--                            per referenziarla nella WHERE.
--      delivery_cost      -> js/order.js  (costo consegna nel totale)
--      min_order          -> js/order.js  (soglia ordine minimo)
--      max_advance_days   -> js/order.js  (quanti giorni futuri sono prenotabili)
--      slot_lead_minutes  -> js/order.js  (anticipo fascia, valore corrente)
--      slot_lead_hours    -> js/order.js  (fallback legacy dell'anticipo fascia)
--      opening_hours      -> js/order.js (orari ritiro) + index.html (orari home)
--      delivery_area      -> js/order.js  (poligono zona di consegna)
--      home_content       -> js/footer-nap.js + index.html (testi/immagini home).
--                            NON serve a js/order.js: è l'unica colonna pubblica
--                            che order.js non chiede.
--
--    Restano PRIVATE (nessun grant, quindi invisibili ad anon):
--      production_note    -> nota interna del titolare (tab Produzione)
--      wa_templates       -> testi dei messaggi WhatsApp del back office
--      cancel_lead_hours  -> letta solo server-side da cancel-order.js (service_role)
grant select (
  id,
  delivery_cost,
  min_order,
  max_advance_days,
  slot_lead_minutes,
  slot_lead_hours,
  opening_hours,
  delivery_area,
  home_content
) on public.settings to anon;

commit;

-- VERIFICA post-apply (deve restituire esattamente le 9 colonne sopra):
--   select column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'settings'
--      and grantee = 'anon' and privilege_type = 'SELECT'
--    order by column_name;
--
-- E dal lato client, con la anon key:
--   curl ".../rest/v1/settings?id=eq.1&select=production_note"  -> 401/permission denied
--   curl ".../rest/v1/settings?id=eq.1&select=*"                -> permission denied (atteso)
