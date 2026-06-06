# Pagamenti online — Documento architetturale

> Stato: **piano approvato**, decisioni chiuse (vedi §0). Obiettivo: accettare **carte, PayPal e Satispay**
> (Italia) con **un unico provider**, sul progetto gelato-delivery (sito statico HTML/JS + Supabase, deploy Netlify).

## 0. Decisioni confermate (2026-06-06)

1. **Provider:** **Stripe**.
2. **Quando si paga:** **solo online anticipato** (niente contrassegno).
3. **UI:** **Stripe Embedded Checkout** (`ui_mode=embedded`) — form di pagamento dentro la pagina, no redirect, tutti i metodi (carte/PayPal/Satispay/Apple·Google Pay) automatici. PCI SAQ A.
4. **Backend:** **Netlify Functions** (`create-checkout` + `stripe-webhook`).
5. **Pagamento fallito/annullato → l'ordine NON viene processato.** L'ordine entra in `orders` **solo** a pagamento riuscito (via webhook). Errore mostrato al cliente, retry possibile. Traccia dei tentativi falliti **opzionale** in tabella separata (`payment_attempts`), che **non** entra nel flusso del back office.

> Conseguenza chiave: la tabella `orders` contiene **solo ordini pagati**. Niente bozze/sospesi nel flusso operativo.

---

## 1. TL;DR — raccomandazione

- **Sì, un solo provider basta** per carte + PayPal + Satispay (+ Apple/Google Pay).
- **Provider consigliato: Stripe** (miglior developer experience, un'unica UI "Payment Element" o "Checkout"
  che mostra carte/PayPal/Satispay/wallet, ottima documentazione, integrazione serverless facile). Satispay è
  supportato da Stripe da **marzo 2025** per merchant in Italia.
- **Alternative valide:** **Mollie** (europeo, pricing semplice, in più Bancomat Pay) e **Nexi XPay** (acquirer
  italiano, in più Bancomat Pay; integrazione più burocratica ma supporto/condizioni locali).
- **Vincolo non negoziabile:** i pagamenti **richiedono un backend** (una funzione serverless). Il sito oggi è
  statico → va aggiunto un piccolo strato server (consigliato **Netlify Functions**, già siamo su Netlify).

---

## 2. Vincolo chiave: serve un backend

Oggi l'app è 100% statica (HTML/JS) + Supabase via anon key. Per i pagamenti **non si può** restare solo client:
- La **chiave segreta** del PSP non può stare nel browser (verrebbe rubata).
- L'importo e la conferma del pagamento vanno validati **lato server** (un client può barare).
- Serve un **webhook** (il PSP che chiama il nostro server) per sapere con certezza che il pagamento è andato.

Due opzioni per il backend (entrambe gratis/quasi a volume basso):
- **Netlify Functions** (consigliato): siamo già su Netlify, due funzioni (`create-checkout`, `webhook`),
  niente nuova infrastruttura.
- **Supabase Edge Functions**: vicino al DB, Deno. Ok se preferiamo concentrare tutto su Supabase.

---

## 3. Confronto provider

| | **Stripe** | **Mollie** | **Nexi XPay** |
|---|---|---|---|
| Carte (Visa/MC/Amex…) | ✓ | ✓ | ✓ |
| PayPal | ✓ (EU) | ✓ | ✓ |
| Satispay | ✓ (mar 2025) | ✓ | ✓ |
| Apple/Google Pay | ✓ | ✓ | ✓ |
| Bancomat Pay | ✗ | ✓ | ✓ |
| Developer experience | ⭐ eccellente | buona | media/burocratica |
| Onboarding | self-service rapido | self-service | contratto Nexi |
| UI unica pronta | Payment Element / Checkout | Hosted Checkout | Hosted/Build |
| Supporto/condizioni IT | globale | EU | italiano (acquirer) |

