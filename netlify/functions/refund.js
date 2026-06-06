// POST /.netlify/functions/refund   body: { order_id, status: "rifiutato" | "annullato" }
// Rimborsa un ordine PAGATO sul metodo originale (carta/Satispay/PayPal) e ne aggiorna lo stato.
// Idempotente: se già rimborsato, non rimborsa due volte.
// ATTENZIONE (debito noto): endpoint non autenticato come il resto dell'app. Prima del go-live
// va protetto con auth admin vera (chiunque conosca l'URL può innescare rimborsi = griefing).

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const json = (s, o) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }
  const { order_id } = body;
  if (!order_id) return json(400, { error: "order_id mancante." });
  const newStatus = body.status === "annullato" ? "annullato" : "rifiutato";

  try {
    const { data: order, error } = await supa.from("orders")
      .select("id,total,payment_id,payment_intent,refunded_at").eq("id", order_id).maybeSingle();
    if (error || !order) return json(404, { error: "Ordine non trovato." });
    if (order.refunded_at) return json(200, { ok: true, already: true, refunded_at: order.refunded_at });   // idempotente
    if (!order.payment_id) return json(400, { error: "Ordine senza pagamento da rimborsare." });

    // serve il PaymentIntent: usa quello salvato, altrimenti recuperalo dalla sessione Checkout
    let pi = order.payment_intent;
    if (!pi) {
      const session = await stripe.checkout.sessions.retrieve(order.payment_id);
      pi = session && session.payment_intent;
    }
    if (!pi) return json(502, { error: "PaymentIntent non trovato per il rimborso." });

    const refund = await stripe.refunds.create({ payment_intent: pi });
    const refunded_at = new Date().toISOString();
    await supa.from("orders").update({
      status: newStatus, refunded_at, refund_id: refund.id, payment_intent: pi,
    }).eq("id", order_id);

    return json(200, { ok: true, refund_id: refund.id, refunded_at, status: newStatus });
  } catch (e) {
    return json(502, { error: "Rimborso fallito: " + (e.message || "") });
  }
};
