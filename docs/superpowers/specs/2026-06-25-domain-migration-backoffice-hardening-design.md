# Design — Migrazione dominio + hardening back office

**Data:** 2026-06-25
**Progetto:** gelato-delivery (insegna "Gelateria BM&V", San Teodoro SS)
**Stato:** design approvato da Vla (bivi decisi) — pronto per piano di implementazione

---

## 1. Obiettivo

Due interventi coordinati prima del go-live soldi-veri:

1. **Migrazione dominio**: da `gelato26.netlify.app` a dominio custom
   - `www.gelateriamontepetrosu.it` — sito pubblico (primary)
   - `admin.gelateriamontepetrosu.it` — back office (alias stesso sito Netlify)
   - apex `gelateriamontepetrosu.it` → redirect a `www`
2. **Hardening accesso back office**: sostituire la protezione cosmetica attuale con **auth reale (Supabase Auth) + RLS ristretta**, chiudendo il buco per cui oggi la anon key pubblica legge/scrive tutte le PII.

`gelato26.netlify.app` resta funzionante (subdomain Netlify di default) — nessuna rottura. Lo switch alle chiavi Stripe **live** è uno step separato e successivo (fuori scope qui): durante questi lavori Stripe resta in **test**.

## 2. Stato attuale verificato (dal codice, giu 2026)

**Dominio / URL:** l'app è già domain-agnostic.
- `create-checkout.js:130-139` — `return_url` Stripe derivato dall'header `origin` → nessuna modifica codice.
- Tutte le fetch alle function sono relative (`/.netlify/functions/...`) → domain-agnostic.
- Nessun URL del sito hardcoded da cambiare nel codice (solo API esterne, invariate).

**Auth back office (cosmetica):**
- `config.js:15` — `window.ADMIN_PASSWORD = "gelato2026"` (plaintext, scaricata da ogni client).
- `js/admin.js:118-132` — confronto stringa client-side + `sessionStorage.gelato_admin="1"`. Spoofabile da DevTools in secondi. Nessun controllo server.
- Nessun uso di Supabase Auth da nessuna parte.

**Dati / RLS (buco critico):**
- `config.js:10-12` — anon/publishable key pubblica, condivisa da sito cliente e admin.
- Tutte le tabelle: policy `for all to anon using(true)` + `grant all on all tables to anon`.
- Con la sola anon key chiunque può: leggere **tutta** `orders` (nome, telefono, indirizzo, GPS) e **tutti** i `discount_codes`; modificare/cancellare ordini, listino, slot, prezzi; creare/cancellare coupon. Già chiuse: `pending_orders` (nessuna policy anon), `print_jobs` (solo INSERT anon).
- Le function (`create-checkout`, `stripe-webhook`, `epson-sdp`, `refund`, `cleanup-pending`, `upload-home-image`, `translate-home`) usano `SUPABASE_SERVICE_ROLE_KEY` (bypassano RLS) — non impattate.

**Letture dirette del cliente da chiudere/rimpiazzare** (`js/order.js`):
- `:573` legge `orders` (conteggio slot pieni per data).
- `:486` legge `orders` per `coupon_code` (once-per-customer); `:497` legge `discount_codes` (lookup coupon).
- L'invio ordine NON scrive direttamente: passa da `create-checkout` (service-role) → l'ordine nasce solo dal webhook a pagamento confermato. La validazione autorevole di slot e coupon è **già** server-side in `create-checkout`; le letture client sono solo UX pre-check.

**Admin (`js/admin.js`) — operazioni** (oggi anon, da portare a `authenticated`): CRUD su `orders, flavors, formats, time_slots, slot_day_state, settings, discount_codes` + INSERT `print_jobs` (ristampa). Dettaglio righe nella mappa in transcript.

## 3. Decisioni prese

- Sicurezza: **auth reale + RLS ristretta** (non solo gate UI).
- Admin host: **subdomain alias sullo stesso sito** (con auth+RLS reali la separazione per URL non serve a proteggere).
- DNS: dominio **registrato**, gestito da Vla al **registrar esterno** (record CNAME/A da puntare a Netlify).
- Sequenza: **dominio prima** (chiavi Stripe test) → hardening → (poi, separato) chiavi live.
- Rimpiazzo letture cliente: **RPC Postgres SECURITY DEFINER** (zero PII esposta, UX invariata).

