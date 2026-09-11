# CLAUDE.md — Gelato Delivery

Web app statica (HTML/CSS/JS vanilla) + Supabase, deploy Netlify (sito `gelato26`, publish = root).
Domini prod (dal 2026-06-25): `www.gelateriamontepetrosu.it` (primary) + apex `gelateriamontepetrosu.it` (→ redirect www) + `admin.gelateriamontepetrosu.it` (serve `admin.html` alla root via rewrite host-based in `netlify.toml`). `gelato26.netlify.app` resta attivo (URL canonico di verifica).
Due interfacce: `index.html` + `js/order.js` (cliente, mobile-first) · `admin.html` + `js/admin.js` (back office, desktop-first).
Stile in `css/styles.css` — design system "artigianale" (avorio + terracotta, Cormorant Garamond + Hanken Grotesk).

---

## ⚠️ Testare il mobile su iOS — OBBLIGATORIO prima di ogni fix mobile

**Chrome headless (Blink) NON riproduce i bug di layout di Safari (WebKit).** Più volte un layout risultava
perfetto in headless ma rotto su iPhone. Per qualsiasi modifica mobile/iOS, verificare nel **motore reale di
Safari** con **Playwright WebKit**.

Setup (in una dir FUORI dal repo — es. `/tmp` — così `node_modules` non finisce nel deploy):
```bash
npm i -D playwright && npx playwright install webkit
```
Script tipo:
```js
import { webkit } from 'playwright';
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport:{width:393,height:852}, deviceScaleFactor:3, isMobile:true });
await ctx.route(/supabase\.(co|com)/, r => r.abort());   // MAI toccare il DB di produzione da un test
const page = await ctx.newPage();
await page.goto('http://localhost:8099/admin.html', { waitUntil:'domcontentloaded' });
await page.evaluate(() => {
  // il login e' Supabase Auth reale: senza password si mostra solo la app.
  // #gate-wrap si nasconde via style, #app e' nascosto da una CLASSE (non dall'attributo hidden).
  document.getElementById('gate-wrap').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
  // cambiare tab a mano: il pannello resta .hidden finche' non si toglie la classe
  document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'));
  document.getElementById('tab-produzione').classList.remove('hidden');
});
```
⚠️ **`sessionStorage.setItem('gelato_admin','1')` non bypassa piu' niente** (obsoleto dal lockdown del
2026-06-25: `admin.js` usa `signInWithPassword`).

⚠️ **Le variabili di stato di `admin.js` non sono iniettabili**: `FLAVORS_ALL`, `SETTINGS` ecc. sono dichiarate
con `let` a livello di script, quindi **non** sono proprieta' di `window` e `window.FLAVORS_ALL = [...]` crea
un'altra variabile che nessuno legge. Le *function declaration* invece finiscono su `window`: per avere righe
vere si chiama direttamente il builder, es. `document.getElementById('prod-list').appendChild(buildProdRow({...}))`.
Conseguenza: cio' che dipende dallo stato globale (i totali di `updateProdStats`) **non** si puo' esercitare
da fuori — va provato a mano nel back office.

Larghezze da testare: **360 / 375 / 393 / 430**. Il binario WebKit resta in `~/Library/Caches/ms-playwright`.

### Misurare l'overflow: il check classico non basta
```js
document.scrollingElement.scrollWidth - innerWidth      // > 0 = overflow di PAGINA
```
Intercetta solo l'overflow che allarga il documento. **Non vede** il testo che sborda *dentro* una riga e
finisce sopra un altro elemento: li' `scrollWidth - innerWidth` resta **0** mentre il difetto c'e'.
Successo il 2026-08-01 con `.pname` nella tab Produzione.

Per quel caso servono le geometrie degli elementi, ma attenzione al tranello inverso:
`Range.getBoundingClientRect()` sul nodo di testo restituisce l'estensione del testo **come se non fosse
ritagliato**, quindi con `overflow:hidden` segnala una sovrapposizione che a schermo non esiste (falso positivo,
preso anche questo il 2026-08-01).

