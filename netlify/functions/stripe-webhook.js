// POST /.netlify/functions/stripe-webhook
// Stripe chiama qui (server-to-server, firmato). È l'UNICA fonte di verità del "pagato".
// Verifica la firma sul body GREZZO, poi crea l'ordine in `orders` dalla bozza e la cancella.
// Idempotente: lo stesso pagamento non crea ordini doppi.

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { notifyOrder } = require("./lib/telegram");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const sig = event.headers["stripe-signature"];
  // body grezzo: Netlify può consegnarlo base64; constructEvent vuole la stringa/Buffer originale, NON il JSON parsato.
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : event.body;

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return { statusCode: 400, body: "Firma non valida: " + (e.message || "") };
  }

  if (evt.type === "checkout.session.completed" || evt.type === "checkout.session.async_payment_succeeded") {
    const session = evt.data.object;
    if (session.payment_status !== "paid") return { statusCode: 200, body: "non ancora pagato" };

    // idempotenza: ordine già creato per questa sessione?
    const { data: exist } = await supa.from("orders").select("id").eq("payment_id", session.id).maybeSingle();
    if (exist) return { statusCode: 200, body: "duplicato, skip" };

    // recupera la bozza (per pending_id da metadata, fallback su session_id)
    const pendingId = session.metadata && session.metadata.pending_id;
    let payload = null;
    if (pendingId) {
      const { data: p } = await supa.from("pending_orders").select("payload").eq("id", pendingId).maybeSingle();
      payload = p && p.payload;
    }
    if (!payload) {
      const { data: p2 } = await supa.from("pending_orders").select("payload").eq("session_id", session.id).maybeSingle();
      payload = p2 && p2.payload;
    }
    if (!payload) return { statusCode: 200, body: "bozza assente, skip" };

    // metodo effettivamente usato (card/paypal/satispay) dal PaymentIntent
    let payment_method = null;
    // payment_intent può essere stringa (ID) o oggetto espanso: normalizza a ID stringa
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent && session.payment_intent.id) || null;
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
        // latest_charge è string|Charge: ristretto a Charge (espanso) prima di leggerne i dettagli
        const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
        payment_method = (charge && charge.payment_method_details && charge.payment_method_details.type)
          || (Array.isArray(pi.payment_method_types) ? pi.payment_method_types[0] : null);
      } catch (e) { /* opzionale: se fallisce, l'ordine si crea comunque */ }
    }

    const order = Object.assign({}, payload, {
      status: "ricevuto",
      payment_provider: "stripe",
      payment_id: session.id,
      payment_intent: paymentIntentId,                   // ID stringa, per eventuale rimborso
      payment_method,                                    // card / paypal / satispay
      paid_at: new Date().toISOString(),
    });
    const { error: insErr } = await supa.from("orders").insert(order);
    if (insErr) return { statusCode: 500, body: "insert ordine: " + insErr.message };

    // traccia/brucia il codice sconto usato (best-effort)
    if (order.coupon_code) {
      try {
        const { data: dc } = await supa.from("discount_codes").select("id,kind,used_count").ilike("code", order.coupon_code).maybeSingle();
        if (dc) {
          const upd = { used_count: (dc.used_count || 0) + 1 };
          if (dc.kind === "oneoff") { upd.burned = true; upd.active = false; }   // one-off: consumato
          await supa.from("discount_codes").update(upd).eq("id", dc.id);
        }
      } catch (e) { console.error("coupon burn:", e.message); }
    }

    // notifica Telegram al titolare (best-effort: non deve mai far fallire la risposta a Stripe)
    try { await notifyOrder(order); } catch (e) { console.error("telegram notify:", e.message); }

    if (pendingId) await supa.from("pending_orders").delete().eq("id", pendingId);
    else await supa.from("pending_orders").delete().eq("session_id", session.id);
  }

  return { statusCode: 200, body: "ok" };
};
