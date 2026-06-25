# Produzione Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spostare la navigazione del back office in una sidebar sinistra e aggiungere una sezione "Produzione" dove si seleziona/ordina/quantifica (kg) i gusti da produrre e si stampa la checklist sulla termica Epson.

**Architecture:** Web app statica vanilla (HTML/CSS/JS) + Supabase + Netlify Functions. La sezione Produzione riusa la tabella `flavors` (3 colonne additive: `prod_on`, `prod_kg`, `prod_order`) e l'infrastruttura di stampa esistente (`print_jobs` esteso con `kind`/`payload`, `epson-sdp`, `receipt.js`). Nessun nuovo servizio.

**Tech Stack:** HTML5, CSS3, JavaScript ES2021 (no framework, no build), Supabase JS v2, Netlify Functions (Node CommonJS), Epson ePOS-Print XML / Server Direct Print.

## Global Constraints

- Vanilla, niente build/bundler/framework. Seguire lo stile dei file esistenti.
- Gate ESLint: `npm run lint` deve essere verde (Stop hook). Mai indebolire (`eslint-disable`, `catch{}` vuoto).
- Gate typecheck (solo `netlify/functions/`): `npm run typecheck` (`tsc --checkJs`) verde per ogni modifica alle functions.
- Mobile back office va verificato in **Playwright WebKit** alle larghezze **360 / 375 / 393 / 430** prima del deploy (Chrome headless non riproduce i bug Safari). Vedi CLAUDE.md.
- Branch di lavoro: **`feature/produzione`** (già creato). **Niente push su `main`** senza "pusha" esplicito dell'owner.
- Supabase project `rlrsyqmwtjfyuqkgzqso`; anon key pubblica in `config.js`. **DDL (ALTER TABLE) va eseguita in Supabase → SQL editor** (il token `authenticated` del back office non fa DDL).
- RLS: `authenticated` ha già `auth all flavors` e `auth all print_jobs` (migration Fase A `-25a`) → update `prod_*` e insert job produzione funzionano senza modifiche RLS.
- Parametri prodotto: kg **1–8, step 1, default 3**; `prod_on` default **false**; quadratino di stampa = **`[ ]` ASCII** (non `☐` Unicode); termica **48 colonne**.
- Commit: conventional commits, chiusi con:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv
  ```

---

### Task 1: Migration additiva (schema flavors + print_jobs)

**Files:**
- Create: `supabase/migration-2026-06-25c-produzione.sql`

**Interfaces:**
- Produces: colonne `flavors.prod_on boolean`, `flavors.prod_kg int`, `flavors.prod_order int`; `print_jobs.kind text`, `print_jobs.payload jsonb`, `print_jobs.order_id` reso nullable.

- [ ] **Step 1: Scrivere il file migration**

```sql
-- ============================================================
-- 2026-06-25c — Sezione "Produzione" (back office)
-- flavors: stato produzione indipendente dal catalogo.
-- print_jobs: supporto a job di stampa non legati a un ordine.
-- Eseguire in Supabase: SQL editor → incolla → Run.
-- RLS: invariata. `authenticated` ha già auth-all su flavors e print_jobs (Fase A -25a).
-- ============================================================

-- flavors: stato produzione (indipendente da sort_order / available)
alter table flavors add column if not exists prod_on    boolean not null default false;
alter table flavors add column if not exists prod_kg    int     not null default 3 check (prod_kg between 1 and 8);
alter table flavors add column if not exists prod_order int     not null default 0;

-- ordine iniziale di produzione = ordine catalogo attuale (poi indipendente)
update flavors set prod_order = sort_order where prod_order = 0;

-- print_jobs: job di produzione (niente ordine, contenuto in payload)
alter table print_jobs add column if not exists kind    text not null default 'order';
alter table print_jobs alter column order_id drop not null;
alter table print_jobs add column if not exists payload jsonb;
```

- [ ] **Step 2: Applicare la migration in Supabase**

Aprire Supabase → progetto `rlrsyqmwtjfyuqkgzqso` → SQL editor → incollare il contenuto del file → Run. (Operazione manuale dell'owner: la DDL non passa dal client `authenticated`.)

- [ ] **Step 3: Verificare le colonne via SELECT (anon key)**

Run:
```bash
curl -s "https://rlrsyqmwtjfyuqkgzqso.supabase.co/rest/v1/flavors?select=name,prod_on,prod_kg,prod_order&limit=1" \
  -H "apikey: sb_publishable_FeopkZa7V-fLzx5fQerykQ_NVN_qVC3" \
  -H "Authorization: Bearer sb_publishable_FeopkZa7V-fLzx5fQerykQ_NVN_qVC3"