Regola pratica: confrontare i **box** (`el.getBoundingClientRect()`) degli elementi adiacenti, e **chiudere
sempre con uno screenshot** (`locator.screenshot()`) da guardare davvero. Su questa classe di difetti solo
l'immagine e' decisiva.

⚠️ Un harness che misura **zero elementi** stampa "nessun problema": far **fallire** lo script se il numero di
elementi misurati e' 0 o se i rettangoli sono tutti a 0 (elemento non renderizzato). Tre falsi verdi di fila
il 2026-08-01 sono nati cosi'.

### Gotcha WebKit noti
- **Input (`type=number`/`text`) dentro un flex**: hanno una larghezza intrinseca (max-content) grande (~200px)
  che su WebKit **risale** attraverso un wrapper `inline-flex` con `flex-shrink:0` (dimensionato sul max-content),
  gonfiandolo e causando overflow orizzontale **invisibile in Blink**. Fix: `max-width` esplicito sull'input
  (+ `min-width:0` sul wrapper). Vedi `.slotmax input` in `styles.css`.
- `min-width:0` da solo NON basta se il flex item ha `flex-shrink:0`: la dimensione è guidata dal max-content,
  serve un cap esplicito (`max-width`/`width`).

---

## ⚠️ `flavors` è stato di lavoro vivo, non configurazione
`prod_on` / `prod_kg` / `prod_order` sono i gusti che la gelateria **sta producendo oggi** e per quanti kg.
Non scriverci mai per provare qualcosa, e non eseguire il Reset produzione: cancella una decisione operativa
che non si ricostruisce dal codice, e Postgres non tiene storico delle righe. Prima di lavorare sulla tab
Produzione, salvarsi uno snapshot in sola lettura. Per provare comportamenti di scrittura: dati sintetici in
locale, oppure `begin … rollback` con verifica che il valore sia tornato indietro.

## Convenzioni layout mobile back office (`@media (max-width:560px)`)
- Righe di gestione (`.mrow`): tutto su **una sola riga**, niente wrap. Campo orario/"fascia" a **larghezza
  fissa piccola** (124px); MAX compatto; toggle senza etichetta (lo stato è il colore); ✕.
- Padding laterale ridotto (13px) + `body.admin{ overflow-x:clip }` (NON `overflow:hidden`: romperebbe lo sticky).
- Back office nasce desktop-first → il mobile va **sempre** verificato in WebKit prima del deploy.

---

## Deploy — procedura verificata (2026-06-10)

**Deploy = `git push origin main`. Basta quello.** Il sito Netlify (`siteId 7b526eaa-821f-4d12-b4aa-b8149a1d68ef`,
repo **privato** `github.com/gelateriamonte/gelato-delivery`) è **git-connected**: ogni push su `main` fa partire il
build di produzione in automatico. Verificato: codice live su prod **~15s** dopo il push.

> **Migrazione stack (2026-06-25):** repo spostato `vla-sys` → **`gelateriamonte/gelato-delivery`** (Netlify ricollegato, resta di Vla); Supabase migrato a **nuovo progetto `rlrsyqmwtjfyuqkgzqso`** (region eu-west-1; url/anon in `config.js`, service_role in env Netlify). Vecchi `vla-sys` + Supabase `hsnikgbwsggusqlanwmt` (eu-central-1) tenuti come backup, da dismettere. Se il `git remote origin` locale punta ancora a `vla-sys`, ripuntalo al nuovo repo per i deploy.

- **NON serve** `netlify deploy --prod`. Aggiornamento 2026-07-18: la CLI Netlify ora **è installata e
  autenticata** (utente vla@habenas.it, progetto linkato `gelato26`) — utile per leggere env (`netlify env:list`),
  ma il deploy resta solo `git push`.
