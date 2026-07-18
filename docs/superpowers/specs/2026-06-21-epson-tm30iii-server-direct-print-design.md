# Stampa automatica ordini su Epson TM-m30III via Server Direct Print

**Data:** 2026-06-21
**Stato:** design — da approvare prima dell'implementazione
**Owner:** Vla

> ⚠️ Questo file è **untracked** (non committato): con `publish="."` un commit sotto `docs/`
> verrebbe servito pubblicamente su `https://gelato26.netlify.app/docs/...`. Tenerlo locale.

---

## 1. Obiettivo

Quando arriva un ordine **pagato**, stamparlo automaticamente sulla stampante termica
**Epson TM-m30III** (80 mm) installata in gelateria, **senza** dipendere da un browser
aperto. Più un bottone **ristampa** manuale nel back office.

Criteri di successo verificabili:
- Ordine pagato → scontrino esce dalla stampante entro ~1 intervallo di polling (≤30 s).
- Bottone "Ristampa" su un ordine → lo scontrino riesce.
- Stampa fallita (carta finita / stampante offline) → alert Telegram al titolare.
- `npm run lint` e `npm run typecheck` verdi (il codice nuovo sta in `netlify/functions/`).

## 2. Architettura — Server Direct Print (SDP)

La TM-m30III fa da **client HTTP**: polla a intervalli un URL e stampa ciò che riceve.
Niente browser nel percorso di stampa, niente mixed-content, niente cert da gestire.
Tutto confermato sui manuali Epson (Server Direct Print User's Manual Rev.K; spec sheet
TM-m30III CPD-62919; Web Config Reference Guide Rev.C/G).

```
Cliente paga
   │ Stripe webhook (unica fonte verità del "pagato")
   ▼
stripe-webhook.js ── insert orders ──┐
   │ notifyOrder (Telegram, già esiste)
   └── insert print_jobs(status=pending) ◄── (anche: bottone Ristampa admin)
                                          │
                       Supabase print_jobs (coda)
                                          ▲
        ┌─────────────────────────────────┘
        │ polling ogni ~15 s (la stampante chiama)
   ┌────▼─────────────────────────────────────────┐
   │ Netlify Function  /.netlify/functions/epson-sdp│
   │  GetRequest  → serve job più vecchio + XML     │
   │  SetResponse → marca done / error              │
   └───────────────────────────────────────────────┘
        │ ePOS-Print XML scontrino
   ┌────▼────┐
   │ TM-m30III│ stampa → SetResponse(success)
   └─────────┘
```

### Componenti (5)

| # | Artefatto | File |
|---|---|---|
| 1 | Tabella coda `print_jobs` | `supabase/migration-2026-06-21-print-jobs.sql` |
| 2 | Endpoint polling SDP | `netlify/functions/epson-sdp.js` |
| 3 | Builder scontrino ePOS-Print XML | `netlify/functions/lib/receipt.js` |
| 4 | Auto-enqueue su ordine pagato | modifica `netlify/functions/stripe-webhook.js` |
| 5 | Bottone "Ristampa" | modifica `admin.html` + `js/admin.js` |

## 3. Data model — `print_jobs` + RPC di claim

```sql
create table if not exists print_jobs (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  status      text not null default 'pending',   -- pending | printing | done | error
  printjobid  text,                               -- id correlazione SDP (≤30 char), set al claim
  attempts    int  not null default 0,            -- incrementato su SetResponse success=false
  reclaims    int  not null default 0,            -- quante volte ri-servito senza ack stampante
  last_error  text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,                        -- quando passa a 'printing' (per reclaim)
  printed_at  timestamptz
);
create index if not exists print_jobs_pending_idx on print_jobs (created_at) where status = 'pending';

alter table print_jobs enable row level security;
-- anon (anon key è pubblica in config.js) serve SOLO al bottone Ristampa → INSERT, niente altro.
-- La function usa SERVICE_ROLE (bypassa RLS) per select/update/claim. print_jobs NON contiene PII.
create policy "proto anon print_jobs insert" on print_jobs for insert to anon with check (true);
grant insert on print_jobs to anon;
```

**Claim atomico + invariante "max 1 job in `printing`".** supabase-js non sa esprimere
`UPDATE … ORDER BY … LIMIT 1 RETURNING` atomico (è SELECT-poi-UPDATE = TOCTOU sotto poll
concorrenti). Quindi il claim è una **RPC Postgres** chiamata dalla function via
`supa.rpc('claim_print_job')`:

