-- ============================================================
-- 2026-08-01d — Grant per COLONNA sulle tabelle di CATALOGO per il ruolo anon:
-- flavors, formats, time_slots, slot_day_state.
-- (Il nome del file dice "flavors" perché flavors è la falla che l'ha fatta
--  nascere, ma il difetto è di classe: si chiude su tutto il catalogo insieme.
--  settings è già stata trattata dalla 2026-08-01c.)
--
-- PERCHE'
-- Stessa falla di settings, aperta identica sul resto del catalogo. Anon aveva
-- `grant select` sull'INTERA tabella (migration-2026-06-25b-rls-lockdown.sql,
-- punto 3). Conseguenza: ogni colonna aggiunta a una di queste tabelle diventa
-- PUBBLICA per default, senza che nessuno decida.
-- E' già successo su flavors: i campi del piano di produzione (`prod_on`,
-- `prod_kg`, `prod_order`, aggiunti con migration-2026-06-25c-produzione.sql,
-- più il nuovissimo `prod_base_ratio` di migration-2026-08-01b-base-per-kg.sql)
-- venivano serviti a ogni visitatore della pagina d'ordine, perché js/order.js
-- faceva `select("*")` su flavors. Verificato in produzione con la sola anon key
-- pubblica: la risposta esponeva il piano di produzione del giorno e il rapporto
-- base/kg, che è un parametro di ricetta e di costo. prod_on/prod_kg/prod_order
-- erano pubblici da giugno; prod_base_ratio si è esposta da sé oggi, senza che
-- nessuno lo decidesse. E' esattamente il punto: il difetto non è la singola
-- colonna, è il grant di tabella che rende pubblico tutto il futuro.
--
-- LA REGOLA GENERALE CHE QUESTA MIGRATION INSTAURA
-- Anon perde il SELECT di TABELLA su tutto il catalogo e riceve il SELECT solo
-- sulle colonne che il sito pubblico usa davvero. Da qui in poi, su flavors,
-- formats, time_slots, slot_day_state (e settings, via 01c), OGNI COLONNA NUOVA
-- NASCE PRIVATA: per esporla serve un `grant select (colonna)` esplicito, cioè
-- una decisione consapevole di qualcuno. Aggiungere una colonna non è più un
-- atto di pubblicazione.
-- Corollario per chi aggiungerà colonne domani: se il sito pubblico ne ha
-- bisogno, il grant va aggiunto QUI, nella lista della tabella giusta, e la
-- colonna va aggiunta alla select esplicita in js/order.js. Se al sito pubblico
-- non serve, non si tocca niente e la colonna resta invisibile ad anon.
--
-- La RLS non cambia: le policy "anon read <tabella>" (for select using(true))
-- restano attive. RLS decide QUALI RIGHE, i grant per colonna QUALI COLONNE.
-- I due livelli sono complementari: senza grant di colonna la policy non basta.
--
-- Le Netlify Functions non sono toccate: girano con la service_role key, che
-- bypassa RLS e grant. Il back office opera come ruolo `authenticated` e
-- mantiene l'accesso pieno (tab Produzione compresa).
--
-- ⚠️ AVVERTENZA — ORDINE DI APPLICAZIONE OBBLIGATORIO ⚠️
-- Applicare questa migration SOLO DOPO che il nuovo js/order.js (quello con le
-- colonne esplicite al posto di select("*")) è ONLINE su produzione e verificato.
-- Se la si applica prima, il sito live continua a chiedere `select=*` su flavors,
-- formats e time_slots e PostgreSQL risponde `permission denied for table ...`
-- (42501): la pagina d'ordine non carica più il menù. Sequenza corretta:
--   1) git push del nuovo js/order.js  →  2) verifica che sia live:
--      curl -s https://gelato26.netlify.app/js/order.js | grep 'id,label,active,max_deliveries'
--   3) solo allora esegui questa migration.
--
-- ROLLBACK (se qualcosa va storto, ri-concede le sole colonne pubbliche):
--   revoke select on public.flavors, public.formats, public.time_slots,
--                    public.slot_day_state from anon;
--   grant select (name, available, daily, description, description_en, sort_order)
--     on public.flavors to anon;
--   grant select (id, name, price, max_flavors, category, weight_kg, available, sort_order)
--     on public.formats to anon;
--   grant select (id, label, active, max_deliveries, sort_order)
--     on public.time_slots to anon;
--   grant select (slot_id, day, active) on public.slot_day_state to anon;
--   -- NON usare `grant select on public.<tabella> to anon`: il grant di TABELLA
--   -- riesporrebbe ad anon i campi prod_* (prod_on, prod_kg, prod_order,
--   -- prod_base_ratio), cioè esattamente la falla che questa migration chiude.
-- ============================================================

begin;

-- 1) Via il grant di TABELLA: è quello che rende pubblica ogni colonna futura.
--    Revoca anche i grant per colonna eventualmente già presenti, così la
--    migration è idempotente e gli elenchi sotto sono l'unica fonte di verità.
revoke select on
  public.flavors, public.formats, public.time_slots, public.slot_day_state
  from anon;