```
Expected: JSON con i campi `prod_on` (false), `prod_kg` (3), `prod_order` (>0) presenti — nessun errore `column ... does not exist`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-2026-06-25c-produzione.sql
git commit -m "$(printf 'feat(db): produzione columns on flavors + print_jobs kind/payload\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

### Task 2: `buildProductionXml` in receipt.js (+ test node)

**Files:**
- Modify: `netlify/functions/lib/receipt.js` (aggiunge funzione + export)
- Test: `test/production-receipt.test.mjs` (nuovo)

**Interfaces:**
- Produces: `buildProductionXml(list, createdAtIso)` → string (blocco `<epos-print>…</epos-print>`). `list` = `[{name, kg}]`; `createdAtIso` = ISO string (timestamp del job).
- Consumes: helper interni esistenti `WIDTH`, `esc`, `padLine`, `fmtDateTime`.

- [ ] **Step 1: Scrivere il test (fallisce)**

Create `test/production-receipt.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProductionXml } from "../netlify/functions/lib/receipt.js";

test("buildProductionXml: titolo, righe in ordine, checkbox ASCII, kg", () => {
  const xml = buildProductionXml(
    [{ name: "Pistacchio", kg: 3 }, { name: "Fiordilatte", kg: 8 }],
    "2026-06-25T10:00:00Z"
  );
  assert.match(xml, /^<epos-print /);
  assert.match(xml, /PRODUZIONE/);
  assert.ok(xml.includes("[ ] Pistacchio"), "riga pistacchio col quadratino");
  assert.ok(xml.includes("[ ] Fiordilatte"), "riga fiordilatte col quadratino");
  assert.ok(xml.includes("3 kg") && xml.includes("8 kg"), "kg presenti");
  // ordine: Pistacchio prima di Fiordilatte
  assert.ok(xml.indexOf("Pistacchio") < xml.indexOf("Fiordilatte"), "ordine preservato");
  assert.match(xml, /<cut /, "taglio finale");
});

test("buildProductionXml: lista vuota stampa solo intestazione (no crash)", () => {
  const xml = buildProductionXml([], "2026-06-25T10:00:00Z");
  assert.match(xml, /PRODUZIONE/);
  assert.ok(!xml.includes("[ ]"), "nessuna riga gusto");
});
```

- [ ] **Step 2: Eseguire il test (verifica che fallisca)**

Run: `node --test test/production-receipt.test.mjs`
Expected: FAIL — `buildProductionXml` non è esportata / non definita.

- [ ] **Step 3: Implementare `buildProductionXml`**

In `netlify/functions/lib/receipt.js`, subito **prima** della riga `module.exports = { buildReceiptXml };`, aggiungere:
```js
// Checklist di produzione (Epson 80mm/48col). `list` = [{name, kg}]; `createdAtIso` = quando è stato richiesto.
// Quadratino di spunta = "[ ]" ASCII (la termica usa code-page: il glifo Unicode ☐ rischia di non renderizzare).
function buildProductionXml(list, createdAtIso) {
  const items = Array.isArray(list) ? list : [];
  const sep = "-".repeat(WIDTH);
  const seph = "=".repeat(WIDTH);
  const out = [];
  const line = (s) => out.push("<text>" + esc(s) + "&#10;</text>");
  const raw = (xml) => out.push(xml);

  raw('<text align="center"/><text width="2" height="2"/>');
  line("PRODUZIONE");
  raw('<text width="1" height="1"/><text align="left"/>');
  line(seph);
  const when = fmtDateTime(createdAtIso);
  if (when) line(when);
  line(sep);

  for (const it of items) {
    const nome = it && it.name != null ? String(it.name) : "?";
    const q = it && it.kg != null ? it.kg : "";
    line(padLine("[ ] " + nome, q + " kg"));
  }
  line(seph);

  raw('<feed line="3"/><cut type="feed"/>');
  return '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + out.join("") + "</epos-print>";
}
```
E aggiornare l'export:
```js
module.exports = { buildReceiptXml, buildProductionXml };
```

- [ ] **Step 4: Eseguire il test (verifica che passi)**

Run: `node --test test/production-receipt.test.mjs`
Expected: PASS (2 test ok).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: nessun errore (exit 0).

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/lib/receipt.js test/production-receipt.test.mjs
git commit -m "$(printf 'feat(print): buildProductionXml checklist for Epson thermal\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

### Task 3: Branch `kind` in epson-sdp.js

**Files:**
- Modify: `netlify/functions/epson-sdp.js`

**Interfaces:**
- Consumes: `buildProductionXml(payload, createdAtIso)` (Task 2), `claim_print_job` RPC (esistente, generico), `wrapPrintRequest` (esistente).

- [ ] **Step 1: Importare il builder produzione**

Modificare la riga di import:
```js
const { buildReceiptXml, buildProductionXml } = require("./lib/receipt");
```

- [ ] **Step 2: Branch sul kind nel ramo GetRequest**

In `exports.handler`, dentro `if (type === "GetRequest")`, **subito dopo** `if (!job) return xml("");`, inserire il ramo produzione **prima** del fetch ordine:
```js
    if (job.kind === "production") {
      try {
        return xml(wrapPrintRequest(job.printjobid, buildProductionXml(job.payload, job.created_at)));
      } catch (e) {
        console.error("epson-sdp build prod:", e && e.message);
        await failJob(job, "build_error");
        return xml("");
      }
    }
