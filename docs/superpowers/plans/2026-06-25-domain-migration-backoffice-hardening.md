# Domain Migration + Back Office Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrare gelato-delivery su dominio custom (`www`/`admin.gelateriamontepetrosu.it`) e sostituire la protezione cosmetica del back office con auth reale (Supabase Auth) + RLS ristretta, chiudendo l'accesso anon a `orders`/`discount_codes`.

**Architecture:** Dominio = quasi tutto config esterna (DNS+Netlify+Stripe+Supabase), 1 sola modifica codice (`netlify.toml`). Hardening in **due fasi sul DB condiviso prod** (niente staging): **Fase A additiva** (policy `authenticated` + 2 RPC `security definer` + utente admin + frontend nuovo che usa auth/RPC) — retro-compatibile, l'anon resta aperto; **Fase B sottrattiva** (drop policy/grant anon) — il frontend nuovo già non dipende dall'anon su tabelle sensibili.

**Tech Stack:** HTML/CSS/JS vanilla, Supabase (Postgres + Auth + RLS), Netlify (static + functions), Stripe (test). Verifiche: Node + `@supabase/supabase-js` (assertion script), Playwright **WebKit** (standard repo), `npm run lint` / `npm run typecheck` (gate).

## Global Constraints

- **Repo & deploy:** repo `github.com/vla-sys/gelato-delivery`, Netlify git-connected; **push su `main` = build prod automatico (~15s)**. Lavorare su **branch `feature/hardening`**; push su `main` SOLO su "pusha" esplicito di Vla (classifier). Verifica prod: `curl -s https://<dominio>/js/<file> | grep <simbolo>`.
- **Stripe resta in modalità TEST** per tutto il piano. Switch live = fuori scope, step successivo.
- **Gate "done":** `npm run lint` verde; se toccate `netlify/functions/` anche `npm run typecheck` verde. Mai indebolire un check (no `eslint-disable`, `@ts-ignore`, `catch{}` vuoto).
- **DB condiviso prod, niente staging:** rispettare l'ordine Fase A → (deploy+verifica) → Fase B. Mai applicare Fase B prima che il frontend Fase A sia live e verificato.
- **Migrazioni SQL:** applicate via **Supabase SQL editor** (dashboard) o Supabase CLI. Per la Fase B wrappare in `begin; … commit;` per consentire rollback se l'assertion fallisce.
- **iOS/mobile:** ogni modifica UI verificata in **Playwright WebKit** (vedi CLAUDE.md), non solo Chrome headless.
- **Email utente admin:** `admin@gelateriamontepetrosu.it`. Password robusta (24+ char) generata e inserita in Supabase (auto-confirm).
- **Commit:** conventional commits, trailer `Co-Authored-By` come da CLAUDE.md del repo.

---

## External Setup Checklist (azioni Vla / dashboard — NON codice)

Prerequisiti e azioni manuali. Possono procedere in parallelo allo sviluppo; alcune servono prima del test/cutover (indicato).

