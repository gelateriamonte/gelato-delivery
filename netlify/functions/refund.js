// POST /.netlify/functions/refund   body: { order_id, status: "rifiutato" | "annullato" }
// Rimborsa un ordine PAGATO sul metodo originale e ne aggiorna lo stato. Idempotente.
// AUTH: richiede admin autenticato (header Authorization: Bearer <supabase access_token>).

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { refundOrder } = require("./lib/refund-core");
const { requireAdmin } = require("./lib/admin-auth");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const json = (s, o) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });

  const auth = await requireAdmin(event, supa);
  if (!auth.ok) return json(auth.code, { error: auth.error });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }
  if (!body.order_id) return json(400, { error: "order_id mancante." });

  try {
    const r = await refundOrder(supa, stripe, body.order_id, body.status);
    if (!r.ok) return json(r.code || 502, { error: r.error });
    return json(200, r);
  } catch (e) {
    return json(502, { error: "Rimborso fallito: " + (e.message || "") });
  }
};