```sql
-- Serve UN job per volta e garantisce che non ci sia mai più di un job in 'printing'.
-- (1) reclaim degli stallati (printer ha preso il job ma non ha mai confermato);
-- (2) se resta un 'printing' attivo → non claimare (un solo scontrino in volo);
-- (3) altrimenti claima il 'pending' più vecchio con lock riga.
create or replace function claim_print_job(reclaim_after interval default interval '5 minutes',
                                           max_reclaims int default 3)
returns setof print_jobs
language plpgsql
as $$
declare job print_jobs;
begin
  update print_jobs
     set status     = case when reclaims + 1 > max_reclaims then 'error' else 'pending' end,
         reclaims   = reclaims + 1,
         last_error = case when reclaims + 1 > max_reclaims then 'reclaim_exhausted' else last_error end
   where status = 'printing' and claimed_at < now() - reclaim_after;

  if exists (select 1 from print_jobs where status = 'printing') then
    return;                                  -- invariante: un solo job in volo
  end if;

  select * into job from print_jobs
   where status = 'pending' order by created_at
   for update skip locked limit 1;
  if not found then return; end if;

  update print_jobs
     set status = 'printing', claimed_at = now(),
         printjobid = left(replace(job.id::text, '-', ''), 30)
   where id = job.id
   returning * into job;
  return next job;
end;
$$;
```

`status`: `pending` → `printing` (servito alla stampante) → `done` (success) | `error`
(retry/reclaim esauriti). L'invariante "1 solo `printing`" rende la **correlazione del
SetResponse deterministica anche senza `printjobid`** (firmware v1.00): il risultato mappa
sull'unica riga `printing`. `printjobid` (30 hex, charset SDP alnum+`_-.`, univoco di fatto)
resta come cross-check con firmware v2.00.

## 4. Contratto della Function `epson-sdp`

Una sola function, branch su `ConnectionType` (body `application/x-www-form-urlencoded`).
Usa `@supabase/supabase-js` con `SUPABASE_SERVICE_ROLE_KEY` (già in env, bypassa RLS).

### Auth (fail-closed)
- Env `EPSON_SDP_ID` = stringa segreta ad alta entropia (**≥32 char**). La stampante la manda
  in **ogni** richiesta nel campo `ID` (impostata in Web Config). Validazione: `ID === EPSON_SDP_ID`.
- **Fail-closed**: se `EPSON_SDP_ID` manca/è vuota → non servire mai (return `200` vuoto). Evita
  che `ID===undefined` autentichi una richiesta senza `ID`.
- `ID` non valido → `200` body vuoto (non si rivela nulla, non si serve PII).
- I log Netlify non devono contenere l'XML dello scontrino (PII). Digest auth Epson = futuro.

### `ConnectionType=GetRequest`
1. Valida `ID` (fail-closed). KO → `200` body vuoto.
2. `supa.rpc('claim_print_job')` → 0 o 1 riga (fa reclaim+claim atomici, vedi §3).
3. Nessun job → `200`, `Content-Type: text/xml; charset=utf-8`, **body vuoto** (= niente da stampare).
4. Carica l'ordine (service role). `buildReceiptXml(order)` in **try/catch**: se lancia (dati
   ordine malformati) → job → `error` + alert Telegram, return `200` body vuoto (mai lasciarlo
   `printing`, mai `500`). 
5. Avvolge lo scontrino:

```xml
<?xml version="1.0" encoding="utf-8"?>
<PrintRequestInfo Version="2.00">
 <ePOSPrint>
  <Parameter>
   <devid>local_printer</devid>
   <timeout>10000</timeout>
   <printjobid>__HEX30__</printjobid>
  </Parameter>
  <PrintData>
   <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
    <!-- contenuto scontrino -->
   </epos-print>
  </PrintData>
 </ePOSPrint>
</PrintRequestInfo>
```