- ⚠️ **MCP Supabase: non usarlo, è cieco su questo progetto** (verificato 2026-08-01). Il progetto di produzione
  `rlrsyqmwtjfyuqkgzqso` sta sull'account **`admin@gelateriamontepetrosu.it`** (org `zyhtpxtsxddkjioyggya`), mentre
  il connettore è autorizzato sull'account **Habenas** (org `tcpeyxbptgbwabehlffk`, che contiene solo il vecchio
  progetto `hsnikgbwsggusqlanwmt`). `list_projects` non vede affatto la produzione e ogni chiamata dà
  `-32600 permission denied`; `/mcp` → reconnect **non** risolve, riconnette alla stessa autorizzazione.
  Percorso che funziona: `supabase login --token <PAT>` (il flusso interattivo fallisce sotto Claude Code perché
  non-TTY) e poi SQL via Management API:
  ```bash
  curl -s -X POST "https://api.supabase.com/v1/projects/rlrsyqmwtjfyuqkgzqso/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"select 1;"}'
  ```
- **Cosa viene pubblicato:** `publish="."` serve la **checkout CI del repo** → vanno online **solo i file
  git-tracked**. Quindi `.gitignore` controlla cosa è pubblico (esclusi: `*.zip`, `Loghi/`, `.netlify`,
  `node_modules`, `.env`, `.DS_Store`). I file **untracked** (jpg sciolti in root, `docs/AUDIT-*.md`) **non**
  vengono deployati dal push. → La vecchia nota "spostare `Gelato26.zip` fuori dal publish dir" è **obsoleta**
  (gli zip sono gitignored; era necessaria solo per `netlify deploy --dir=.` che caricava anche gli untracked).
- ⚠️ **`publish="."` servirebbe OGNI file tracked** (anche SQL/doc). Mitigazione attiva: `netlify.toml` ha redirect
  `force=true`→404 per `/supabase/*`, `/docs/*`, `/CLAUDE.md`, `/SPEC.md`, `package.json`, `package-lock.json`,
  `jsconfig.json`, `eslint.config.mjs`, `netlify.toml`. **Aggiungere lì ogni nuovo path sorgente non-asset.** Fix
  "vero" futuro = **F-DEPLOY** (`publish="public"` con soli asset). Audit/junk locali in `_archive/` (gitignored).
- **Verifica deploy:** `curl -s https://gelato26.netlify.app/js/<file> | grep <simbolo-nuovo>` (~15-60s).
- Env prod (già configurate, usate da function): `STRIPE_SECRET_KEY/WEBHOOK_SECRET`, `SUPABASE_URL/SERVICE_ROLE_KEY`,
  `ANTHROPIC_API_KEY`, `ADMIN_UPLOAD_TOKEN`, `TELEGRAM_BOT_TOKEN/CHAT_ID`, `EPSON_SDP_ID` (segreto condiviso stampa
  ordini: deve combaciare col campo *ID* nel Web Config della stampante). Le function girano solo su prod/`netlify dev`,
  non su file statico aperto in locale.
  ⚠️ Settare un'env via Netlify MCP col flag *secret* NON persiste (bug noto): usare non-secret + rileggere con
  `getAllEnvVars`; una env nuova entra nel runtime delle function solo dopo un **redeploy** (commit vuoto).
