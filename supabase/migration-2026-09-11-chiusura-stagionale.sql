-- ============================================================
-- 2026-09-11 — Chiusura stagionale.
--
-- COSA AGGIUNGE
--   settings.season_closed   boolean  -> interruttore: true = gelateria chiusa per la stagione.
--   settings.season_message  jsonb    -> testo del box di saluto mostrato in home e sulla
--                                        pagina d'ordine. Forma: { "it": {"title","body"},
--                                        "en": {"title","body"} }. Campi vuoti/assenti ->
--                                        il client usa i default del dizionario (js/i18n.js,
--                                        chiavi closed.title / closed.body).
--
-- Con season_closed = true:
--   - index.html mostra il box e nasconde tutto tranne contatti, orari e footer;
--   - ordina.html sostituisce l'ordine con lo stesso box;
--   - create-checkout.js e create-order-unpaid.js rifiutano con 409 (blocco vero: il client
--     è solo presentazione, chiunque può POSTare sulle function a mano).
--
-- GRANT — le due colonne sono PUBBLICHE per scelta: le legge il sito anonimo.
-- Vedi migration-2026-08-01c-settings-column-grants.sql: su settings il ruolo anon NON ha più
-- il select di tabella, quindi una colonna nuova nasce privata e va concessa a mano. Senza il
-- grant qui sotto il sito riceve 42501 e la home non carica più i contenuti.
--
-- ⚠️ ORDINE DI APPLICAZIONE OBBLIGATORIO — QUESTA MIGRATION PRIMA DEL DEPLOY DEL JS.
-- È l'inverso della 08-01c (che revocava): qui si aggiungono colonne che il nuovo
-- js/order.js e index.html mettono nella select list. Se il JS va online prima, la query
-- pubblica cita una colonna inesistente (42703 column does not exist) e la pagina d'ordine
-- smette di caricare il menù. Sequenza corretta:
--   1) esegui questa migration  ->  2) verifica (query in fondo)  ->  3) git push del JS.
-- Il codice vecchio ancora in cache non cita le colonne nuove: continua a funzionare.
--
-- ROLLBACK (riporta il sito allo stato "sempre aperto"):
--   update public.settings set season_closed = false where id = 1;
-- Le colonne si possono lasciare: sono additive e inerti con season_closed = false.
-- Per rimuoverle davvero (solo se si abbandona la feature, DOPO aver tolto il JS che le legge):
--   alter table public.settings drop column season_message;
--   alter table public.settings drop column season_closed;
-- ============================================================

begin;

alter table public.settings add column if not exists season_closed  boolean not null default false;
alter table public.settings add column if not exists season_message jsonb;

comment on column public.settings.season_closed  is 'true = chiusura stagionale attiva: box di saluto in home, ordini bloccati (client + function).';
comment on column public.settings.season_message is 'Testo del box di chiusura: {"it":{"title","body"},"en":{"title","body"}}. Vuoto = default del dizionario i18n.';

-- Pubbliche: le legge il sito anonimo (index.html + js/order.js).
grant select (season_closed, season_message) on public.settings to anon;

commit;

-- VERIFICA post-apply — deve elencare season_closed e season_message:
--   select column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'settings'
--      and grantee = 'anon' and privilege_type = 'SELECT'
--      and column_name in ('season_closed','season_message');
--
-- E con la anon key (deve rispondere 200 con season_closed = false):
--   curl ".../rest/v1/settings?id=eq.1&select=season_closed,season_message"