Risposta: `200`, `Content-Type: text/xml; charset=utf-8`. **Un solo job per poll** (correlazione
pulita via invariante §3; batch multiplo = ottimizzazione futura). Version `2.00` (con
`printjobid`); se il firmware non l'accetta → fallback `1.00` senza `Version`/`printjobid`
(correlazione comunque sicura grazie all'invariante "1 solo printing").

### `ConnectionType=SetResponse`
**Sempre `200` body vuoto verso la stampante**, anche su errore interno o parse fallito (un
`500`/non-200 fa ri-POSTare la stessa SetResponse all'infinito). Tutto in try/catch.
1. Valida `ID` (fail-closed).
2. Trova il job: l'unica riga `status='printing'` (cross-check con `printjobid` se presente nel
   `ResponseFile`). Nessuna riga `printing` → SetResponse duplicato/tardivo → `200` no-op.
3. Parse `ResponseFile` (campo del body form, **URL-decodificato** prima del regex): leggi solo
   il **primo** `<response …>`. `success` assente → tratta come **failure** (non success).
   `code` assente → sentinella (`"?"`).
4. `success=true` → job `done`, `printed_at=now()`.
5. `success=false` → `attempts++`, `last_error=code`; se `attempts < 3` → torna `pending`;
   se `attempts >= 3` → update `status='error'` **con guardia `where status != 'error'`**; se
   ha effettivamente transitato (rowCount>0) → **alert Telegram** una sola volta
   (`sendTelegram("⚠️ Stampa fallita ordine #<hex> — <code>")`, include `order_id`).
6. return `200` body vuoto.

> Parsing: niente DOMParser/dipendenze. Regex mirata sul **primo** `<response …>`
> (`/<response\b[^>]*\bsuccess="([^"]*)"[^>]*>/`, idem per `code`), con null-guard sul match
> (`tsc --checkJs`: `.match()` può essere `null`). `event.body` è `string | undefined` → guard.

## 5. Scontrino (ePOS-Print XML) — `lib/receipt.js`

`buildReceiptXml(order) → string` (solo gli elementi `<epos-print>…</epos-print>`).
80 mm = **48 colonne** (Font A). Scelta: **completo con prezzi** (vale da copia cliente).

Layout (dal mock approvato):
```
============== centrato, doppia altezza ========
              G E L A T O 2 6
================================================
Ordine #<8hex>            <gg/mm/aaaa hh:mm>     ← created_at, Europe/Rome
------------------------------------------------
*** CONSEGNA *** | *** RITIRO ***   (bold, em)
Consegna: <delivery_date>   <slot_label>
------------------------------------------------
<customer_name>            <customer_phone>
<address>  (solo se delivery, wrap a 48)
------------------------------------------------
<qty>x <format>                         <riga €>  ← prezzo_unit*qty, right-aligned
   <gusti.join(", ")>  (wrap/indent)
… per ogni item
------------------------------------------------
Subtotale                              <subtotal>
Consegna                          <delivery_cost> (solo se >0)
Sconto <coupon_code>                  -<discount> (solo se presente)
TOTALE                          <total> (bold, doppia altezza)
------------------------------------------------
Pagato: <payment_method upper>
Note: <notes>  (solo se presenti, wrap)
================================================
<feed line="3"/><cut type="feed"/>
```

Helper interni: `esc(s)` (XML-escape `& < > " '`), `padLine(left,right,w=48)`
(riempe con spazi, tronca a 48), `wrap(s,w)` (a capo morbido), `euro(n)`
(`"16,00"`, virgola). Forma `items`: `{ format, gusti:[], qty, prezzo_unit }` (confermata
in `order.js`/`telegram.js`). Date: format manuale `gg/mm/aaaa` + `hh:mm` (no dipendenze).

Elementi ePOS-Print usati: `<text align="center"/>`, `<text em="true"/>` (bold),
`<text width="2" height="2"/>` SOLO per il titolo centrato (no padding math), `<text>…&#10;</text>`,
`<feed line="n"/>`, `<cut type="feed"/>`.

**Regole builder (dai casi limite della review):**
- **Escape PRIMA, newline DOPO**: `esc()` sui campi cliente (name/address/notes possono contenere
  `& < > " '`), poi iniettare i `&#10;`. Mai escapare il `&#10;`.
- **Larghezza colonne**: `padLine` calcola su **48 colonne**. Il TOTALE usa `height="2"`
  (doppia *altezza*, **non** larghezza) + `em` → resta 48 colonne, padLine valido. Il titolo è
  l'unico `width="2"` ma è **centrato** (nessun calcolo padding). Troncare per code-point.
- **Campi opzionali** (suppressione completa della riga): `address` solo se `delivery`; riga
  "Consegna:" → **"Ritiro:"** se `fulfillment==='pickup'`; `delivery_cost` solo se `> 0`;
  "Sconto" solo se `discount > 0` (test numerico, non truthiness); "Pagato:" solo se
  `payment_method` valorizzato (può essere `null` dal webhook); "Note:" solo se presenti.
- **Item difensivi**: `items` vuoto → nessuna riga prodotto (subtotale/totale comunque stampati);
  `qty` mancante → default 1; `prezzo_unit` mancante → 0.

## 6. Hook auto-enqueue — `stripe-webhook.js`

Dopo `insert(order)`, recuperare l'id e accodare il job (best-effort, come Telegram —
non deve mai far fallire il 200 a Stripe):

```js
const { data: ins, error: insErr } = await supa.from("orders").insert(order).select("id").single();
if (insErr) return { statusCode: 500, body: "insert ordine: " + insErr.message };
// … coupon burn, telegram (invariati) …
try { await supa.from("print_jobs").insert({ order_id: ins.id }); }
catch (e) { console.error("print enqueue:", e.message); }
```