- [ ] **E1 — DNS (registrar):** `www` CNAME → `gelato26.netlify.app`; `admin` CNAME → `gelato26.netlify.app`; apex `@` A → `75.2.60.5` + redirect apex→www. *(Confermare il target esatto mostrato da Netlify.)* — serve per cutover dominio.
- [ ] **E2 — Netlify Domain Management:** aggiungere `www.gelateriamontepetrosu.it` (primary), `admin.gelateriamontepetrosu.it`, apex; attendere SSL Let's Encrypt. `gelato26.netlify.app` resta attivo.
- [ ] **E3 — Supabase → Authentication → Providers/Settings:** **disabilitare la registrazione pubblica** (Enable signup = OFF). **OBBLIGATORIO** prima della Fase A.
- [ ] **E4 — Supabase → Authentication → Users → Add user:** email `admin@gelateriamontepetrosu.it`, password robusta, **Auto Confirm User = ON**. Serve prima di testare il login admin (Task A3).
- [ ] **E5 — Supabase → Authentication → URL Configuration:** Site URL + Redirect allowlist con `https://www.gelateriamontepetrosu.it` e `https://admin.gelateriamontepetrosu.it`.
- [ ] **E6 — Stripe (TEST) → Webhooks:** aggiungere endpoint `https://www.gelateriamontepetrosu.it/.netlify/functions/stripe-webhook` (eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`). Tenere attivo anche il webhook `gelato26` finché non si taglia. Se il nuovo endpoint genera un signing secret diverso, aggiornare `STRIPE_WEBHOOK_SECRET` su Netlify (poi redeploy/commit vuoto).

---

# PART 1 — Migrazione dominio (rischio ~0)

### Task 1: Rewrite host-based subdomain admin in `netlify.toml`

**Files:**
- Modify: `netlify.toml` (aggiungere un redirect prima dei 404 esistenti)

**Interfaces:**
- Produces: il subdomain `admin.gelateriamontepetrosu.it` serve `admin.html` alla root (status 200 rewrite).

- [ ] **Step 1: Aggiungere la regola redirect.** In `netlify.toml`, prima delle regole `force=true → 404` per i path sorgente, inserire (rewrite SOLO della root: `/*` + force riscriverebbe anche `/js/*`,`/css/*`,`/config.js` → asset rotti):

```toml
[[redirects]]
  from = "https://admin.gelateriamontepetrosu.it/"
  to = "/admin.html"
  status = 200
  force = true
```

- [ ] **Step 2: Lint/sanity.** Run: `npm run lint`. Expected: PASS (toml non lintato da eslint, ma assicura che il commit non rompa il gate JS).

- [ ] **Step 3: Commit.**

```bash
git add netlify.toml
git commit -m "feat(domain): serve admin.html on admin subdomain via host rewrite"
```

- [ ] **Step 4: Verifica (post-E1/E2, dopo DNS+SSL).** Run: `curl -sI https://admin.gelateriamontepetrosu.it/ | grep -i "200\|content-type"` e `curl -s https://admin.gelateriamontepetrosu.it/ | grep -i "id=\"pw\"\|admin"`. Expected: la root del subdomain restituisce il markup di `admin.html`.

> Nota: DNS/SSL/domini = E1/E2 (esterni). `return_url` Stripe e fetch function sono già relativi/origin-derived → nessun'altra modifica codice per il dominio.

---

# PART 2 — Hardening, FASE A (additiva, retro-compatibile)

Tutto ciò che segue è retro-compatibile: aggiunge capacità senza rimuovere l'accesso anon. A fine Fase A si fa un deploy + verifica completa con anon **ancora aperto**.

### Task A1: Migration additiva — policy `authenticated` + RPC

**Files:**
- Create: `supabase/migration-2026-06-25a-auth-rpc-additive.sql`
- Create: `test/security-assert.mjs` (script di verifica riusato anche in Fase B)
- Reference: `supabase/schema.sql:127-136`, `supabase/migration-2026-06-07-discount-codes.sql`, `js/order.js:486,497,573`

**Interfaces:**
- Produces: policy `for all to authenticated` su tutte le tabelle app; funzioni `public.rpc_slot_availability(p_date date) returns table(slot_label text, taken int)` e `public.rpc_coupon_precheck(p_code text, p_contact text) returns jsonb` (eseguibili da `anon`).

- [ ] **Step 1: Verificare i nomi policy esistenti.** Nel Supabase SQL editor: `select schemaname, tablename, policyname from pg_policies where schemaname='public' order by tablename;`. Annotare i nomi delle policy permissive anon (attesi: `proto anon <tabella>`). Servono per il drop in Fase B (Task B1), non ora.

- [ ] **Step 2: Scrivere la migration additiva.** Contenuto di `supabase/migration-2026-06-25a-auth-rpc-additive.sql`:

```sql
-- FASE A: additiva, retro-compatibile. NON rimuove l'accesso anon (vedi Fase B).

-- 1) Policy 'authenticated' (l'admin opera come authenticated dopo il login Supabase Auth)
create policy "auth all flavors"         on public.flavors         for all to authenticated using (true) with check (true);
create policy "auth all formats"         on public.formats         for all to authenticated using (true) with check (true);
create policy "auth all time_slots"      on public.time_slots      for all to authenticated using (true) with check (true);
create policy "auth all slot_day_state"  on public.slot_day_state  for all to authenticated using (true) with check (true);
create policy "auth all settings"        on public.settings        for all to authenticated using (true) with check (true);
create policy "auth all orders"          on public.orders          for all to authenticated using (true) with check (true);
create policy "auth all discount_codes"  on public.discount_codes  for all to authenticated using (true) with check (true);
create policy "auth all print_jobs"      on public.print_jobs      for all to authenticated using (true) with check (true);

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 2) RPC SECURITY DEFINER per i pre-check pubblici, espongono SOLO dati minimi (no PII)
create or replace function public.rpc_slot_availability(p_date date)
returns table(slot_label text, taken int)
language sql security definer set search_path = public as $$
  select o.slot_label, count(*)::int
  from public.orders o
  where o.delivery_date = p_date
    and coalesce(o.status,'') not in ('annullato','rifiutato')
  group by o.slot_label;
$$;
revoke all on function public.rpc_slot_availability(date) from public;
grant execute on function public.rpc_slot_availability(date) to anon, authenticated;

-- Mirror della logica coupon di create-checkout.js (once-per-customer su telefono/email)
create or replace function public.rpc_coupon_precheck(p_code text, p_contact text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; used int;
begin
  select * into d from public.discount_codes
   where lower(code) = lower(p_code) and active = true limit 1;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  select count(*) into used from public.orders
   where lower(coalesce(coupon_code,'')) = lower(p_code)
     and (customer_phone = p_contact or email = p_contact);
  if used > 0 then
    return jsonb_build_object('valid', false, 'reason', 'already_used');
  end if;
  return jsonb_build_object('valid', true, 'type', d.discount_type, 'value', d.value);
end; $$;
revoke all on function public.rpc_coupon_precheck(text, text) from public;
grant execute on function public.rpc_coupon_precheck(text, text) to anon, authenticated;
```

> Prima di scrivere `rpc_coupon_precheck`, leggere `netlify/functions/create-checkout.js` (validazione coupon) e replicarne ESATTAMENTE le condizioni (campi `kind`/`discount_type`, once-per-customer). Le colonne reali di `discount_codes`: `code, discount_type, value, kind, active, used_count, burned`.

- [ ] **Step 3: Applicare la migration.** Incollare il file nel Supabase SQL editor ed eseguire. Expected: nessun errore; 8 policy + 2 funzioni create.

- [ ] **Step 4: Scrivere lo script di verifica anon.** Contenuto di `test/security-assert.mjs` (legge URL/anon key pubblici da `config.js`):

```js
// Verifica cosa può fare la anon key pubblica. Uso: node test/security-assert.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8')
const url = cfg.match(/url:\s*"([^"]+)"/)[1]
const anon = cfg.match(/anonKey:\s*"([^"]+)"/)[1]
const sb = createClient(url, anon)

async function probe(label, q) {
  const { data, error } = await q
  console.log(`${label}: ${error ? 'DENIED ('+error.message+')' : (data?.length ?? 0)+' rows'}`)
  return { rows: data?.length ?? 0, denied: !!error }
}

console.log('--- letture sensibili (Fase B: devono essere DENIED/0) ---')
await probe('orders.select',          sb.from('orders').select('*').limit(1))
await probe('discount_codes.select',  sb.from('discount_codes').select('*').limit(1))
console.log('--- scritture (Fase B: DENIED) ---')
await probe('flavors.insert',         sb.from('flavors').insert({ name: '__probe__', sort_order: 999 }).select())
console.log('--- catalogo pubblico (sempre leggibile) ---')
await probe('flavors.select',         sb.from('flavors').select('*').limit(1))
await probe('settings.select',        sb.from('settings').select('*').limit(1))
console.log('--- RPC (sempre eseguibili) ---')
const today = new Date().toISOString().slice(0,10)
await probe('rpc_slot_availability',  sb.rpc('rpc_slot_availability', { p_date: today }))
console.log('rpc_coupon_precheck:', JSON.stringify((await sb.rpc('rpc_coupon_precheck', { p_code: '__nope__', p_contact: 'x' })).data))
```

- [ ] **Step 5: Eseguire lo script (Fase A — anon ANCORA aperto).** Installare il client in una dir fuori dal repo se serve, poi Run: `node test/security-assert.mjs`. Expected (Fase A): `orders.select` e `discount_codes.select` ritornano righe (anon ancora aperto); `rpc_slot_availability` ritorna righe/0 senza errore; `rpc_coupon_precheck` ritorna `{"valid":false,"reason":"not_found"}`. **Le RPC funzionano** — è ciò che conta qui.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migration-2026-06-25a-auth-rpc-additive.sql test/security-assert.mjs
git commit -m "feat(security): add authenticated RLS policies + slot/coupon RPCs (additive)"
```

### Task A2: Config client Supabase Auth (persist session)

**Files:**
- Modify: `js/supabase-client.js:15`

**Interfaces:**
- Consumes: `window.SUPABASE_CONFIG` (url, anonKey).
- Produces: `window.sb` con sessione Auth persistente (localStorage) — usata da `admin.js` (Task A3).

- [ ] **Step 1: Rendere esplicita la config auth.** Sostituire la creazione del client:

```js
window.sb = supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
```

- [ ] **Step 2: Lint.** Run: `npm run lint`. Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add js/supabase-client.js
git commit -m "chore(auth): explicit persistSession on supabase client"
```

### Task A3: Login reale back office (Supabase Auth)

**Files:**
- Modify: `admin.html:24-40` (form login: aggiungere campo email)
- Modify: `js/admin.js:118-132` (tryLogin + check sessione + logout)
- Modify: `config.js:15` (rimuovere `window.ADMIN_PASSWORD`)

**Interfaces:**
- Consumes: `window.sb` con Auth (Task A2); utente admin creato (E4); signup OFF (E3).
- Produces: accesso al back office solo previa sessione Supabase Auth valida.

- [ ] **Step 1: Aggiornare il form in `admin.html`.** Nel gate login (attorno a riga 24-40) aggiungere un input email sopra alla password:

```html
<input id="email" type="email" autocomplete="username" placeholder="email" />
<input id="pw" type="password" autocomplete="current-password" placeholder="password" />
<button id="pw-go">Entra</button>
```

- [ ] **Step 2: Sostituire `tryLogin` e il check di sessione in `js/admin.js` (118-132).**

```js
async function tryLogin() {
  const email = $("email").value.trim();
  const password = $("pw").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { toast("Accesso negato."); return; }
  enterApp();
}

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) enterApp();
}
checkSession();
// Reload SOLO su SIGNED_OUT reale: reagire a `!session` farebbe loop infinito sul login
// perché INITIAL_SESSION per un utente non loggato arriva con session=null.
sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.reload(); });
```

- [ ] **Step 3: Aggiungere logout.** Aggiungere un bottone logout nell'header del back office e l'handler:

```js
async function logout() { await sb.auth.signOut(); location.reload(); }
```

- [ ] **Step 4: Rimuovere il segreto da `config.js`.** Eliminare la riga `window.ADMIN_PASSWORD = "gelato2026";` (`config.js:15`). Rimuovere ogni residuo riferimento a `ADMIN_PASSWORD` e a `sessionStorage.getItem/setItem("gelato_admin", ...)` in `admin.js`.

- [ ] **Step 5: Lint.** Run: `npm run lint`. Expected: PASS (nessun riferimento orfano a `ADMIN_PASSWORD`/`gelato_admin`).

- [ ] **Step 6: Test login (Playwright WebKit).** Creare `test/admin-auth.webkit.mjs` (pattern CLAUDE.md, viewport desktop) contro l'URL di preview/branch:

```js
import { webkit } from 'playwright'
const URL = process.env.ADMIN_URL // es. deploy-preview branch URL
const browser = await webkit.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(URL + '/admin.html', { waitUntil: 'networkidle' })
// password errata → resta al login
await page.fill('#email', 'admin@gelateriamontepetrosu.it')
await page.fill('#pw', 'WRONG'); await page.click('#pw-go')
await page.waitForTimeout(1500)
console.log('after wrong pw, still login:', await page.isVisible('#pw'))
// password corretta → entra
await page.fill('#pw', process.env.ADMIN_PW); await page.click('#pw-go')
await page.waitForSelector('.tab', { timeout: 8000 })
console.log('entered app:', await page.isVisible('.tab'))
// reload → sessione persiste
await page.reload({ waitUntil: 'networkidle' })
console.log('session persists:', await page.isVisible('.tab'))
await browser.close()
```

Run: `ADMIN_URL=<preview> ADMIN_PW=<pw> node test/admin-auth.webkit.mjs`. Expected: `still login: true`, `entered app: true`, `session persists: true`.

- [ ] **Step 7: Commit.**

```bash
git add admin.html js/admin.js config.js test/admin-auth.webkit.mjs
git commit -m "feat(auth): replace client password gate with Supabase Auth login + logout"
```

### Task A4: `order.js` usa le RPC invece delle letture dirette

**Files:**
- Modify: `js/order.js:573` (conteggio slot), `js/order.js:486,497` (coupon)

**Interfaces:**
- Consumes: `rpc_slot_availability`, `rpc_coupon_precheck` (Task A1).
- Produces: il client cliente non legge più direttamente `orders`/`discount_codes`.

- [ ] **Step 1: Sostituire la lettura slot (`order.js:573`).** Rimpiazzare la `sb.from("orders").select("slot_label")…` con:

```js
const { data: avail } = await sb.rpc('rpc_slot_availability', { p_date: deliveryDate });
// avail: [{ slot_label, taken }] — usare 'taken' al posto del conteggio precedente
const takenBySlot = Object.fromEntries((avail || []).map(r => [r.slot_label, r.taken]));
```

Adeguare il punto d'uso (dove prima si contavano gli ordini per slot) a leggere `takenBySlot[label]`.

- [ ] **Step 2: Sostituire il precheck coupon (`order.js:486,497`).** Rimpiazzare le letture `sb.from("discount_codes")…` / `sb.from("orders")…ilike(coupon)` con:

```js
const { data: cp } = await sb.rpc('rpc_coupon_precheck', { p_code: code, p_contact: (phone || email) });
if (!cp || !cp.valid) { /* mostra messaggio: coupon non valido / già usato */ }
else { /* applica sconto cp.type / cp.value lato UI */ }
```

> La validazione autorevole resta `create-checkout.js`: la UI usa la RPC solo per feedback immediato.

- [ ] **Step 3: Lint.** Run: `npm run lint`. Expected: PASS (nessuna `sb.from("orders")`/`sb.from("discount_codes")` residua in `order.js`).

- [ ] **Step 4: Test flusso cliente (Playwright WebKit, preview).** Verificare: la lista slot mostra disponibilità (via RPC); inserendo un coupon noto valido appare lo sconto; coupon inesistente → messaggio. Larghezze 360/393. (Pagamento end-to-end con carta test al Task A5.)

- [ ] **Step 5: Commit.**

```bash
git add js/order.js
git commit -m "refactor(order): use slot/coupon RPCs instead of direct table reads"
```

### Task A5: Deploy Fase A + verifica completa (anon ancora aperto)

**Files:** nessuna modifica — gate di deploy/verifica.

- [ ] **Step 1: Deploy preview.** Pushare `feature/hardening` (branch) per generare il **deploy preview** Netlify. *(Se i branch deploy non sono attivi, attivarli in Netlify, oppure concordare con Vla un cutover diretto su `main` — solo dopo che tutti i test sotto passano localmente per quanto possibile.)*

- [ ] **Step 2: Regressione cliente.** Sul preview: menu carica, slot via RPC, coupon via RPC, **ordine end-to-end con carta test** (`4242 4242 4242 4242`), redirect `grazie.html`, ordine creato (verifica in back office), scontrino Epson accodato, notifica Telegram.

- [ ] **Step 3: Back office.** Login admin (E4) entra; CRUD su flavors/formats/slots/settings/discount_codes/ordini funziona (come `authenticated`); ristampa; logout.

- [ ] **Step 4: Assert RPC.** Run: `node test/security-assert.mjs`. Expected: le RPC funzionano. (orders/discount_codes ANCORA leggibili da anon — normale in Fase A.)

- [ ] **Step 5: Go/No-Go.** Se tutto verde → procedere alla **Fase B**. Se no → fixare prima di toccare la lockdown. **Non procedere alla Fase B con la Fase A non verificata.**

---

# PART 2 — Hardening, FASE B (lockdown sottrattivo)

Eseguire SOLO dopo che la Fase A è live e verificata (Task A5 verde). Da qui l'anon perde l'accesso alle tabelle sensibili.

### Task B1: Migration di lockdown + rollback

**Files:**
- Create: `supabase/migration-2026-06-25b-rls-lockdown.sql`
- Create: `supabase/migration-2026-06-25b-rollback.sql`

**Interfaces:**
- Consumes: policy `authenticated` + RPC (Fase A) già attive e usate dal frontend live.
- Produces: anon = SELECT solo su catalogo; nessun accesso anon a `orders`/`discount_codes`/`print_jobs`.

- [ ] **Step 1: Scrivere la lockdown.** Usare i nomi policy annotati al Task A1/Step 1. Contenuto di `supabase/migration-2026-06-25b-rls-lockdown.sql`:

```sql
begin;