- Commit: conventional commits, chiudi con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Sicurezza — RLS lockdown + Supabase Auth (hardening 2026-06-25, debito chiuso)
RLS Supabase ora **ristretta** (prima era `using(true)` permissiva = anon leggeva/scriveva tutto, PII incluse):
- **Catalogo** (`flavors`,`formats`,`time_slots`,`slot_day_state`,`settings`): anon **solo SELECT**; scrittura solo `authenticated`.
- `orders`,`discount_codes`,`print_jobs`,`pending_orders`: **nessun accesso anon**. L'admin opera come ruolo `authenticated` (policy `auth all *`); il checkout pubblico passa solo dalle function service-role.
- Pre-check pubblici via 2 RPC `SECURITY DEFINER` (no PII, girano come owner → bypassano RLS): `rpc_slot_availability(date)`, `rpc_coupon_precheck(code,phone,email)` (specchio di `create-checkout.js`). Migration: `supabase/migration-2026-06-25a-auth-rpc-additive.sql` (policy+RPC) + `-25b-rls-lockdown.sql` (+ `-25b-rollback.sql`).
- **Back office = Supabase Auth reale**: `ADMIN_PASSWORD` client-side **rimosso**, `admin.js` usa `signInWithPassword`. Utente unico `admin@gelateriamontepetrosu.it`.
- ⚠️ **`authenticated` ≡ admin regge SOLO con signup pubblico DISABILITATO** (Supabase → Auth). Non riattivare la registrazione pubblica, o chiunque si registra ottiene accesso admin.
- **Utente di prova** `prova@gelateriamontepetrosu.it` (creato 2026-08-01) per collaudare il back office da
  agente. Ha accesso **pieno** come ogni utente autenticato: non esiste un ruolo di sola lettura. Credenziali
  in `~/.config/gelato-admin/env` (chmod 600, fuori dal repo). Revoca: Supabase → Authentication → Users.
- ⚠️ **Creare un utente auth via SQL**: `auth.users` accetta l'insert, ma GoTrue rifiuta il login con
  `Database error querying schema` finché `confirmation_token`, `recovery_token`, `email_change`,
  `email_change_token_new` (e simili) restano **NULL** invece di stringa vuota — il driver Go non sa
  scansionare NULL in una stringa. Serve anche la riga corrispondente in `auth.identities`
  (`provider='email'`, `provider_id=email`, `identity_data` con `sub` ed `email`). La via supportata resta
  il pannello (Authentication → Add user → Auto Confirm).
- Verifica: `node test/security-assert.mjs` (o curl con anon key) → `orders`/`discount_codes` devono dare **401**; catalogo + RPC restano ok; login admin ok.

### Grant per COLONNA sul catalogo (2026-08-01) — regola da rispettare sempre
Fino ad allora `anon` aveva `grant select` di **tabella** su `settings`/`flavors`/`formats`/`time_slots`/
`slot_day_state`, e `js/order.js` faceva `select("*")`: **ogni colonna nuova nasceva pubblica**. È già costato due
fughe reali — `production_note` (nota interna del titolare) e i campi del piano di produzione
`prod_on`/`prod_kg`/`prod_order`/`prod_base_ratio`, leggibili con la sola anon key.

Ora il default è invertito (`migration-2026-08-01c` e `-01d`): `anon` ha `grant select (colonne)` solo su quelle
pubbliche. **Una colonna nuova nasce privata**: per esporla serve un `grant select (colonna)` esplicito.

Conseguenze operative, non negoziabili:
- **Mai `select("*")` dal codice pubblico** su queste tabelle: elencare le colonne. Un `select=*` da `anon` ora
  risponde `42501 permission denied`.
- PostgreSQL pretende il SELECT di colonna anche per le colonne usate **solo** in `WHERE`/`ORDER BY`: `available`
  e `sort_order` stanno nel grant pur non essendo nella select list. Se aggiungi un filtro, controlla il grant.
- **Ordine di deploy obbligatorio**: prima va online il JS con le colonne esplicite, **poi** si applica il grant.
  Invertendo, il codice live continua a chiedere `select("*")` e la pagina d'ordine smette di caricare.
- Le Netlify Functions non sono toccate (service_role bypassa grant e RLS); il back office opera come
  `authenticated` e mantiene accesso pieno.