```
(Il codice esistente del fetch ordine + `buildReceiptXml(order)` resta invariato subito sotto, gestisce `kind='order'`.)

- [ ] **Step 3: Gestire `order_id` null nell'alert**

In `markErrorAndAlert`, sostituire le due righe che calcolano `shortId` e mandano il Telegram con:
```js
  if (data && data.length) {
    const ref = orderId
      ? "ordine #" + String(orderId).replace(/-/g, "").slice(0, 8).toUpperCase()
      : "PRODUZIONE";
    try { await sendTelegram("⚠️ Stampa fallita " + ref + " — " + code); }
    catch (e) { console.error("epson-sdp alert:", e && e.message); }
  }
```
(`failJob` passa già `job.order_id`, che per un job produzione è `null` → gestito.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: nessun errore (exit 0).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/epson-sdp.js
git commit -m "$(printf 'feat(print): epson-sdp serves production jobs (kind branch)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

### Task 4: Layout — tab in alto → sidebar sinistra

**Files:**
- Modify: `admin.html` (wrapper `.tabcontent` attorno alle tabpane)
- Modify: `css/styles.css` (layout sidebar + mobile)

**Interfaces:**
- Produces: `#app` come flex row con `.tabs` (sidebar) + `.tabcontent` (contenuto). Nessuna modifica JS (lo switch tab esistente continua a funzionare).

- [ ] **Step 1: Avvolgere le tabpane in `.tabcontent`**

In `admin.html`: **dopo** la chiusura `</div>` di `<div class="tabs">…</div>` (riga ~56) e **prima** della prima `<section id="tab-orders" …>`, aprire:
```html
    <div class="tabcontent">
```
E **dopo** l'ultima `</section>` (tab-settings, riga ~225) e **prima** di `</main>`, chiudere:
```html
    </div>
```
(Indentare di conseguenza è facoltativo; non spostare/riscrivere il contenuto delle section.)

- [ ] **Step 2: CSS sidebar (desktop)**

In `css/styles.css`, **dopo** il blocco `.tab.active{…}` (riga ~409), aggiungere:
```css
/* layout back office: sidebar sinistra */
.admin #app{ display:flex; gap:24px; align-items:flex-start; }
.admin .wrap{ max-width:1180px; }
.admin .tabs{
  flex:0 0 190px; width:190px; align-self:flex-start;
  flex-direction:column; flex-wrap:nowrap; gap:6px;
  margin:0; padding:14px 0;
}
.admin .tabs .tab{ width:100%; text-align:left; border-radius:10px; }
.admin .tabcontent{ flex:1 1 auto; min-width:0; }   /* min-width:0 evita overflow orizzontale da figli larghi */
```

- [ ] **Step 3: CSS mobile (ripristina barra orizzontale)**

