# CLAUDE.md — Gelato Delivery

Web app statica (HTML/CSS/JS vanilla) + Supabase, deploy Netlify (sito `gelato26`, publish = root).
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
const { webkit } = require('playwright');
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport:{width:393,height:852}, deviceScaleFactor:3, isMobile:true });
await ctx.addInitScript(() => { try{ sessionStorage.setItem('gelato_admin','1'); }catch(e){} }); // login admin
const page = await ctx.newPage();
await page.goto('http://localhost:8080/admin.html', { waitUntil:'networkidle' });
await page.click('.tab[data-tab="slots"]');
// overflow orizzontale = bug:
await page.evaluate(() => ({ over: document.scrollingElement.scrollWidth - innerWidth }));
// e per trovare il colpevole: elementi con getBoundingClientRect().right > innerWidth
```
Larghezze da testare: **360 / 375 / 393 / 430**. Il binario WebKit resta in `~/Library/Caches/ms-playwright`.

### Gotcha WebKit noti
- **Input (`type=number`/`text`) dentro un flex**: hanno una larghezza intrinseca (max-content) grande (~200px)
  che su WebKit **risale** attraverso un wrapper `inline-flex` con `flex-shrink:0` (dimensionato sul max-content),
  gonfiandolo e causando overflow orizzontale **invisibile in Blink**. Fix: `max-width` esplicito sull'input
  (+ `min-width:0` sul wrapper). Vedi `.slotmax input` in `styles.css`.
- `min-width:0` da solo NON basta se il flex item ha `flex-shrink:0`: la dimensione è guidata dal max-content,
  serve un cap esplicito (`max-width`/`width`).

---

## Convenzioni layout mobile back office (`@media (max-width:560px)`)
- Righe di gestione (`.mrow`): tutto su **una sola riga**, niente wrap. Campo orario/"fascia" a **larghezza
  fissa piccola** (124px); MAX compatto; toggle senza etichetta (lo stato è il colore); ✕.
- Padding laterale ridotto (13px) + `body.admin{ overflow-x:clip }` (NON `overflow:hidden`: romperebbe lo sticky).
- Back office nasce desktop-first → il mobile va **sempre** verificato in WebKit prima del deploy.

---

## Deploy — procedura verificata (2026-06-10)

**Deploy = `git push origin main`. Basta quello.** Il sito Netlify (`siteId 7b526eaa-821f-4d12-b4aa-b8149a1d68ef`,
repo **privato** `github.com/vla-sys/gelato-delivery`) è **git-connected**: ogni push su `main` fa partire il
build di produzione in automatico. Verificato: codice live su prod **~15s** dopo il push.

- **NON serve** `netlify deploy --prod` (e in questo ambiente la CLI Netlify **non è installata/autenticata** →
  non tentarla, `netlify login` richiede browser). Lo step CLI nel vecchio runbook era ridondante.
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

## Sicurezza (debito noto, scelta consapevole)
RLS Supabase permissiva (`using(true)`) → la anon key pubblica legge/scrive tutto, PII clienti incluse; login admin
client-side (`ADMIN_PASSWORD`) = cosmetico. Hardening (RLS ristretta + Supabase Auth) rimandato dall'owner.

## Stampa ordini — Epson TM-m30III (Server Direct Print)
La stampante (in gelateria, su rete) polla `/.netlify/functions/epson-sdp` ogni ~15s e stampa lo scontrino di
ogni ordine pagato. Niente browser nel percorso: funziona anche a back office chiuso.

- **Coda**: tabella `print_jobs` (pending→printing→done|error) + RPC `claim_print_job` — claim atomico
  `FOR UPDATE SKIP LOCKED`, invariante **1 solo job `printing`** (→ correlazione SetResponse deterministica anche
  senza `printjobid`), reclaim 5min con cap, alert Telegram dopo 3 retry falliti. Migration
  `supabase/migration-2026-06-21-print-jobs.sql`.
- **Trigger auto**: `stripe-webhook.js` accoda un `print_jobs` dopo l'insert ordine (best-effort, come Telegram).
- **Ristampa manuale**: bottone 🖨️ in `admin.js` (`renderActions`) → `sb.from('print_jobs').insert({order_id})`
  (RLS: anon solo INSERT).
- **Endpoint** `netlify/functions/epson-sdp.js`: `GetRequest`→ePOS-Print XML (builder `lib/receipt.js`, 80mm/48col,
  escape-at-emit); `SetResponse`→esito. Auth **fail-closed** via `EPSON_SDP_ID`. **Risponde sempre 200** alla
  stampante (un non-200 la fa ri-POSTare all'infinito).
- **Web Config stampante**: Server Direct Print *Enable* · URL `…/.netlify/functions/epson-sdp` · ID = `EPSON_SDP_ID`
  · Interval 15 · Server Authentication *Disable* · URL Encode *Enable*. (ePOS-Print **non** serve per SDP.)
- **Da verificare sul firmware**: accettazione `PrintRequestInfo Version="2.00"` (per `printjobid`); se no → fallback
  v1.00 (l'invariante 1-printing rende sicura la correlazione comunque).
- Spec completo (locale, untracked, 404 sul sito): `docs/superpowers/specs/2026-06-21-epson-tm30iii-server-direct-print-design.md`.

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