-- Drop policy permissive anon (adeguare i nomi a quelli reali da pg_policies)
drop policy if exists "proto anon flavors"         on public.flavors;
drop policy if exists "proto anon formats"         on public.formats;
drop policy if exists "proto anon time_slots"      on public.time_slots;
drop policy if exists "proto anon slot_day_state"  on public.slot_day_state;
drop policy if exists "proto anon settings"        on public.settings;
drop policy if exists "proto anon orders"          on public.orders;
drop policy if exists "proto anon discount_codes"  on public.discount_codes;
drop policy if exists "proto anon print_jobs insert"      on public.print_jobs;

-- Revoca grant larghi anon
revoke all on all tables in schema public from anon;

-- Catalogo: SELECT-only per anon
grant select on public.flavors, public.formats, public.time_slots, public.slot_day_state, public.settings to anon;
create policy "anon read flavors"        on public.flavors        for select to anon using (true);
create policy "anon read formats"        on public.formats        for select to anon using (true);
create policy "anon read time_slots"     on public.time_slots     for select to anon using (true);
create policy "anon read slot_day_state" on public.slot_day_state for select to anon using (true);
create policy "anon read settings"       on public.settings       for select to anon using (true);

-- orders / discount_codes / print_jobs / pending_orders: nessun accesso anon
-- (le policy 'auth all *' della Fase A restano e coprono l'admin)

commit;
```

- [ ] **Step 2: Scrivere il rollback.** Contenuto di `supabase/migration-2026-06-25b-rollback.sql` (ripristina lo stato Fase A in caso di emergenza):

```sql
begin;
drop policy if exists "anon read flavors"        on public.flavors;
drop policy if exists "anon read formats"        on public.formats;
drop policy if exists "anon read time_slots"     on public.time_slots;
drop policy if exists "anon read slot_day_state" on public.slot_day_state;
drop policy if exists "anon read settings"       on public.settings;

create policy "proto anon flavors"         on public.flavors         for all to anon using (true) with check (true);
create policy "proto anon formats"         on public.formats         for all to anon using (true) with check (true);
create policy "proto anon time_slots"      on public.time_slots      for all to anon using (true) with check (true);
create policy "proto anon slot_day_state"  on public.slot_day_state  for all to anon using (true) with check (true);
create policy "proto anon settings"        on public.settings        for all to anon using (true) with check (true);
create policy "proto anon orders"          on public.orders          for all to anon using (true) with check (true);
create policy "proto anon discount_codes"  on public.discount_codes  for all to anon using (true) with check (true);
create policy "proto anon print_jobs insert"      on public.print_jobs      for insert to anon with check (true);
grant all on all tables in schema public to anon;
commit;
```

- [ ] **Step 3: Commit (file, prima di applicare).**

```bash
git add supabase/migration-2026-06-25b-rls-lockdown.sql supabase/migration-2026-06-25b-rollback.sql
git commit -m "feat(security): RLS lockdown migration (anon read-only catalog) + rollback"
```

### Task B2: Applicare il lockdown + verifica sicurezza

**Files:** nessuna modifica codice — applicazione DB + assertion.

- [ ] **Step 1: Applicare la lockdown.** Incollare `migration-2026-06-25b-rls-lockdown.sql` nel Supabase SQL editor ed eseguire (è già in `begin…commit`). Expected: nessun errore.

- [ ] **Step 2: Assert sicurezza (il test chiave).** Run: `node test/security-assert.mjs`. Expected ora:
  - `orders.select` → **DENIED o 0 rows**
  - `discount_codes.select` → **DENIED o 0 rows**
  - `flavors.insert` → **DENIED**
  - `flavors.select`, `settings.select` → righe (catalogo leggibile)
  - `rpc_slot_availability` → righe/0 senza errore; `rpc_coupon_precheck` → `{"valid":false,"reason":"not_found"}`
  
  Se `orders.select`/`discount_codes.select` ritornano ancora righe → la lockdown non ha agito (nomi policy sbagliati): **eseguire il rollback (B1/Step 2), correggere i nomi, ripetere.**

- [ ] **Step 3: Regressione end-to-end (prod, con lockdown attivo).** Ripetere Task A5/Step 2-3 sul sito live: ordine+pagamento test, slot/coupon via RPC, back office login+CRUD. Expected: tutto funziona col DB lockato.

- [ ] **Step 4: Commit nota di stato (opzionale) / aggiornare CLAUDE.md.** Aggiornare la sezione "Sicurezza" di `CLAUDE.md` (il debito noto RLS è chiuso) e la riga di verifica col nuovo dominio.

```bash
git add CLAUDE.md
git commit -m "docs: RLS lockdown done, update verify domain + security note"
```

### Task B3: Cutover dominio + follow-up

**Files:** nessuna modifica codice (azioni esterne + doc/memoria).

- [ ] **Step 1: Cutover.** Confermare E1/E2 (DNS+SSL) attivi; `www`/`admin` rispondono HTTPS; `admin.` serve `admin.html` (Task 1/Step 4); webhook Stripe test sul nuovo dominio riceve eventi (E6) — fare un ordine test e verificare l'arrivo del webhook.
- [ ] **Step 2: Aggiornare la memoria progetto.** Aggiornare `gelato-prod-url` (nuovo dominio di verifica) e annotare in `gelato-legal-docs` che `[[LINK_INFORMATIVA_PRIVACY]]` → `https://www.gelateriamontepetrosu.it/privacy` (quando le pagine legali saranno wired).
- [ ] **Step 3: Push su `main`.** Solo su "pusha" esplicito di Vla.

---

## Self-Review (esito)

- **Spec coverage:** Dominio (Task 1 + E1/E2/E6) ✓; auth reale (A2/A3 + E3/E4/E5) ✓; RLS lockdown (A1 additivo + B1/B2) ✓; RPC slot/coupon (A1) ✓; refactor order.js (A4) ✓; rimozione ADMIN_PASSWORD (A3) ✓; sequenza dominio→hardening→(live) ✓; verifica/assert (security-assert.mjs, Playwright) ✓; rollback (B1) ✓. **Miglioria vs spec:** fasi A/B additiva→sottrattiva per il DB condiviso senza staging.
- **Placeholder scan:** nessun TBD; ogni step ha codice/comando concreto. Punti che richiedono lettura del codice esistente prima di scrivere (nomi policy reali per il drop; logica coupon di create-checkout da rispecchiare) sono indicati esplicitamente come step, non come placeholder.
- **Type consistency:** `rpc_slot_availability(p_date date)→(slot_label,taken)` e `rpc_coupon_precheck(p_code,p_contact)→jsonb{valid,type,value,reason}` usati coerentemente in A1/A4/security-assert.

## Note di rischio
- Il DB è condiviso prod: l'ordine A→(verifica)→B è vincolante. La Fase B è l'unico punto che può rompere il pubblico; mitigata da assertion + rollback pronti.
- `authenticated ≡ admin` regge solo con **signup OFF** (E3): verificare prima della Fase A.