In `css/styles.css`, dentro il blocco `@media (max-width:560px)` esistente (quello che contiene `.tabs{ top:67px; }` ~riga 752 e `.tabs{ margin:0 -13px 16px; … }` ~riga 762), aggiungere:
```css
  .admin #app{ display:block; }
  .admin .tabs{
    flex-direction:row; flex-wrap:nowrap; overflow-x:auto;
    flex-basis:auto; width:auto; padding:12px 13px 10px;
  }
  .admin .tabs .tab{ width:auto; white-space:nowrap; border-radius:999px; flex:none; }
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: nessun errore (CSS non è lintato, ma il comando deve restare verde sul JS invariato).

- [ ] **Step 5: Verifica desktop**

Aprire `admin.html` (login), confermare: nav verticale a sinistra, ogni tab cambia il pannello a destra, tab attiva evidenziata, nessun overflow orizzontale.

- [ ] **Step 6: Verifica mobile WebKit**

Dal di fuori del repo (es. `/tmp`), con Playwright WebKit (setup in CLAUDE.md), a 360/375/393/430: sidebar collassata a barra orizzontale scrollabile, nessun overflow (`document.scrollingElement.scrollWidth - innerWidth <= 0`).

- [ ] **Step 7: Commit**

```bash
git add admin.html css/styles.css
git commit -m "$(printf 'feat(admin): nav sidebar layout (top tabs to left rail)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

### Task 5: Sezione "Produzione" — nav + render (sola lettura)

**Files:**
- Modify: `admin.html` (voce nav + `<section>`)
- Modify: `js/admin.js` (`renderProduzione`, `buildProdRow` base, chiamata da `loadFlavors`)

**Interfaces:**
- Consumes: `FLAVORS_ALL` (popolata da `loadFlavors`), `$`, `esc`, `availRadios`.
- Produces: `renderProduzione()`, `buildProdRow(f)`, `updateProdStats()` — usate dai task successivi. Container `#prod-list`, stats `#prod-stats`, bottone `#prod-print`.

- [ ] **Step 1: Voce nav "Produzione" dopo "Laboratorio"**

In `admin.html`, **subito dopo** `<button class="tab" data-tab="lab">Laboratorio</button>` (riga 48):
```html
      <button class="tab" data-tab="produzione">Produzione</button>
```

- [ ] **Step 2: Sezione Produzione dopo `#tab-lab`**

In `admin.html`, **dopo** la chiusura `</section>` di `#tab-lab` (riga ~77) e **prima** di `<section id="tab-consegne" …>`:
```html
    <section id="tab-produzione" class="tabpane hidden">
      <div class="admin-head">
        <h2>Produzione</h2>
        <span class="count" id="prod-stats">0 accesi · 0 kg</span>
        <button class="btn sm" id="prod-print" style="margin-left:auto" disabled>🖨️ Stampa</button>
      </div>
      <p class="muted small">Accendi i gusti da produrre, imposta i kg, trascina ⠿ per l'ordine di stampa. <b>Stampa</b> manda la checklist alla termica in gelateria.</p>
      <div id="prod-list" class="stack prodlist"></div>
    </section>
```

- [ ] **Step 3: Render Produzione in admin.js**

In `js/admin.js`, **dopo** la funzione `renderFlavorsList` (cioè dopo la fine del blocco GUSTI, prima della sezione PRODOTTI/Formati ~riga 1175), aggiungere:
```js
// ========== PRODUZIONE ==========
function updateProdStats() {
  const on = FLAVORS_ALL.filter((f) => f.prod_on);
  const tot = on.reduce((s, f) => s + (Number(f.prod_kg) || 0), 0);
  const el = $("prod-stats"); if (el) el.textContent = on.length + " accesi · " + tot + " kg";
  const btn = $("prod-print"); if (btn) btn.disabled = on.length === 0;
}
function buildProdRow(f) {
  const el = document.createElement("div");
  el.className = "prow"; el.dataset.id = f.id;
  el.innerHTML =
    `<span class="drag-handle" title="Trascina per ordinare">⠿</span>` +
    `<span class="pname">${esc(f.name)}</span>` +
    availRadios("prod", !!f.prod_on, "Produci", "Spento") +
    `<div class="kgstep">` +
      `<button type="button" class="kg-dec" aria-label="meno">−</button>` +
      `<span class="kg-val">${Number(f.prod_kg) || 3}</span>` +
      `<button type="button" class="kg-inc" aria-label="più">+</button>` +
      `<span class="kg-unit">kg</span>` +
    `</div>`;
  return el;
}
function renderProduzione() {
  const list = $("prod-list");
  if (!list) return;
  list.innerHTML = "";
  const rows = [...FLAVORS_ALL].sort((a, b) => (a.prod_order || 0) - (b.prod_order || 0) || a.name.localeCompare(b.name));
  rows.forEach((f) => list.appendChild(buildProdRow(f)));
  updateProdStats();
}
```

