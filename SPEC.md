# SPEC — Prototipo Gelato Delivery (2026-06-04)

## Obiettivo
Prototipo funzionante per validare il flusso base: il cliente compone e **invia** un
ordine da web app mobile (no pagamento), il gelataio lo **riceve in tempo reale** e
gestisce parametri/ordini dal back office.

## Decisioni (approvate)
- Backend: **Supabase** (Postgres + Realtime). Frontend statico parla diretto a Supabase.
- Frontend: **HTML/CSS/JS vanilla**, mobile-first. Deploy **Netlify**, codice repo **gelato-delivery**.
- **No pagamento** (solo invio ordine). **Costo consegna unico** (no zone).
- Back office dietro **password semplice** lato client. RLS permissiva. → solo prototipo.

## Componenti
| Unit | Scopo | Dipende da |
|---|---|---|
| `index.html` + `order.js` | comporre e inviare ordine | Supabase tables, config |
| `admin.html` + `admin.js` | gestione parametri + ordini live | Supabase tables, realtime, config |
| `supabase-client.js` | init client condiviso | config.js, supabase-js CDN |
| `schema.sql` | tabelle, seed, RLS, realtime | — |

## Dati (Supabase)
- `flavors`(name, available, sort_order)
- `formats`(name, max_flavors, price, available, sort_order)
- `time_slots`(label, active, sort_order)
- `settings`(delivery_cost, min_order) — riga singola
- `orders`(customer_name, phone, address, slot_label, items jsonb, subtotal, delivery_cost, total, notes, status, created_at)

## Flussi
- **Ordine**: carica gusti/formati/slot disponibili → modale scelta gusti (max per formato) →
  carrello → check ordine minimo → form contatti → insert `orders` → conferma.
- **Back office**: login → tab Ordini (realtime INSERT/UPDATE, cambio stato), Gusti, Formati,
  Fasce, Parametri (CRUD su tabelle).
- **Stati ordine**: ricevuto → accettato → in preparazione → in consegna → consegnato (+ rifiutato/annullato).

## Fuori scope (prototipo)
Pagamento, auth reale, zone multiple, capacità slot, notifiche esterne, account cliente.

## Verifica
1. `schema.sql` eseguito senza errori, tabelle popolate dai seed.
2. Mobile: ordine inviato → riga in `orders`.
3. Back office aperto in altro tab → l'ordine compare **live** senza refresh.
4. Modifica di un parametro (es. prezzo formato) → si riflette nella mobile app dopo reload.
