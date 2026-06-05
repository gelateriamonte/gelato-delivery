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

## Deploy
Tenere **GitHub main == Netlify prod**: `git push origin main` **e** `netlify deploy --prod --dir=.`.
Spostare `Gelato26.zip` fuori dal publish dir durante il deploy (materiale di design, non va pubblicato → 404 sul sito).

## Sicurezza (debito noto, scelta consapevole)
RLS Supabase permissiva (`using(true)`) → la anon key pubblica legge/scrive tutto, PII clienti incluse; login admin
client-side (`ADMIN_PASSWORD`) = cosmetico. Hardening (RLS ristretta + Supabase Auth) rimandato dall'owner.
