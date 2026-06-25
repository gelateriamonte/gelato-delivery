// Verifica cosa puo' fare la anon key pubblica. Uso: node test/security-assert.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8')
const url = cfg.match(/url:\s*"([^"]+)"/)[1]
const anon = cfg.match(/anonKey:\s*"([^"]+)"/)[1]
const sb = createClient(url, anon)

async function probe(label, q) {
  const { data, error } = await q
  console.log(`${label}: ${error ? 'DENIED (' + error.message + ')' : (data?.length ?? 0) + ' rows'}`)
}
console.log('--- letture sensibili (Fase B: DENIED/0) ---')
await probe('orders.select',         sb.from('orders').select('*').limit(1))
await probe('discount_codes.select', sb.from('discount_codes').select('*').limit(1))
console.log('--- scritture (Fase B: DENIED) ---')
await probe('flavors.insert',        sb.from('flavors').insert({ name: '__probe__', sort_order: 999 }).select())
console.log('--- catalogo pubblico (sempre leggibile) ---')
await probe('flavors.select',        sb.from('flavors').select('*').limit(1))
await probe('settings.select',       sb.from('settings').select('*').limit(1))
console.log('--- RPC (sempre eseguibili) ---')
const today = new Date().toISOString().slice(0, 10)
await probe('rpc_slot_availability', sb.rpc('rpc_slot_availability', { p_date: today }))
console.log('rpc_coupon_precheck:', JSON.stringify((await sb.rpc('rpc_coupon_precheck', { p_code: '__nope__', p_phone: '', p_email: 'x' })).data))