-- 2) FLAVORS — gusti.
--    Ogni colonna qui sotto ha un consumatore reale; se ne togli una, si rompe:
--      name           -> js/order.js:417 (chip gusto nel modale), :413/:420/:421
--                        (gusti salvati nel carrello per nome) e :535
--                        + index.html:427 (gusti del giorno in home)
--      daily          -> js/order.js:416-417 (badge ☀), :425 e :535 (blocco
--                        "solo per oggi") + index.html:427 (?daily=eq.true)
--      available      -> filtro ?available=eq.true di entrambe le query pubbliche
--                        (js/order.js:298, index.html:427). In PostgreSQL serve
--                        il SELECT di colonna anche solo per referenziarla nella
--                        WHERE, quindi va concessa anche se non è nella select.
--      sort_order     -> ?order=sort_order di entrambe le query pubbliche
--                        (js/order.js:298, index.html:427); stessa regola della
--                        WHERE: l'ORDER BY richiede il SELECT sulla colonna.
--      description    -> index.html:427 (microdescrizione IT del gusto del giorno)
--      description_en -> index.html:427 (microdescrizione EN). Queste due NON
--                        servono a js/order.js: sono le uniche colonne pubbliche
--                        che order.js non chiede (le usa solo la fetch grezza a
--                        /rest/v1/flavors della home, che non passa dal client
--                        Supabase).
--
--    Restano PRIVATE (nessun grant, quindi invisibili ad anon):
--      prod_on         -> piano di produzione: gusto da produrre oggi
--      prod_kg         -> piano di produzione: kg da produrre
--      prod_order      -> piano di produzione: ordine di lavorazione
--      prod_base_ratio -> base per kg: parametro di ricetta e di costo
--      special         -> flag "stellina", solo back office
--      id, created_at  -> nessun consumatore pubblico
grant select (
  name,
  available,
  daily,
  description,
  description_en,
  sort_order
) on public.flavors to anon;

-- 3) FORMATS — prodotti ordinabili.
--      id           -> js/order.js:394 (riaggancio del formato dal carrello) e
--                      :439 (format_id salvato nella riga di carrello)
--      name         -> js/order.js:350, :368, :440
--      price        -> js/order.js:352, :367, :446
--      max_flavors  -> js/order.js:345, :364, :414, :421, :436, :443
--      category     -> js/order.js:333 (normCat, raggruppamento Vaschette/Altro)
--                      e :441
--      weight_kg    -> js/order.js:442 (peso della vaschetta sulla riga d'ordine)
--      available    -> filtro ?available=eq.true (js/order.js:302) — SELECT di
--                      colonna richiesto dalla WHERE
--      sort_order   -> ?order=sort_order (js/order.js:302) — richiesto dall'ORDER BY
--    Resta PRIVATA: created_at (nessun consumatore pubblico).
grant select (
  id,
  name,
  price,
  max_flavors,
  category,
  weight_kg,
  available,
  sort_order
) on public.formats to anon;

-- 4) TIME_SLOTS — catalogo delle fasce orarie.
--      id             -> js/order.js:71 (chiave dell'override per-giorno)
--      label          -> js/order.js:50, :64, :318, :608, :646, :650
--      active         -> js/order.js:71 (default acceso/spento della fascia)
--      max_deliveries -> js/order.js:48, :651, :655 (capienza della fascia)
--      sort_order     -> ?order=sort_order (js/order.js:303) — richiesto
--                        dall'ORDER BY, anche se poi il JS riordina per orario
--    Resta PRIVATA: created_at (nessun consumatore pubblico).
grant select (
  id,
  label,
  active,
  max_deliveries,
  sort_order
) on public.time_slots to anon;

-- 5) SLOT_DAY_STATE — override acceso/spento di una fascia in un giorno.
--    Oggi la tabella ha SOLO queste tre colonne, quindi il grant per colonna non
--    toglie nulla ad anon: serve a instaurare la regola, così la prossima colonna
--    (una nota interna, un motivo di chiusura...) nasce privata invece di
--    pubblicarsi da sola.
--      slot_id -> js/order.js:589 (select) e :594 (chiave della mappa override)
--      active  -> js/order.js:589 (select) e :594 (valore dell'override)
--      day     -> filtro ?day=eq.<data> (js/order.js:589) — SELECT di colonna
--                 richiesto dalla WHERE
grant select (
  slot_id,
  day,
  active
) on public.slot_day_state to anon;

commit;

-- VERIFICA post-apply (deve restituire esattamente le colonne elencate sopra:
-- 6 per flavors, 8 per formats, 5 per time_slots, 3 per slot_day_state):
--   select table_name, column_name
--     from information_schema.column_privileges
--    where table_schema = 'public'
--      and table_name in ('flavors','formats','time_slots','slot_day_state')
--      and grantee = 'anon' and privilege_type = 'SELECT'
--    order by table_name, column_name;
--
-- E dal lato client, con la anon key (node test/security-assert.mjs li copre tutti):
--   curl ".../rest/v1/flavors?select=prod_base_ratio"  -> permission denied
--   curl ".../rest/v1/flavors?select=*"                -> permission denied (atteso)
--   curl ".../rest/v1/flavors?select=name,daily&available=eq.true&order=sort_order"  -> ok
--   curl ".../rest/v1/formats?select=id,name,price,max_flavors,category,weight_kg&available=eq.true&order=sort_order" -> ok
--   curl ".../rest/v1/time_slots?select=id,label,active,max_deliveries&order=sort_order" -> ok