## 4. Parte 1 — Migrazione dominio

### 4.1 Azioni esterne (Vla / dashboard)

**DNS (registrar):**
- `www` → CNAME → `gelato26.netlify.app`
- `admin` → CNAME → `gelato26.netlify.app`
- apex `@` → record A `75.2.60.5` (ALIAS Netlify) — confermare il target esatto mostrato da Netlify in dashboard (può fornire `apex-loadbalancer.netlify.com`).

**Netlify (Domain management):** aggiungere `www.gelateriamontepetrosu.it` (primary), `admin.gelateriamontepetrosu.it`, apex; attendere provisioning SSL Let's Encrypt. `gelato26.netlify.app` resta attivo.

**Stripe (dashboard, modalità test):** aggiungere endpoint webhook `https://www.gelateriamontepetrosu.it/.netlify/functions/stripe-webhook` (eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`). Mantenere il webhook su `gelato26` finché non si taglia. Aggiornare `STRIPE_WEBHOOK_SECRET` su Netlify se il nuovo endpoint genera un secret diverso.

**Supabase (dashboard, Authentication):** impostare Site URL e Redirect URL allowlist includendo `https://admin.gelateriamontepetrosu.it` e `https://www.gelateriamontepetrosu.it` (necessario per l'Auth della Parte 2).

### 4.2 Modifica codice (unica)

`netlify.toml` — rewrite host-based per servire `admin.html` alla root del subdomain admin, prima delle regole 404 esistenti:
```toml
[[redirects]]
  from = "https://admin.gelateriamontepetrosu.it/"
  to = "/admin.html"
  status = 200
  force = true
```
(Rewrite **solo la root**: `/*` con `force` riscriverebbe anche gli asset `/js/*`,`/css/*`,`/config.js` servendo HTML al posto di JS/CSS.)
(Opzionale, differibile: redirect `www/.../admin.html` → subdomain admin. Non necessario: con auth+RLS reali l'accesso a `admin.html` da www è innocuo.)

### 4.3 Follow-up post-cutover
- Aggiornare `CLAUDE.md` (riga script di verifica) e la memoria `gelato-prod-url` con il nuovo dominio di verifica.

## 5. Parte 2 — Hardening (auth + RLS)

### 5.1 Supabase Auth
- Creare **1 utente admin** (email + password robusta) — via dashboard Supabase o script una-tantum.
- **Disabilitare la registrazione pubblica** (Auth settings) — OBBLIGATORIO: senza, chiunque si registra e ottiene ruolo `authenticated`. Con signup disabilitato + un solo utente, `authenticated` ≡ admin.
- (Difesa-in-profondità opzionale, future-proof: tabella `admins(user_id uuid)` e policy che verificano l'appartenenza, anziché affidarsi a "qualunque authenticated". Non necessaria con un solo admin; valutare se in futuro servono più utenti non-admin.)

### 5.2 `admin.js` / `admin.html` — auth refactor
- `admin.html`: form login con **email + password** (sostituisce il singolo campo password).
- Login: `await sb.auth.signInWithPassword({ email, password })`; su errore → toast; su successo → `enterApp()`.
- All'avvio: `const { data:{ session } } = await sb.auth.getSession(); if (session) enterApp()`. Sottoscrivere `sb.auth.onAuthStateChange`.
- Aggiungere **logout** → `sb.auth.signOut()` → torna al login.
- Rimuovere `sessionStorage.gelato_admin` (rimpiazzato dalla sessione Supabase in localStorage).
- Rimuovere `window.ADMIN_PASSWORD` da `config.js`.
- `js/supabase-client.js`: `createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })` (default, ma esplicito). Le query di `admin.js` viaggeranno col JWT utente → ruolo `authenticated`.

### 5.3 RLS lockdown (migration nuova `supabase/migration-2026-06-25-rls-lockdown.sql`)

Revoca permessi larghi e ridefinisce le policy:
- `revoke all on all tables in schema public from anon;`
- **Tabelle a lettura pubblica** (`flavors, formats, time_slots, slot_day_state, settings`):
  - `grant select ... to anon;`
  - policy: `for select to anon using (true)` + `for all to authenticated using (true) with check (true)`.
- **Tabelle solo-admin** (`orders, discount_codes, print_jobs`):
  - nessun accesso anon (drop policy anon, niente grant anon);
  - policy `for all to authenticated using (true) with check (true)`;
  - `grant ... to authenticated` (+ `grant usage, select on all sequences to authenticated` per gli INSERT).
- `pending_orders`: invariata (nessun anon; solo service-role).
- `service_role`: invariato (bypassa RLS).

Predisporre **migration di rollback** (ripristino grant/policy precedenti) per emergenza.

### 5.4 RPC Postgres (rimpiazzo letture cliente — SECURITY DEFINER)

Nella stessa migration, funzioni `security definer` con `set search_path = public`, eseguibili da `anon`:

1. `rpc_slot_availability(p_date date) returns table(slot_label text, taken int)`
   - `select slot_label, count(*)::int from orders where delivery_date = p_date and status not in ('annullato','rifiutato') group by slot_label;`
   - Espone **solo conteggi**, zero PII. Rimpiazza `order.js:573`.
2. `rpc_coupon_precheck(p_code text, p_contact text) returns jsonb`
   - Cerca il coupon (`discount_codes`, attivo) e verifica once-per-customer (esistenza ordine con stesso `coupon_code` + contatto); ritorna `{ valid, type, value, reason }` minimale. Rimpiazza `order.js:486/497`.
- `grant execute on function ... to anon, authenticated;`
- `create-checkout` resta la validazione **autorevole** (le RPC sono solo pre-check UX).

### 5.5 `order.js` — adeguamento client
- Sostituire la lettura diretta `orders` (slot) con `sb.rpc('rpc_slot_availability', { p_date })`.
- Sostituire le letture `orders`/`discount_codes` (coupon) con `sb.rpc('rpc_coupon_precheck', { p_code, p_contact })`.

## 6. Sequenza & deploy

1. **Dominio** (Parte 1): rischio ~0, nessuna logica toccata. DNS + Netlify + SSL + rewrite `netlify.toml` + webhook Stripe test sul nuovo dominio.
2. **Hardening** (Parte 2): shippare come **UN'UNICA change coordinata** — migration RLS+RPC, `admin.js`/`admin.html` auth, `order.js` RPC, rimozione `ADMIN_PASSWORD` — perché la lockdown senza il client adeguato rompe sito e back office. Testare su **deploy preview** Netlify prima di prod.
3. **(Separato, dopo)** switch chiavi Stripe live + cutover webhook.

## 7. Verifica (criteri di successo)

- **Sicurezza (assertion)**: con la sola anon key pubblica, `select * from orders` e `select * from discount_codes` → **0 righe / permission denied**. Idem write su `orders/flavors/settings`. Script di prova dedicato.
- **Cliente**: menu, slot (via RPC), coupon (via RPC), flusso ordine+pagamento end-to-end (carta test), redirect `grazie.html`.
- **Admin**: login email+password corretto entra, errato no; sessione persiste al refresh; logout funziona; CRUD su ogni tabella OK (come `authenticated`); ristampa Epson; notifica Telegram.
- **Dominio**: `www` e `admin` rispondono in HTTPS; `admin.` serve `admin.html` alla root; apex→www; webhook Stripe test riceve gli eventi.
- **Gate progetto**: `npm run lint` + (se toccate function) `npm run typecheck` verdi.

## 8. Rischi & mitigazioni

- **Lockdown rompe l'app se mal coordinata** → deploy unico + test su preview + migration di rollback pronta.
- **`authenticated` ≡ admin solo se signup disabilitato** → disabilitare signup è step obbligatorio, verificato.
- **RPC SECURITY DEFINER** → `set search_path` fisso per evitare hijack; ritornano solo dati minimi.
- **Webhook Stripe** → tenere il vecchio endpoint attivo finché il nuovo non è verificato; aggiornare `STRIPE_WEBHOOK_SECRET` se cambia.
- **Sessione admin in localStorage** → per-origin: la sessione su `admin.` non bleed su `www`.

## 9. Non-goals
- Switch chiavi Stripe live (step separato successivo).
- Versioni EN dei documenti legali (lavoro separato).
- Hardening ulteriori non legati all'accesso (es. rate-limiting globale, WAF).
- Refactor non correlati di `admin.js`/`order.js`.