**Scelta consigliata: Stripe** per rapidità e qualità dell'integrazione. Se contano Bancomat Pay o condizioni
italiane dedicate → Mollie o Nexi (architettura identica, cambia l'SDK).

---

## 4. Architettura consigliata (Stripe + Netlify Functions + Supabase)

Pattern: **Stripe Checkout (pagina hosted)** — il più semplice e con il minor carico PCI. (In una v2 si può
passare a **Payment Element** embedded, in-pagina, per non uscire dal sito.)

### Flusso
```
App cliente (browser)
   │  1. compone ordine → "Vai al pagamento"
   ▼
Netlify Function  create-checkout
   │  2. RICALCOLA l'importo lato server (carrello × prezzi dal DB + consegna) — non si fida del client
   │  3. salva una BOZZA in pending_orders (service-role): dati ordine + session id
   │  4. crea Stripe Checkout Session (ui_mode=embedded, EUR, metodi auto) → ritorna client_secret
   ▼
Embedded Checkout (in pagina)  ←── carte / PayPal / Satispay / Apple·Google Pay
   │  5. cliente paga (nessun redirect)
   ├─ OK → 6. Stripe chiama  stripe-webhook  (checkout.session.completed)
   │            │  verifica firma → crea l'ORDINE in orders (payment_status=paid, payment_id, paid_at)
   │            │  dalla bozza → cancella la bozza → l'ordine entra nel flusso back office
   │            ▼  cliente vede "ordine confermato"
   └─ KO/annullato → errore in pagina, NESSUN ordine creato, retry possibile
                     (la bozza resta/scade; eventuale traccia in payment_attempts, fuori dal flusso)
```

**Punto importante:** la conferma "pagato" arriva **solo dal webhook** (server-to-server, firmato), mai dal
redirect del browser (falsificabile).

### Sinergia con la sicurezza (debito noto)
Spostando la **creazione dell'ordine dentro la funzione** (con service-role key, lato server) possiamo finalmente
**stringere la RLS**: l'anon key del browser passa a *sola lettura del catalogo* e non inserisce/legge più ordini
direttamente. Risolve in gran parte il problema PII oggi aperto.

---

## 5. Modifiche al modello dati (Supabase)

**Nuova tabella `pending_orders`** (bozze in attesa di pagamento, FUORI dal flusso del back office):
- `id` uuid · `session_id` text (Stripe) · `payload` jsonb (dati ordine) · `amount` numeric · `created_at`.

**Colonne su `orders`** (l'ordine nasce SOLO a pagamento riuscito):
- `payment_provider` text (`stripe`) · `payment_id` text (sessione/PaymentIntent, per riconciliazione/rimborsi) · `paid_at` timestamptz.
- `payment_status` non indispensabile (in `orders` ci sono solo pagati); lo teniamo = `paid` per chiarezza/futuro.

**(Opzionale) `payment_attempts`** — log dei tentativi falliti/annullati per statistica; non entra nel back office.

(Migrazioni additive. Back office: badge "Pagato".)

---

## 6. Sicurezza / PCI

- Con **Stripe Checkout o Payment Element** i dati carta **non passano mai** dal nostro server (pagina/iframe
  Stripe) → livello PCI più leggero (**SAQ A**). Nessun dato sensibile da custodire.
- **Chiave segreta** Stripe + **webhook signing secret**: solo in **env var della funzione** Netlify (mai nel client).
- Chiave **publishable**: nel client, ok.
- Webhook: **verificare sempre la firma** (`Stripe-Signature`) prima di fidarsi dell'evento.

---

## 7. Step di implementazione (piano)

1. **Decisioni** (vedi §9): provider, pagamento online vs contrassegno, hosted vs embedded.
2. **Account PSP**: creare account Stripe, completare onboarding/KYC (dati attività, identità, IBAN di accredito).
3. **Attivare i metodi** in dashboard: carte, PayPal, Satispay, Apple/Google Pay (Satispay richiede attivazione, mercato IT).
4. **Backend**: aggiungere Netlify Functions `create-checkout` e `stripe-webhook`; `netlify.toml` con la cartella functions; SDK Stripe; env var (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
5. **DB**: migrazione colonne pagamento (§5).
6. **Frontend**: il bottone "Invia ordine" diventa "Vai al pagamento" → chiama `create-checkout` → redirect; pagine **success** e **annullato**.
7. **Webhook** → marca l'ordine `paid`; back office mostra lo stato pagamento; (opzionale) il messaggio WhatsApp "accettato" parte solo a pagamento confermato.
8. **Test mode**: chiavi di test Stripe + carte di test + Satispay sandbox → verifica end-to-end (anche in WebKit).
9. **Go-live**: chiavi live, KYC approvato, webhook su dominio di produzione (gelato26.netlify.app).
10. (Opz. v2) **Payment Element** in-pagina + stringere la RLS (§4).

---

## 8. Costi (indicativi — da verificare sui listini aggiornati)

- Struttura tipica: **percentuale + fisso per transazione**, variabile per metodo (carta EEA < carta extra-UE;
  PayPal e Satispay hanno proprie commissioni) e per paese.
- Stripe carte EEA: ordine di grandezza **~1,5% + €0,25** (da confermare); PayPal/Satispay/wallet tariffati a parte.
- Mollie: spesso **fisso per transazione** (semplice da prevedere).
- Nexi: **negoziato** (canone + per-transazione), può convenire su volumi/acquiring italiano.
- Nessun costo fisso di setup con Stripe/Mollie (pay-as-you-go). **Verificare le commissioni correnti prima di scegliere.**

---

## 9. Decisioni — CHIUSE (vedi §0)

1. Stripe. 2. Solo online anticipato. 3. Embedded Checkout. 4. Netlify Functions. 5. Ordine creato solo se pagato; falliti/annullati fuori dal flusso (traccia opzionale).

## 10. Prerequisito per implementare (serve da te)

L'unica cosa che **non posso fare io**: l'account Stripe.
1. Crea l'account **Stripe** (o dammi accesso) e completa l'onboarding minimo per la **modalità test**.
2. In dashboard **attiva i metodi**: carte, PayPal, **Satispay**, Apple/Google Pay.
3. Passami le **chiavi di TEST** (`pk_test_…` e `sk_test_…`) + creiamo il **webhook secret** (lo configuro io).
Con le chiavi di test costruisco e **collaudo tutto end-to-end** (carte di test + Satispay sandbox, anche in WebKit) prima di toccare il live. Per i pagamenti non consegno codice non testato.

---

## Fonti (verifica metodi)
- Stripe — Satispay: https://docs.stripe.com/payments/satispay · changelog mar 2025: https://docs.stripe.com/changelog/basil/2025-03-31/satispay-lpm
- Stripe — metodi di pagamento: https://stripe.com/payments/payment-methods
- Mollie — Satispay: https://www.mollie.com/payments/satispay · metodi: https://www.mollie.com/payments/payment-methods
- Satispay Business — sviluppatori: https://developers.satispay.com/docs/welcome
- Nexi XPay — metodi (Satispay, PayPal): https://ecommerce.nexi.it/specifiche-tecniche/metodidipagamento/introduzione.html