(Unica modifica funzionale: `.select("id").single()` per avere l'id; resto invariato.)

**Idempotenza preservata**: il check duplicato preesistente (`select id where payment_id=session.id`
→ `200 "duplicato, skip"` *prima* dell'insert) intercetta i retry Stripe, quindi l'enqueue non
viene mai eseguito due volte per lo stesso pagamento. La semantica `500 on insErr` è quella già
in essere. `null-guard` su `ins` (`tsc --checkJs`: `.single()` data può essere `null`).

## 7. Ristampa manuale — `admin.html` + `admin.js`

Bottone "🖨️ Ristampa" nella card ordine (vicino alle azioni esistenti). Handler:

```js
async function reprint(o) {
  const { error } = await sb.from("print_jobs").insert({ order_id: o.id });
  toast(error ? "Errore ristampa." : "In stampa…");
}
```

Accodamento via anon (RLS permissiva, coerente con gli update anon già fatti su `orders`).
Stampato al polling successivo.

## 8. Configurazione stampante (Web Config — Vla ha accesso)

Browser → IP stampante → login (password = **serial number**) → Server Direct Print:
- **Server Direct Print**: Enable
- **URL**: `https://gelato26.netlify.app/.netlify/functions/epson-sdp`
- **ID**: `<EPSON_SDP_ID>` (stesso valore della env Netlify)
- **Password**: (vuota in v1; serve solo se si attiva Digest)
- **Interval(s)**: `15`
- **Server Authentication**: Disable (Netlify ha CA pubblica; enable opzionale)
- **URL Encode**: Enable
- IP stampante: fissarlo (reservation DHCP) — un IP che cambia non rompe SDP (è la stampante
  a chiamare), ma la Web Config sì.

Env da aggiungere su Netlify: **`EPSON_SDP_ID`** (le altre — `SUPABASE_*`, `TELEGRAM_*` — ci sono già).

## 9. Affidabilità / errori

- **Reclaim a 5 min** (non 60 s): con poll 15 s + spooler + SetResponse sul ciclo successivo, una
  finestra stretta ri-stamperebbe job ancora in corso. 5 min = solo stalli reali. Contatore
  `reclaims`, cap 3 → `error` (niente alert: vedi backstop). Separato da `attempts` (solo su
  `success=false`).
- **Retry stampa**: 3 `attempts` su `success=false` (carta finita/coperchio), poi `error` + alert
  Telegram **una sola volta** (guardia sulla transizione).
- **Stampante offline**: non polla → job resta `pending` → stampa appena torna online. Nessun
  alert dedicato: l'order-notify Telegram è già partito all'arrivo dell'ordine.
- **Backstop**: l'order-notify Telegram esistente avvisa di ogni ordine anche a stampante morta;
  l'ordine resta visibile in admin.
- **Doppia stampa**: possibile solo se il `success` si perde DOPO stampa fisica e scatta il reclaim
  a 5 min — raro, accettabile per uno scontrino.
- **Spooler**: se attivo, `success` = job entrato in spool (non carta uscita). Non trattato come
  prova di stampa fisica.

## 10. Sicurezza

- Endpoint pubblico che ritorna PII → gate con `EPSON_SDP_ID` (≥32 char, validato a ogni
  richiesta, **fail-closed** se env mancante).
- Solo HTTPS. Nessun segreto nel client. `print_jobs` non contiene PII. Rotazione segreto = cambia
  env Netlify **e** campo ID in Web Config insieme.
- RLS `print_jobs`: anon **solo INSERT** (per la sola Ristampa); niente `for all`/`grant all` (la
  review ha segnalato che `for all` darebbe a chiunque ha la anon key delete/update sull'intera
  coda). La function usa SERVICE_ROLE per il resto.
- Spam ristampa via anon insert: il gate vero è l'endpoint SDP; un insert ostile accoda solo una
  ristampa di un ordine esistente. Restringibile con Supabase Auth (debito noto preesistente).
- I log Netlify non devono contenere l'XML dello scontrino (PII).

## 11. Da verificare al setup (non assunto)

1. Firmware TM-m30III accetta **PrintRequestInfo Version="2.00"** (per `printjobid`).
   Se no → fallback Version 1.00: 1 job/volta, correlazione per timing (niente printjobid).
2. Range **Interval** min/max reale (leggerlo dalla schermata Web Config).
3. Test end-to-end: ordine reale di prova → scontrino esce; staccare carta → alert Telegram.

## 12. Fuori scope (v1)

- Batch multi-job in un poll. Digest auth. Logo grafico raster sullo scontrino.
- Multi-postazione / più stampanti (SDP ne supporta 3 URL, non serve ora).
- Restringere RLS / Supabase Auth (debito noto preesistente).
