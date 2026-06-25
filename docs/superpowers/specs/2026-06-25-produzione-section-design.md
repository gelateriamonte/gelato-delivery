# Design — M.A.C. Office: layout sidebar + sezione "Produzione"

**Data:** 2026-06-25
**Area:** back office (`admin.html` / `js/admin.js` / `css/styles.css`) + stampa Epson (`netlify/functions/`)
**Stato:** approvato (design), pronto per il piano di implementazione.

---

## 1. Obiettivo

Due interventi sul back office (M.A.C. Office):

1. **Layout** — spostare la navigazione delle sezioni (oggi pill orizzontali in cima, da "Ordini" a "Parametri") in una **sidebar verticale a sinistra**.
2. **Nuova sezione "Produzione"** (subito dopo "Laboratorio") per pianificare e stampare la produzione giornaliera dei gusti.

La sezione Produzione contiene una tabella ordinabile dei gusti, con selezione acceso/spento e quantità in kg per gusto, e un pulsante che stampa la checklist di produzione sulla stampante termica Epson.

## 2. Decisioni (da chiarimenti con l'owner)

| Tema | Decisione |
|---|---|
| Ordine gusti in Produzione | **Indipendente** dal menù cliente / tab Gusti → nuovo campo `prod_order`. Riordinare in Produzione non tocca `sort_order`. |
| Selettore acceso/spento | **Stato produzione separato** → nuovo flag `prod_on`. Indipendente da `available` (disponibilità a menù). |
| Persistenza piano | **Persistente fisso**: `prod_on` / `prod_kg` / `prod_order` restano finché non cambiati a mano. Nessun reset giornaliero. |
| Selettore kg | Range **1–8, step 1**, default **3**. UI = stepper −/+. |
| Gusti mostrati | **Tutti** i gusti del catalogo. |
| `prod_on` default | **false** (opt-in: si accendono i gusti che si producono). |
| Canale stampa | **Epson termica** TM-m30III (riuso `print_jobs` / `epson-sdp` / `receipt.js`). |
| Contenuto stampa | Lista dei soli gusti **accesi**, con kg, **in ordine `prod_order`**, ogni riga preceduta da un quadratino di spunta. |
| Quadratino | **`[ ]` ASCII** (non `☐` Unicode: la termica usa code-page, il glifo Unicode rischia di non renderizzare). |

## 3. Layout — sidebar sinistra

Struttura HTML attuale dentro `<main id="app">`: `.tabs` (barra pill) seguita da N `<section.tabpane>` come fratelli.

**Modifica:**
- Avvolgere tutte le `<section.tabpane>` in un wrapper `<div class="tabcontent">`.
- `#app` diventa un flex row: `.tabs` (sidebar sinistra, larghezza fissa ~190px, sticky) + `.tabcontent` (flex:1).
- `.tab`: da pill orizzontale a voce full-width allineata a sinistra; stato attivo = riempito (ink), come oggi.
- Allargare `.admin .wrap` da 1040px a ~1180px per recuperare spazio orizzontale tolto dalla sidebar.
- **Mobile** (`@media max-width:560px` e breakpoint tablet): la sidebar torna a **barra orizzontale scrollabile in cima** (comportamento attuale), per non introdurre regressioni WebKit. Verifica obbligatoria in Playwright WebKit prima del deploy (vedi CLAUDE.md).

**JS:** la logica di switch tab (`document.querySelectorAll(".tab").forEach(...)` che toggla `.active` su `.tab` e `.hidden` su `.tabpane`, mappando `data-tab` → `#tab-<x>`) **non cambia**. Si aggiunge solo la nuova voce.

## 4. Sezione "Produzione"

- Nuova voce nav `<button class="tab" data-tab="produzione">Produzione</button>` **tra** "Laboratorio" e "Consegne".
- Nuova `<section id="tab-produzione" class="tabpane hidden">`.

### 4.1 UI — tabella ordinabile

Una **singola tabella** (la "lista" è la tabella) di tutti i gusti, ordinata per `prod_order`. Testata con: titolo, pulsante **🖨️ Stampa**, contatori **N accesi · tot kg**.

Ogni riga:
- **⠿ maniglia drag** → riordina; al rilascio persiste `prod_order` (riuso `enableDragSort` + variante di `persistOrder` parametrica sulla colonna).
- **nome gusto** (sola lettura qui; il nome si edita nella tab Gusti).
- **toggle acceso/spento** (`prod_on`) — pill colorata, stato = colore (riuso stile `daily-btn`/radio esistenti).
- **stepper kg** −/+ con valore al centro, clamp 1–8, step 1, default 3 → persiste `prod_kg`.

### 4.2 Pulsante "Stampa"

- Disabilitato se 0 gusti accesi.
- Click → raccoglie i gusti con `prod_on=true`, in ordine `prod_order`, con `prod_kg` → `payload = [{ name, kg }, …]`.
- `sb.from('print_jobs').insert({ kind: 'production', payload })`.
- Toast di conferma ("Inviato in stampa"). La stampa effettiva avviene quando la stampante polla `epson-sdp` (asincrona, come per gli ordini).