- [ ] **Step 4: Chiamare `renderProduzione` quando i gusti caricano**

In `js/admin.js`, dentro `loadFlavors`, **dopo** la riga `renderFlavorsList();` (riga ~1024), aggiungere:
```js
  renderProduzione();
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: nessun errore.

- [ ] **Step 6: Verifica**

Login back office → tab "Produzione" (tra Laboratorio e Consegne): compare la lista di tutti i gusti in ordine `prod_order`, ognuno con switch e stepper kg che mostra 3. Stats "0 accesi · 0 kg", bottone Stampa disabilitato. (Interazioni non ancora attive: Task 6.)

- [ ] **Step 7: Commit**

```bash
git add admin.html js/admin.js
git commit -m "$(printf 'feat(admin): produzione tab + read-only flavor list\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

### Task 6: Produzione — interazioni (toggle, kg stepper, drag, stili)

**Files:**
- Modify: `js/admin.js` (`persistOrder` parametrico; wiring in `buildProdRow`; drag in `renderProduzione`)
- Modify: `css/styles.css` (stile `.prow` / `.kgstep`)

**Interfaces:**
- Consumes: `enableDragSort`, `updateRow`, `wireAvailRadios`, `updateProdStats`.
- Produces: `persistOrder(table, orderedIds, col)` — terzo parametro opzionale (default `"sort_order"`), retrocompatibile con i due chiamanti esistenti.

- [ ] **Step 1: Rendere `persistOrder` parametrico sulla colonna**

In `js/admin.js`, sostituire la funzione `persistOrder` (righe ~1002-1004) con:
```js
async function persistOrder(table, orderedIds, col = "sort_order") {
  await Promise.all(orderedIds.map((id, i) => sb.from(table).update({ [col]: i + 1 }).eq("id", id)));
}
```
(I chiamanti esistenti `persistOrder("flavors", ids)` e `persistOrder(table, orderedIds)` restano validi.)

- [ ] **Step 2: Wiring toggle + stepper in `buildProdRow`**

In `js/admin.js`, in `buildProdRow`, **prima** di `return el;`, aggiungere:
```js
  // toggle prod_on
  wireAvailRadios(el, (on) => { f.prod_on = on; updateRow("flavors", f.id, { prod_on: on }); updateProdStats(); });
  // stepper kg (clamp 1..8)
  const valEl = el.querySelector(".kg-val");
  const setKg = (n) => {
    const v = Math.min(8, Math.max(1, n));
    f.prod_kg = v; valEl.textContent = String(v);
    updateRow("flavors", f.id, { prod_kg: v });
    updateProdStats();
  };
  el.querySelector(".kg-dec").onclick = () => setKg((Number(f.prod_kg) || 3) - 1);
  el.querySelector(".kg-inc").onclick = () => setKg((Number(f.prod_kg) || 3) + 1);
```

- [ ] **Step 3: Drag-sort persistente su `prod_order` in `renderProduzione`**

In `js/admin.js`, in `renderProduzione`, **dopo** `rows.forEach((f) => list.appendChild(buildProdRow(f)));` e **prima** di `updateProdStats();`, aggiungere:
```js
  enableDragSort(list, ".drag-handle", ".prow", (ids) => {
    ids.forEach((id, i) => { const f = FLAVORS_ALL.find((x) => x.id === id); if (f) f.prod_order = i + 1; });
    persistOrder("flavors", ids, "prod_order");
  });
```

- [ ] **Step 4: Stile riga produzione**

