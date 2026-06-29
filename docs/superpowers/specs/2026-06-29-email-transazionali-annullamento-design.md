# Design — Email transazionali ordine + annullamento cliente

Data: 2026-06-29
Stato: approvato (design), pre-implementazione

## Obiettivo

Inviare al cliente email transazionali sui passaggi chiave dell'ordine e
consentire l'**annullamento self-service** entro la finestra prevista dal T&C
(Art. 8.6 = fino a 2h prima dell'inizio della fascia), con rimborso automatico
sul metodo di pagamento originale. Gli stati intermedi (in preparazione, in
consegna) restano su WhatsApp manuale (T&C Art. 5.7).

Lingua: IT/EN automatico dalla lingua scelta dal cliente. Mittente:
`store@gelateriamontepetrosu.it` via SMTP Register.it (provider UE → nessun
trasferimento extra-UE).

## Le 5 email

| Evento | Trigger | Contenuto chiave (allineato T&C) | Pulsante annulla |
|---|---|---|---|
| **ricevuto** | `stripe-webhook.js` dopo insert ordine | Proposta d'ordine **ricevuta**; il contratto si perfeziona **solo con l'accettazione** del Venditore (Art. 5.4); riceverà comunicazioni a breve; riepilogo; link T&C; recesso escluso (Art. 8) | SÌ se in finestra |
| **accettato** | `admin.js` → `send-order-email` | Ordine **accettato** = conferma su supporto durevole (Art. 5.6): prodotti+caratteristiche, prezzo totale, eventuale costo consegna, esclusione recesso, **istruzioni conservazione** (consumo preferibilmente immediato, no ricongelamento), accesso allergeni; link T&C | SÌ se in finestra |
| **consegnato** | `admin.js` → `send-order-email` | Ringraziamento | no |
| **rifiutato** | `admin.js` → `send-order-email` (dopo refund) | Impossibile evadere (Art. 5.5); **rimborso integrale sul canale originale** | no |
| **annullato** | flusso cancel cliente | Annullamento confermato; **rimborso €X sullo stesso metodo di pagamento** | no |

## Template

- HTML email **table-based** + CSS **inline** (compatibilità client).
- Palette/identità del sito (avorio/terracotta). Titoli serif con fallback
  `Georgia` (i webfont non rendono in molti client email); corpo sans di
  sistema.
- Logo in testa via URL **assoluto** `https://www.gelateriamontepetrosu.it/img/logo-full.png`.
- Corpo: riepilogo ordine (prodotti, gusti, qty, data/fascia, consegna/ritiro, totale).
- Footer: identità Venditore (stessi dati legali — placeholder finché non forniti),
  link a T&C e privacy, nota "la versione italiana fa fede".
- Moduli: `lib/email-templates.js` (render IT/EN, una funzione per evento) +
  `lib/mailer.js` (`sendMail` via nodemailer, no-op se env mancanti).

## Flusso annullamento (sensibile: link non autenticato → rimborso)

Endpoint: `netlify/functions/cancel-order.js`. Pagine **rese dalla function**
(HTML server-side, niente JS client, token mai esposto in pagina statica).

- Link in email: `https://www.gelateriamontepetrosu.it/.netlify/functions/cancel-order?token=<cancel_token>`
  (eventuale alias pretty `/annulla` via redirect in `netlify.toml`).
- **GET = SOLO pagina di conferma** (idempotente, nessun effetto): gli email
  client fanno **prefetch** dei link → un GET non deve mai rimborsare. La pagina
  mostra riepilogo, "verrai rimborsato €X sullo stesso metodo", e un form con
  bottone che fa **POST** allo stesso endpoint (token in campo hidden).
- **POST = esegue**: ri-valida token + ricontrolla **lato server** finestra e
  stato; se ok → rimborso (logica `refund.js`: `stripe.refunds.create({payment_intent})`),
  stato→`annullato`, invio email "annullato". **Idempotente** (se già
  rimborsato/annullato → pagina "già annullato").
- **Non annullabile** (fuori finestra, stato non idoneo, già rimborsato) → pagina
  "Non è più possibile annullare. Per informazioni scrivici su **WhatsApp** [link]".

### Regola finestra (coerente con order.js)

Annullabile se **tutte**:
1. `status ∈ {ricevuto, accettato}` (oltre = preparazione iniziata, Art. 8.6);
2. `now < (inizio_fascia − anticipo)` dove `anticipo` = setting globale (default 2h),
   lo **stesso** usato da `order.js` per nascondere le fasce (`hmToMin` + SETTINGS);
3. `refunded_at` nullo.

Parsing inizio fascia da `slot_label`: delivery `"18:00 - 18:30"` → `18:00`;
pickup `"Ritiro 18:30"` → `18:30`. Calcolo cutoff in timezone **Europe/Rome**
(DST-aware) a partire da `delivery_date` + ora inizio.

## Invio SMTP

`nodemailer`, host `smtps.register.it:465` (SSL), user
`store@gelateriamontepetrosu.it`, pass da env Netlify **`SMTP_PASS`** (mai nel
codice/client). Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM`. Invio best-effort: un fallimento logga ma non rompe webhook/refund.

## Modifiche dati (migration Supabase additiva)

- `orders.lang text` — la lingua scelta oggi **non** è persistita sull'ordine
  (passata solo a Stripe come locale). Necessaria per IT/EN.
- `orders.cancel_token text unique` — random (es. `gen_random_uuid()` o
  `encode(gen_random_bytes(16),'hex')`), generato alla creazione ordine in
  `stripe-webhook.js` (o in `create-checkout` sulla bozza, propagato).
- `payment_intent`, `refunded_at`, `refund_id` già esistenti (usati da `refund.js`).

## Trigger

- **ricevuto**: in `stripe-webhook.js` dopo l'insert (best-effort, come print/Telegram).
- **accettato / consegnato / rifiutato**: `admin.js` chiama
  `POST /.netlify/functions/send-order-email { order_id, status }`. Per
  `rifiutato` l'invio segue il refund già esistente.
- **annullato**: dentro `cancel-order.js` (POST).

## Hardening auth (in scope, scelta utente)

- `refund.js` oggi è **non autenticato** (debito annotato nel file: chiunque
  conosca `order_id` può innescare rimborsi). Va protetto con auth admin reale.
  Back office usa Supabase Auth (utente `admin@…`): proteggo `refund.js` e il
  nuovo `send-order-email.js` verificando il **JWT Supabase** dell'admin
  (header `Authorization: Bearer <access_token>`), validato server-side
  (`supabase.auth.getUser(token)` con service role o JWKS). `admin.js` passa il
  token (già disponibile dalla sessione `signInWithPassword`).
- `cancel-order.js` **non** usa auth admin: è gated dal `cancel_token`
  per-ordine (segreto, monouso di fatto perché dopo l'annullo l'ordine è terminale).

## Sicurezza / edge

- GET cancel = mai side-effect (anti-prefetch). POST = unica via che rimborsa.
- Token random ≥128 bit, confronto costante non necessario ma token non loggato.
- Idempotenza rimborso via `refunded_at` (già in `refund.js`).
- Race: due POST concorrenti → il secondo trova `refunded_at` valorizzato → no
  doppio rimborso. Verificare con re-select prima del refund.
- Email a indirizzo assente → skip (campo opzionale).
- `order.js:751` email test hardcoded `mario.rossi@email.it` → rimuovere prima del prod.

## Fuori scope (ora)

- F-DEPLOY (publish/public). Riempimento dati identità legali (workstream separato).
- WhatsApp API (futuro). Allergeni per-gusto (rischio formale accettato).

## Verifica

- `npm run lint` + `npm run typecheck` (tocco `netlify/functions/` = pagamenti) verdi.
- Test: parsing finestra (slot delivery/pickup, DST, dentro/fuori), idempotenza
  cancel, render template IT/EN, gate `[[` su doc serviti (già pianificato).
- Prova end-to-end su `netlify dev` con Stripe test prima del go-live.