## Chiusura stagionale (2026-09-11)
Interruttore `settings.season_closed` (bool) + testo `settings.season_message`
(`{it:{title,body}, en:{title,body}}`). Back office → tab **Parametri** → *Chiusura stagionale*:
il toggle fa **auto-save con conferma** (un toggle "da salvare" e' il modo per credere il sito chiuso
mentre accetta ancora ordini); il testo ha un bottone suo e si auto-traduce in EN riusando
`netlify/functions/translate-home.js` (accetta chiavi arbitrarie, non solo quelle della home).
Campi vuoti -> default dal dizionario (`js/i18n.js`, chiavi `closed.*`).

Tre livelli, non uno:
- `js/season-closed.js` (incluso su `index`, `ordina`, `consegna-a-domicilio`, `grazie`,
  `informazioni`): riempie e mostra `#closed-box`, nasconde `[data-closed-hide]`, spegne i link a
  `/ordina`. Li spegne **due volte**: sostituzione con `<span>` *e* una regola CSS iniettata, perche'
  il footer NAP viene riscritto dopo da `footer-nap.js` e da ogni cambio lingua di i18n.
  `killOrderLinks` salta gli elementi `[data-closed-hide]`: sostituirli con uno `<span>` senza
  `display:none` li farebbe ricomparire come testo.
