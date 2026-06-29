// POST /.netlify/functions/create-order-unpaid
// Crea un ordine PICKUP con pagamento alla cassa al ritiro, SENZA Stripe.
// Solo ritiro (la consegna a domicilio richiede pagamento online).
// L'ordine nasce qui (service-role: l'anon non può inserire in `orders` per RLS).
// Importi ricalcolati lato server (mai fidarsi del client).

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { priceCart, applyCoupon, burnCoupon } = require("./lib/order-pricing");
const { sendOrderEmail } = require("./lib/order-email");
const { notifyOrder } = require("./lib/telegram");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const json = (s, o) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }

  const { customer_name, customer_phone, email, items, delivery_date, slot_label, notes } = body;
  if (!customer_name || !customer_phone) return json(400, { error: "Nome e telefono obbligatori." });
  if (body.fulfillment !== "pickup") return json(400, { error: "Il pagamento al ritiro è disponibile solo per il ritiro in gelateria." });
  if (!delivery_date || !slot_label) return json(400, { error: "Giorno o orario di ritiro mancante." });

  try {
    // pricing autorevole — pickup: nessun costo di consegna, nessun minimo, nessuna capienza fascia
    const priced = await priceCart(supa, items);
    if (priced.error) return json(400, { error: priced.error });
    const subtotalCents = priced.subtotalCents;

    const coup = await applyCoupon(supa, body.coupon_code, subtotalCents, customer_phone, email);
    if (coup.error) return json(400, { error: coup.error });
    const totalCents = subtotalCents - coup.discountCents;
    if (totalCents < 0) return json(400, { error: "Sconto troppo alto per questo ordine." });

    const order = {
      customer_name, customer_phone, email: email || null,
      address: body.address || "Ritiro in gelateria",
      delivery_date, slot_label, fulfillment: "pickup",
      items, subtotal: subtotalCents / 100, delivery_cost: 0,
      coupon_code: coup.couponCode, discount: coup.discountCents / 100, total: totalCents / 100,
      notes: notes || null,
      lang: body.lang === "en" ? "en" : "it",
      status: "ricevuto",
      payment_provider: "cash",
      payment_method: "Alla cassa al ritiro",
      payment_id: null, payment_intent: null, paid_at: null,
      cancel_token: crypto.randomBytes(16).toString("hex"),
    };

    let { data: ins, error: insErr } = await supa.from("orders").insert(order).select("id").single();
    if (insErr) {
      // fallback anti-perdita se le colonne nuove non sono ancora migrate
      const base = Object.assign({}, order); delete base.cancel_token; delete base.lang;
      ({ data: ins, error: insErr } = await supa.from("orders").insert(base).select("id").single());
      if (insErr) return json(500, { error: "Creazione ordine fallita: " + insErr.message });
    }
    if (ins && ins.id) order.id = ins.id;

    await burnCoupon(supa, coup.couponCode);
    try { if (ins && ins.id) await supa.from("print_jobs").insert({ order_id: ins.id }); } catch (e) { /* best-effort */ }
    try { await notifyOrder(order); } catch (e) { /* best-effort: alert interno titolare */ }
    try { await sendOrderEmail(order, "ricevuto"); } catch (e) { /* best-effort */ }

    return json(200, { ok: true, order_id: ins && ins.id });
  } catch (e) {
    return json(500, { error: "Errore interno: " + (e.message || "") });
  }
};
