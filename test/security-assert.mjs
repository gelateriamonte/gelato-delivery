// Verifica cosa puo' fare la anon key pubblica. Uso: node test/security-assert.mjs
//
// ⚠️ Gira contro il DB di PRODUZIONE, in sola lettura, con la anon key pubblica.
//
// Ogni sonda dichiara DA QUANDO vale la sua attesa:
//   'ora' -> vale gia' oggi. Se non torna e' una REGRESSIONE: riga FAIL, exit 1.
//   '01c' -> vale solo dopo supabase/migration-2026-08-01c-settings-column-grants.sql
//   '01d' -> vale solo dopo supabase/migration-2026-08-01d-flavors-column-grants.sql
// Finche' 01c/01d non sono applicate le loro sonde stampano TODO e NON fanno
// fallire il test: oggi e' il risultato atteso, non un sito rotto.
//
// Applicate le migration, rilancia con --strict: da li' in poi ogni TODO diventa
// FAIL, cosi' un re-grant di tabella (o un rollback dimenticato) non passa
// inosservato. Le due modalita' non sono ambigue: TODO = "non ancora applicata",
// FAIL = "doveva valere e non vale".
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8')
const url = cfg.match(/url:\s*"([^"]+)"/)[1]
const anon = cfg.match(/anonKey:\s*"([^"]+)"/)[1]
const sb = createClient(url, anon)

const strict = process.argv.includes('--strict')
const has01d = existsSync(new URL('../supabase/migration-2026-08-01d-flavors-column-grants.sql', import.meta.url))
let fail = 0, todo = 0

// Colonne pubbliche = quelle che il codice pubblico chiede davvero.
// settings: elenco identico ai grant della 01c (js/order.js, js/footer-nap.js, index.html).
const SETTINGS_PUB = 'id,delivery_cost,min_order,max_advance_days,slot_lead_minutes,slot_lead_hours,opening_hours,delivery_area,home_content'
// flavors: union di js/order.js (chip gusti) e index.html (gusti del giorno).
// Deve restare un SOTTOINSIEME dei grant della 01d.
const FLAVORS_PUB = 'name,description,description_en,daily,available,sort_order'
// formats / time_slots / slot_day_state: solo js/order.js li legge.
const FORMATS_PUB = 'id,name,price,max_flavors,category,weight_kg,available,sort_order'
const SLOTS_PUB = 'id,label,active,max_deliveries,sort_order'
const SLOT_DAY_PUB = 'slot_id,day,active'

// want: 'denied' | 'ok' (nessun errore, righe indifferenti) | numero di righe atteso.
async function probe(label, since, want, q) {
  const { data, error } = await q
  const rows = data?.length ?? 0
  const got = error ? 'DENIED (' + error.message + ')' : rows + ' rows'
  const ok = want === 'denied' ? !!error : !error && (want === 'ok' || rows === want)
  const pending = !ok && since !== 'ora' && !strict
  if (pending) todo++
  else if (!ok) fail++
  console.log(`[${ok ? ' ok ' : pending ? 'TODO' : 'FAIL'}] ${since.padEnd(3)} ${label}: ${got}`)
}

console.log('--- letture sensibili (attese DENIED) ---')
await probe('orders.select',            'ora', 'denied', sb.from('orders').select('*').limit(1))
await probe('discount_codes.select',    'ora', 'denied', sb.from('discount_codes').select('*').limit(1))
// 01c: settings perde il grant di TABELLA, restano solo le colonne pubbliche.
await probe('settings.production_note', '01c', 'denied', sb.from('settings').select('production_note').limit(1))
await probe('settings.wa_templates',    '01c', 'denied', sb.from('settings').select('wa_templates').limit(1))
await probe('settings.select(*)',       '01c', 'denied', sb.from('settings').select('*').limit(1))
// 01d: stesso schema sul resto del catalogo. Su flavors sono i campi del piano di
// produzione; su formats/time_slots non c'e' (ancora) roba di back office, ma il grant
// di tabella deve sparire lo stesso — e' quello che tiene privata la PROSSIMA colonna.
if (!has01d) console.log('       nota: migration-2026-08-01d-flavors-column-grants.sql NON esiste ancora nel repo — le righe 01d sotto restano TODO')
await probe('flavors.prod_base_ratio',  '01d', 'denied', sb.from('flavors').select('prod_base_ratio').limit(1))
await probe('flavors.prod_kg',          '01d', 'denied', sb.from('flavors').select('prod_kg').limit(1))
await probe('flavors.prod_on',          '01d', 'denied', sb.from('flavors').select('prod_on').limit(1))
await probe('flavors.prod_order',       '01d', 'denied', sb.from('flavors').select('prod_order').limit(1))
await probe('flavors.special',          '01d', 'denied', sb.from('flavors').select('special').limit(1))
await probe('flavors.select(*)',        '01d', 'denied', sb.from('flavors').select('*').limit(1))
await probe('formats.created_at',       '01d', 'denied', sb.from('formats').select('created_at').limit(1))
await probe('formats.select(*)',        '01d', 'denied', sb.from('formats').select('*').limit(1))
await probe('time_slots.created_at',    '01d', 'denied', sb.from('time_slots').select('created_at').limit(1))
await probe('time_slots.select(*)',     '01d', 'denied', sb.from('time_slots').select('*').limit(1))
// slot_day_state: niente sonda select(*). Oggi la tabella ha SOLO colonne pubbliche
// (slot_id, day, active), quindi dopo la 01d il grant per colonna le copre tutte e `*`
// resterebbe leggibile: non discrimina i due stati. Il grant di tabella li' si revoca
// per la regola, non per un dato da nascondere adesso.

console.log('--- scritture (Fase B: DENIED) ---')
await probe('flavors.insert',           'ora', 'denied', sb.from('flavors').insert({ name: '__probe__', sort_order: 999 }).select())

console.log('--- catalogo pubblico (leggibile PRIMA e DOPO le migration) ---')
// Se una di queste diventa DENIED il sito pubblico non carica piu' il menu': e' il modo
// in cui una migration di grant sbagliata (colonna dimenticata) si manifesta.
await probe('flavors.select(pub)',      'ora', 1, sb.from('flavors').select(FLAVORS_PUB).limit(1))
await probe('settings.select(pub)',     'ora', 1, sb.from('settings').select(SETTINGS_PUB).eq('id', 1).limit(1))
await probe('formats.select(pub)',      'ora', 1, sb.from('formats').select(FORMATS_PUB).limit(1))
await probe('time_slots.select(pub)',   'ora', 1, sb.from('time_slots').select(SLOTS_PUB).limit(1))
// slot_day_state e' spesso vuoto (nessun override per i giorni futuri): conta che si legga.
await probe('slot_day_state.select(pub)', 'ora', 'ok', sb.from('slot_day_state').select(SLOT_DAY_PUB).limit(1))

console.log('--- RPC (sempre eseguibili) ---')
const today = new Date().toISOString().slice(0, 10)
await probe('rpc_slot_availability',    'ora', 'ok', sb.rpc('rpc_slot_availability', { p_date: today }))
console.log('rpc_coupon_precheck:', JSON.stringify((await sb.rpc('rpc_coupon_precheck', { p_code: '__nope__', p_phone: '', p_email: 'x' })).data))

console.log(`--- ${fail} FAIL, ${todo} attese-dopo-migration ---`)
if (todo) console.log("Le righe TODO sono attese finche' 01c/01d non sono applicate su produzione: non e' il sito rotto, non applicare rollback. Dopo l'apply rilancia con --strict.")
process.exit(fail ? 1 : 0)
