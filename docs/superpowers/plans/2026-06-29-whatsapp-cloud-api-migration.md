# Piano — Migrazione WhatsApp → Cloud API (invio automatico aggiornamenti stato)

Data: 2026-06-29 · Stato: **pianificato, da riprendere** (non iniziato)

## Obiettivo
Migrare gli aggiornamenti di stato ordine dal **wa.me manuale** (il titolare clicca e
invia) all'**invio automatico** via WhatsApp Cloud API, con template approvati da Meta.

## Stato attuale (cosa c'è oggi)
- `js/admin.js`: bottoni stato → `changeStatus(o, status)` → `waOpen(o, status)` apre
  `https://wa.me/<telefono>?text=<template>` → **il titolare invia a mano**.
- Template per stato in `settings.wa_templates` (+ `WA_DEFAULTS` in admin.js). Stati:
  accettato, in preparazione, in consegna, consegnato, rifiutato, annullato.
  Variabili: `{nome}`, `{giorno}`, `{fascia}`, `{indirizzo}`.
- Numero `393793732437` = WhatsApp normale, usato anche per "Scrivici" in home/footer
  (`index.html` wa-link) e nell'admin per messaggiare i clienti.
- Lingua cliente disponibile su `orders.lang` (IT/EN).

## Target
Invio automatico (server-side) dei 6 update di stato via Cloud API, template approvati,
IT/EN. Manuale tenuto come fallback durante la transizione.

---

## Phase 0 — Decisioni da prendere PRIMA
1. **Cloud API diretta (Meta)** vs **BSP** (Twilio / 360dialog).
   - Consiglio: **Cloud API diretta** — più economica (no markup), già abbiamo le function Netlify.
   - BSP = onboarding più facile ma costo extra + un sub-responsabile in più (GDPR).
2. **Numero**: la WABA "consuma" il numero → **non più usabile nell'app WhatsApp normale**.
   - Consiglio: **numero NUOVO dedicato all'API** per gli update automatici. Tenere
     `393793732437` come WhatsApp umano per la chat "Scrivici".
   - Alternativa: migrare `393793732437` all'API (ma si perde l'app WhatsApp su quel numero;
     l'inbound andrebbe gestito via API/inbox).
3. **Fallback**: tenere `waOpen` manuale finché l'auto è stabile, poi disattivarlo.

## Phase 1 — Setup Meta (dashboard, no codice) — *1-5 giorni per verifiche*
1. **Meta Business Account** (business.facebook.com) + **Business Verification** (documenti
   azienda — può richiedere giorni).
2. **Meta for Developers** → crea App tipo *Business* → aggiungi prodotto **WhatsApp**.
3. Crea **WABA** + aggiungi il **numero dedicato** → verifica via SMS/chiamata.
4. **Display name** approvato (nome mostrato ai clienti).
5. **System User + permanent token** (Business Settings → System users) con permessi
   `whatsapp_business_messaging` + `whatsapp_business_management`.
   ⚠️ Il token della pagina API Setup scade in 24h — serve quello **permanente**.
6. Annota: **WABA ID**, **Phone Number ID**, **permanent token**.

## Phase 2 — Template approvati (Meta) — *minuti/ore per approvazione*
- Per ognuno dei 6 stati: template **categoria Utility** con variabili `{{1}}` nome,
  `{{2}}` giorno, `{{3}}` fascia/indirizzo.
- Sottometti per approvazione.
- ⚠️ Vincolo chiave: fuori dalla finestra 24h (gli update sono business-initiated) si può
  inviare **SOLO template approvati**, niente testo libero. I `wa_templates` liberi attuali
  vanno convertiti in template Meta.
- IT/EN: template separati per lingua (si usa `order.lang`).

## Phase 3 — Codice — *~mezza giornata*
- Env Netlify: `WHATSAPP_TOKEN` (permanent), `WHATSAPP_PHONE_NUMBER_ID`.
- `netlify/functions/lib/whatsapp.js`: `sendTemplate(toE164, templateName, lang, params)`
  → `POST https://graph.facebook.com/v22.0/{phone_number_id}/messages` (type=template).
  Best-effort, non blocca il flusso (come telegram/email).
- `netlify/functions/send-wa-update.js`: auth admin (come `send-order-email`), chiamata da
  `admin.js` sul cambio stato.
- `admin.js changeStatus`: sostituire `waOpen` (manuale) con chiamata a `send-wa-update`
  (auto) per i 6 stati; telefono in **E.164** (`+39…`). Mappare `wa_templates` → nomi
  template Meta.
- Riuso del pattern esistente (lib + function autenticata + chiamata da admin con JWT).

## Phase 4 — Legale / Privacy — *obbligatorio, ~1h*
WhatsApp passa da "canale tecnico del titolare" (account personale) a **Meta Platforms
Ireland = responsabile del trattamento** (DPA Meta) + trasferimento USA (DPF/SCC).
- Privacy: aggiornare Sez. 5 (responsabili → Meta/WhatsApp Business) + Sez. 6 (trasferimento).
- T&C Art. 5.7: da "invia manualmente via WhatsApp" → "invio automatico via WhatsApp
  Business API".
- (Si combina con i 4 item legali ancora aperti: Telegram interno, OSRM, Supabase EU, Garante URL.)

## Phase 5 — Test + rollout
- Test su numero proprio: ordine → cambio stato → template arriva.
- (Opz.) Webhook stato consegna per monitorare delivery + costi.
- Rollout graduale, manuale come fallback finché stabile.

---

## Costi / tradeoff
- **Pro**: automazione totale, niente click manuale, professionale, scalabile.
- **Contro**:
  - **Costo per messaggio**: dal 1 luglio 2025 Meta fattura **per-messaggio** (non più
    per-conversazione). Categoria **Utility**; **Italia ha tariffa propria** con sconti a
    volume. ⚠️ Tariffa €/msg attuale **da verificare sulla rate card Meta** (cambia spesso;
    ordine di grandezza pochi centesimi/msg). Utility **gratis** solo dentro la finestra 24h
    (cliente che scrive per primo) — gli update sono business-initiated → a pagamento.
  - **Onboarding lento**: business verification + display name + template approval (giorni).
  - **Numero dedicato** = seconda SIM/numero.
  - **Meta come responsabile** (GDPR) — aggiornamento privacy.

## Stima effort
| Fase | Tempo |
|---|---|
| Setup Meta + verifiche (dashboard) | 1-5 giorni (dipende da Meta) |
| Template | 1-2 ore |
| Codice (Phase 3) | ~mezza giornata |
| Legale | ~1 ora |

## Divisione lavoro
- **Vla**: Phase 1-2 (Meta dashboard, verifiche, template) — guidato passo-passo come per Stripe.
- **Claude**: Phase 3 (codice) quando ci sono numero + Phone Number ID + permanent token;
  Phase 4 (legale) insieme agli altri item.

## Fonti (verificate 2026-06-29)
- Meta — WhatsApp Pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta — Cloud API Get Started: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/
- respond.io — WhatsApp API Pricing 2026: https://respond.io/blog/whatsapp-business-api-pricing