In `css/styles.css`, in fondo al file, aggiungere:
```css
/* ---------- Produzione ---------- */
.prodlist .prow{
  display:flex; align-items:center; gap:14px;
  padding:10px 12px; border:1px solid var(--line-2); border-radius:12px; background:#fff;
}
.prodlist .prow + .prow{ margin-top:8px; }
.prow .pname{ flex:1 1 auto; min-width:0; font-weight:600; color:var(--ink); }
.prow .kgstep{ display:inline-flex; align-items:center; gap:8px; flex:none; }
.prow .kgstep button{
  width:30px; height:30px; border-radius:8px; border:1px solid var(--line-2);
  background:transparent; cursor:pointer; font-size:18px; line-height:1; color:var(--ink);
}
.prow .kgstep button:hover{ border-color:var(--ink-2); }
.prow .kg-val{ min-width:18px; text-align:center; font-weight:600; font-variant-numeric:tabular-nums; }
.prow .kg-unit{ color:var(--muted); font-size:13px; }
.prow.dragging{ box-shadow:0 8px 24px rgba(0,0,0,.14); }
@media (max-width:560px){
  .prodlist .prow{ gap:10px; padding:9px 10px; }
  .prow .kgstep button{ width:34px; height:34px; }   /* tap target */
}
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: nessun errore.

- [ ] **Step 6: Verifica persistenza (richiede Task 1 applicata)**

Login → Produzione: accendi 2-3 gusti, cambia kg con −/+ (clamp 1 e 8), trascina ⠿ per riordinare. Ricarica pagina → stato accesi, kg e ordine **persistono**. Stats e stato bottone si aggiornano live. Verifica anche in WebKit mobile (nessun overflow, stepper toccabile).

- [ ] **Step 7: Commit**

```bash
git add js/admin.js css/styles.css
git commit -m "$(printf 'feat(admin): produzione toggle, kg stepper, drag-order persistence\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

### Task 7: Pulsante "Stampa" → job produzione

**Files:**
- Modify: `js/admin.js` (handler `#prod-print`)

**Interfaces:**
- Consumes: `FLAVORS_ALL`, `sb`, `toast`. Inserisce in `print_jobs` un record `{kind:'production', payload:[{name, kg}]}` consumato da `epson-sdp` (Task 3).

- [ ] **Step 1: Handler Stampa**

In `js/admin.js`, nella sezione PRODUZIONE (dopo `renderProduzione`), aggiungere il wiring a livello modulo:
```js
$("prod-print").onclick = async () => {
  const list = [...FLAVORS_ALL]
    .filter((f) => f.prod_on)
    .sort((a, b) => (a.prod_order || 0) - (b.prod_order || 0))
    .map((f) => ({ name: f.name, kg: Number(f.prod_kg) || 3 }));
  if (!list.length) { toast("Nessun gusto acceso."); return; }
  const { error } = await sb.from("print_jobs").insert({ kind: "production", payload: list });
  toast(error ? "Errore stampa." : "Inviato in stampa…");
};
```
(Il bottone esiste sempre nell'HTML; il wiring a top-level è coerente con gli altri handler in admin.js, es. `$("orders-refresh").onclick`.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: nessun errore.

- [ ] **Step 3: Verifica inserimento job**

Login → Produzione: con ≥1 gusto acceso, premi Stampa → toast "Inviato in stampa…". Verifica il job in coda:
```bash
curl -s "https://rlrsyqmwtjfyuqkgzqso.supabase.co/rest/v1/print_jobs?select=kind,status,payload&kind=eq.production&order=created_at.desc&limit=1" \
  -H "apikey: sb_publishable_FeopkZa7V-fLzx5fQerykQ_NVN_qVC3" \
  -H "Authorization: Bearer <ACCESS_TOKEN_AUTHENTICATED>"
```
(Serve un token `authenticated`: `print_jobs` non è leggibile da anon post-lockdown. In alternativa, verifica end-to-end sulla stampante: lo scontrino "PRODUZIONE" con le righe `[ ]` esce in ordine.)

- [ ] **Step 4: Commit**

```bash
git add js/admin.js
git commit -m "$(printf 'feat(admin): produzione print button enqueues thermal job\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NAqUFG8pDt9RvX3U1CitUv')"
```

---

## Note finali di integrazione

- **Deploy**: a fine implementazione, deploy = `git push origin main` (richiede merge di `feature/produzione` su `main` e "pusha" esplicito dell'owner — non in questo piano).
- **Env stampa**: nessuna nuova env. Riusa `EPSON_SDP_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` già configurate.
- **End-to-end stampa**: la verifica reale su hardware (lo scontrino "PRODUZIONE" esce dalla termica) va fatta col polling SDP attivo, come da spec Epson esistente (`docs/superpowers/specs/2026-06-21-...`).
