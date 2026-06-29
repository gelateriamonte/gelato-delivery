// POST /.netlify/functions/create-checkout
// Riceve gli INPUT dell'ordine (cliente + carrello + giorno/fascia/fulfillment).
// Ricalcola gli importi LATO SERVER dai prezzi reali (mai fidarsi del client),
// salva una bozza in pending_orders, crea una Stripe Checkout Session embedded,
// ritorna il client_secret. L'ordine vero nasce nel webhook, solo a pagamento riuscito.

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const LAVORAZIONE = ["ricevuto", "accettato", "in preparazione", "in consegna"];
const json = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }

  const {
    customer_name, customer_phone, email, address,
    delivery_lat, delivery_lng, delivery_date, slot_label, fulfillment, items, notes,
  } = body;

  if (!customer_name || !customer_phone) return json(400, { error: "Nome e telefono obbligatori." });
  if (!Array.isArray(items) || !items.length) return json(400, { error: "Carrello vuoto." });
  if (!delivery_date || !slot_label) return json(400, { error: "Giorno o fascia mancante." });
  const isPickup = fulfillment === "pickup";

  try {
    // 1) Capienza fascia (solo consegna con tetto) — best-effort anti-overbooking.
    if (!isPickup) {
      const { data: slot } = await supa.from("time_slots").select("max_deliveries").eq("label", slot_label).maybeSingle();
      const max = Number(slot && slot.max_deliveries);
      if (max > 0) {
        const { count } = await supa.from("orders").select("id", { count: "exact", head: true })
          .eq("delivery_date", delivery_date).eq("slot_label", slot_label).in("status", LAVORAZIONE);
        if (count != null && count >= max) return json(409, { error: "Questa fascia si è appena riempita. Scegline un'altra." });
      }
    }

    // 2) RICALCOLO importi dai prezzi reali in `formats` (ignora i prezzi del client).
    const ids = [...new Set(items.map((i) => i.format_id).filter((x) => x != null))];
    if (!ids.length) return json(400, { error: "Formati non validi." });
    const { data: formats, error: fErr } = await supa.from("formats").select("id,name,price,available").in("id", ids);
    if (fErr) return json(500, { error: "Errore lettura formati." });
    const byId = Object.fromEntries((formats || []).map((f) => [f.id, f]));

    const line_items = [];
    let subtotalCents = 0;
    for (const it of items) {
      const f = byId[it.format_id];
      if (!f || f.available === false) return json(400, { error: "Un formato selezionato non è più disponibile." });
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const unit = Math.round(Number(f.price) * 100);
      subtotalCents += unit * qty;
      const gusti = Array.isArray(it.gusti) ? it.gusti.join(", ") : "";
      line_items.push({
        quantity: qty,
        price_data: { currency: "eur", unit_amount: unit, product_data: { name: f.name + (gusti ? " — " + gusti : "") } },
      });
    }

    const { data: settings } = await supa.from("settings").select("delivery_cost").eq("id", 1).single();
    const deliveryCents = isPickup ? 0 : Math.round(Number((settings && settings.delivery_cost) || 0) * 100);
    if (deliveryCents > 0) {
      line_items.push({ quantity: 1, price_data: { currency: "eur", unit_amount: deliveryCents, product_data: { name: "Consegna a domicilio" } } });
    }
    const amount = subtotalCents + deliveryCents;
    if (amount <= 0) return json(400, { error: "Totale non valido." });

    // 2b) Codice sconto: validazione AUTOREVOLE lato server (sul totale prodotti+consegna).
    let discountCents = 0, couponCode = null;
    if (body.coupon_code) {
      const code = String(body.coupon_code).trim();
      const { data: dc } = await supa.from("discount_codes").select("*").ilike("code", code).maybeSingle();
      if (!dc || !dc.active) return json(400, { error: "Codice sconto non valido." });
      if (dc.kind === "oneoff" && (dc.burned || dc.used_count > 0)) return json(400, { error: "Codice sconto già utilizzato." });
      // codici 'always' (riutilizzabili): una sola volta per cliente — stessa coppia codice + telefono/email.
      // Conta solo gli ordini PAGATI (in `orders`); i tentativi abbandonati non bruciano il codice.
      if (dc.kind !== "oneoff") {
        const phoneDigits = String(customer_phone || "").replace(/\D/g, "");
        const emailNorm = (email || "").trim().toLowerCase();
        const { data: prev } = await supa.from("orders").select("customer_phone,email").ilike("coupon_code", dc.code);
        const giaUsato = (prev || []).some((o) =>
          (phoneDigits && o.customer_phone && String(o.customer_phone).replace(/\D/g, "") === phoneDigits) ||
          (emailNorm && o.email && String(o.email).trim().toLowerCase() === emailNorm)
        );
        if (giaUsato) return json(409, { error: "Hai già usato questo codice: è valido una volta per cliente." });
      }
      discountCents = dc.discount_type === "percent"
        ? Math.round(amount * Number(dc.value) / 100)
        : Math.round(Number(dc.value) * 100);
      discountCents = Math.max(0, Math.min(discountCents, amount));
      couponCode = dc.code;
    }
    const finalAmount = amount - discountCents;
    if (finalAmount <= 0) return json(400, { error: "Sconto troppo alto per questo ordine." });

    // 3) Bozza ordine (importi server, autorevoli). status finale = 'ricevuto' (lo mette il webhook).
    const payload = {
      customer_name, customer_phone, email: email || null, address: address || null,
      delivery_lat: delivery_lat == null ? null : delivery_lat,
      delivery_lng: delivery_lng == null ? null : delivery_lng,
      delivery_date, slot_label, fulfillment: isPickup ? "pickup" : "delivery",
      items, subtotal: subtotalCents / 100, delivery_cost: deliveryCents / 100,
      coupon_code: couponCode, discount: discountCents / 100, total: finalAmount / 100,
      notes: notes || null,
      lang: body.lang === "en" ? "en" : "it",   // per email transazionali IT/EN
    };
    const { data: pend, error: pErr } = await supa.from("pending_orders").insert({ payload, amount: finalAmount }).select("id").single();
    if (pErr) return json(500, { error: "Errore creazione bozza." });

    // sconto Stripe (coupon usa-e-getta amount_off): applicato all'intera sessione
    let stripeDiscounts;
    if (discountCents > 0) {
      try {
        const c = await stripe.coupons.create({ amount_off: discountCents, currency: "eur", duration: "once", name: "Sconto " + couponCode });
        stripeDiscounts = [{ coupon: c.id }];
      } catch (e) { /* se fallisce il coupon Stripe, si paga pieno: meglio bloccare */ return json(502, { error: "Errore applicazione sconto." }); }
    }

    // 4) Checkout Session embedded — NIENTE payment_method_types (metodi dinamici da dashboard).
    // ui_mode 'embedded_page' (API nuova): form in pagina; a pagamento fatto redirect a return_url.
    const origin = event.headers.origin || (event.headers.host ? "https://" + event.headers.host : "");
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        ui_mode: "embedded_page",
        mode: "payment",
        locale: (body.lang === "en" ? "en" : "it"),   // lingua scelta dal cliente
        line_items,
        ...(stripeDiscounts ? { discounts: stripeDiscounts } : {}),
        return_url: origin + "/grazie.html?session_id={CHECKOUT_SESSION_ID}",
        customer_email: email || undefined,
        metadata: { pending_id: pend.id, coupon_code: couponCode || "" },
        payment_intent_data: { metadata: { pending_id: pend.id } },
      });
    } catch (e) {
      await supa.from("pending_orders").delete().eq("id", pend.id);
      return json(502, { error: "Stripe: " + (e.message || "errore creazione sessione") });
    }

    await supa.from("pending_orders").update({ session_id: session.id }).eq("id", pend.id);
    return json(200, { client_secret: session.client_secret });
  } catch (e) {
    return json(500, { error: "Errore interno: " + (e.message || "") });
  }
};