- `js/order.js`: esce da `loadData()` e nasconde la shell **da solo**, senza dipendere dal file sopra
  (se quella fetch fallisse, la pagina d'ordine resterebbe visibile ma morta).
- `create-checkout.js` / `create-order-unpaid.js`: **409**. E' l'unico blocco vero: sono endpoint
  pubblici, il resto e' presentazione.

⚠️ **Deploy: la migration PRIMA del push del JS** (`supabase/migration-2026-09-11-chiusura-stagionale.sql`).
E' l'inverso della 08-01c: li' si revocava, qui si **aggiungono** colonne che il JS nuovo mette nella
select list pubblica. Se il JS va online per primo, la query cita colonne inesistenti (42703) e la
pagina d'ordine non carica piu' il menu'. Le due colonne sono pubbliche di proposito
(`grant select (season_closed, season_message) on public.settings to anon`), per la regola del grant
per colonna: una colonna nuova nasce privata.

## Stampa ordini — Epson TM-m30III (Server Direct Print)
La stampante (in gelateria, su rete) polla `/.netlify/functions/epson-sdp` ogni ~15s e stampa lo scontrino di
ogni ordine pagato. Niente browser nel percorso: funziona anche a back office chiuso.

- **Coda**: tabella `print_jobs` (pending→printing→done|error) + RPC `claim_print_job` — claim atomico
  `FOR UPDATE SKIP LOCKED`, invariante **1 solo job `printing`** (→ correlazione SetResponse deterministica anche
  senza `printjobid`), reclaim 5min con cap, alert Telegram dopo 3 retry falliti. Migration
  `supabase/migration-2026-06-21-print-jobs.sql`.
- **Trigger auto**: `stripe-webhook.js` accoda un `print_jobs` dopo l'insert ordine (best-effort, come Telegram).
- **Ristampa manuale**: bottone 🖨️ in `admin.js` (`renderActions`) → `sb.from('print_jobs').insert({order_id})`.
- **Tre `kind`**, tutti sullo stesso binario: `order` (dall'ordine, via `order_id`), `production` (checklist gusti)
  e `note` (nota libera del back office, dal 2026-08-01) — gli ultimi due senza `order_id`, con il testo in
  `payload` e un builder dedicato in `lib/receipt.js` (`buildProductionXml`, `buildNoteXml`).
- ⚠️ In `lib/receipt.js` si lavora su stringhe **raw** e si fa l'escape XML **una volta sola all'emissione**:
  padding e troncamento contano i caratteri visibili. Chi mette una trasformazione dentro `esc()` falsa
  l'allineamento a 48 colonne. I caratteri di controllo C0 (vietati da XML 1.0, arrivano incollando da PDF)
  si tolgono **all'ingresso** dei builder, prima del layout.
- ⚠️ `wrap()` **tronca** le parole più lunghe della riga, non le spezza (per gli scontrini ordine è voluto). Per
  la nota si passa da `splitLongWords()`, altrimenti un URL o un IBAN esce mozzato e sembra completo.
- **Endpoint** `netlify/functions/epson-sdp.js`: `GetRequest`→ePOS-Print XML (builder `lib/receipt.js`, 80mm/48col,
  escape-at-emit); `SetResponse`→esito. Auth **fail-closed** via `EPSON_SDP_ID`. **Risponde sempre 200** alla
  stampante (un non-200 la fa ri-POSTare all'infinito).
- **Web Config stampante**: Server Direct Print *Enable* · URL `…/.netlify/functions/epson-sdp` · ID = `EPSON_SDP_ID`
  (campo ID **max 30 char**, charset `A-Za-z0-9 _ . -` → tenere il segreto ≤30) · Interval 15 ·
  Server Authentication *Disable* · URL Encode *Enable*. (ePOS-Print **non** serve per SDP.)
- **Firmware (verificato 2026-06-21)**: la stampante monta **TM-i fw 1.39**. `printjobid` / `PrintRequestInfo
  Version="2.00"` sarebbero "ufficiali" solo da TM-i fw ≥4.1, ma **fw 1.39 accetta comunque** il wrapper v2.00
  (ignora il `printjobid`) e stampa: loop completo provato su hardware reale (GetRequest→stampa→SetResponse→`done`).
  La correlazione non dipende dal printjobid (invariante 1-printing) → nessun fallback v1.00 necessario.
  **Aggiornamento firmware RIMANDATO** (scelta owner): non serve, flash POS = rischio/downtime per zero guadagno.
  Se in futuro si aggiorna: annotare i campi SDP, re-inserirli, test-print di verifica subito dopo.
- Spec completo (locale, untracked, 404 sul sito): `docs/superpowers/specs/2026-06-21-epson-tm30iii-server-direct-print-design.md`.

## Test

```bash
node --test "test/*.test.mjs"     # con le VIRGOLETTE: node --test test/ su Node v25 risolve
                                  # la directory come modulo e muore con MODULE_NOT_FOUND
```
In `package.json` **non** esiste uno script `test`.

⚠️ **Un rosso è preesistente e non correlato**: `test/legal-info-page.test.mjs:11` pretende
`href="informazioni.html"` mentre `index.html` usa il clean URL `/informazioni`. Baseline attesa: **38/39**.
Da decidere se allineare il test o il link — non è una regressione.

`test/security-assert.mjs` **interroga il database di produzione** e non fa parte del glob (non finisce in
`.test.mjs`): eseguirlo solo di proposito.

## Loop protocol

Ogni task è un loop, non una linea:
1. Scrivi la modifica.
2. Gira il check: `npm run lint` (ESLint — gate). Se tocchi `netlify/functions/` (pagamenti) gira anche `npm run typecheck`.
3. Se fallisce: leggi l'errore, fixa la CAUSA, torna al punto 2.
4. Max 5 iterazioni.

Stop:
- lint verde → "done" con output `eslint` come prova.
- 5 tentativi → fermati, riporta cosa fallisce e cosa hai provato.
- Stesso errore 2 volte di fila → fermati, stai indovinando → invoca @fixer.

Mai "done" senza output di check di QUESTA sessione.
Mai far passare un check indebolendolo: no `eslint-disable`, no `@ts-ignore`, no `catch{}` che inghiotte un errore nuovo. Fixa la causa.

### Typecheck (codice pagamenti) — GATE
`npm run typecheck` = `tsc --checkJs` scoped a `netlify/functions/`. È un gate dello Stop hook insieme a eslint: typecheck verde richiesto per "done". Becca bug di tipo sul codice Stripe/Supabase (narrowing di `session.payment_intent` / `latest_charge`, costruttori SDK, ecc.).
Prima di ogni deploy delle functions: `npm run typecheck` DEVE essere verde (girano soldi).
