// POST /.netlify/functions/send-order-email   body: { order_id, status }
// Invia al cliente l'email transazionale per lo stato indicato (accettato,
// consegnato, rifiutato, annullato). Chiamata dal back office.
// AUTH: admin autenticato (Authorization: Bearer <supabase access_token>).
// Best-effort: se l'ordine non ha email o SMTP non è configurato, risponde ok+skipped.

const { createClient } = require("@supabase/supabase-js");
const { requireAdmin } = require("./lib/admin-auth");
const { sendOrderEmail } = require("./lib/order-email");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const json = (s, o) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

const ALLOWED = new Set(["accettato", "consegnato", "rifiutato", "annullato"]);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });

  const auth = await requireAdmin(event, supa);
  if (!auth.ok) return json(auth.code, { error: auth.error });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }
  if (!body.order_id || !ALLOWED.has(body.status)) return json(400, { error: "order_id o status non validi." });

  const { data: order, error } = await supa.from("orders")
    .select("id,customer_name,email,lang,fulfillment,address,delivery_date,slot_label,items,subtotal,delivery_cost,discount,coupon_code,total,cancel_token,status,refunded_at")
    .eq("id", body.order_id).maybeSingle();
  if (error || !order) return json(404, { error: "Ordine non trovato." });

  const res = await sendOrderEmail(order, body.status);
  return json(200, { ok: true, mail: res });
};