## 5. Data model — migration additiva

File: `supabase/migration-2026-06-25c-produzione.sql`. DDL → applicata in Supabase SQL editor (il token `authenticated` del back office non fa ALTER). `netlify.toml` già 404a `/supabase/*`.

```sql
-- flavors: stato produzione (indipendente dal catalogo)
alter table flavors add column if not exists prod_on    boolean not null default false;
alter table flavors add column if not exists prod_kg    int     not null default 3 check (prod_kg between 1 and 8);
alter table flavors add column if not exists prod_order int     not null default 0;
update flavors set prod_order = sort_order where prod_order = 0;   -- ordine iniziale = ordine catalogo

-- print_jobs: supporto job non-ordine (produzione)
alter table print_jobs add column if not exists kind    text not null default 'order';
alter table print_jobs alter column order_id drop not null;       -- il job produzione non ha ordine
alter table print_jobs add column if not exists payload jsonb;    -- lista gusti del job produzione

-- RLS: l'admin inserisce come authenticated; garantire la policy (verificare se già presente post-lockdown)
-- create policy "auth all print_jobs" on print_jobs for all to authenticated using (true) with check (true);
```

**Nota RLS:** la migration di lockdown (`-25b`) va verificata: se `print_jobs` non ha già una policy per `authenticated`, va aggiunta (l'admin post-lockdown opera come `authenticated`, non più come anon). La policy anon-INSERT esistente (bottone ristampa) resta.

**Esposizione anon:** le nuove colonne `flavors.prod_*` sono leggibili da anon (SELECT catalogo pubblico). Innocuo: nessun PII, è solo il piano di produzione. Nessuna mitigazione necessaria.

## 6. Path di stampa Epson

Riuso completo dell'infrastruttura esistente; `claim_print_job` resta generico (claima qualsiasi `pending`).

**`netlify/functions/epson-sdp.js`** — nel ramo `GetRequest`, dopo il claim:
- branch su `job.kind`:
  - `'order'` (default): comportamento attuale (fetch ordine + `buildReceiptXml(order)`).
  - `'production'`: niente fetch ordine → `buildProductionXml(job.payload)`.
- `failJob` / `markErrorAndAlert` devono gestire `order_id` null (label generica "PRODUZIONE" nell'alert Telegram).

**`netlify/functions/lib/receipt.js`** — nuova funzione esportata `buildProductionXml(list)`:
- titolo centrato doppia dimensione "PRODUZIONE" + data/ora locale (riuso `fmtDateTime`).
- una riga per gusto: `padLine("[ ] " + nome, kg + " kg")` su 48 colonne.
- chiusura con `<feed>` + `<cut>`.
- riuso `esc` / `padLine` / `wrap` / `WIDTH`.

## 7. Gestione errori / edge case

- **0 gusti accesi**: pulsante Stampa disabilitato; nessun job inserito.
- **payload malformato / vuoto a runtime**: `buildProductionXml` su lista vuota stampa comunque l'intestazione "PRODUZIONE" (nessun crash); il build error porta il job a `error` con la guardia esistente.
- **kg fuori range**: vincolato sia in UI (clamp 1–8) sia in DB (`check (prod_kg between 1 and 8)`).
- **drag/persist**: errore di update → toast errore, ricarica lista (pattern esistente).
- **un solo job in volo**: invariante `claim_print_job` invariata — i job produzione si accodano e si servono come gli ordini.

## 8. Test

- **Lint**: `npm run lint` verde (gate Stop hook).
- **Typecheck**: `npm run typecheck` verde — `epson-sdp.js` e `receipt.js` sono in `netlify/functions/`, coperti dal gate pagamenti.
- **Mobile WebKit**: Playwright WebKit a 360/375/393/430 — sidebar collassata, tabella Produzione senza overflow orizzontale (gotcha input-in-flex noti in CLAUDE.md).
- **Migration**: applicata in SQL editor; verifica colonne presenti via SELECT.
- **Stampa end-to-end**: accendi alcuni gusti, kg vari, ordina, premi Stampa → job `production` in coda → la stampante stampa la checklist `[ ]` in ordine. (Verifica su hardware reale come da spec Epson esistente.)

## 9. File toccati

- `admin.html` — wrapper `.tabcontent`, voce nav "Produzione", `<section id="tab-produzione">` con tabella.
- `css/styles.css` — layout sidebar, stile tabella Produzione, regole mobile.
- `js/admin.js` — `loadProduzione`/`renderProduzione`, handler toggle/kg/drag, `persistOrder` parametrico, handler Stampa.
- `supabase/migration-2026-06-25c-produzione.sql` — nuovo (colonne flavors + print_jobs + RLS).
- `netlify/functions/epson-sdp.js` — branch `kind`.
- `netlify/functions/lib/receipt.js` — `buildProductionXml`.

## 10. Fuori scope

- Storico/log delle produzioni stampate.
- Quantità derivate dagli ordini (la sezione Laboratorio già copre i kg da ordine; Produzione è pianificazione manuale).
- Modifica del nome gusto dentro Produzione (resta nella tab Gusti).
- Reset/piani per data.
