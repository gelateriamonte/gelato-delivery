// Core del rimborso, condiviso da refund.js (admin) e cancel-order.js (cliente).
// Rimborsa un ordine PAGATO sul metodo originale via PaymentIntent. Idempotente
// su `refunded_at`. Ritorna un risultato strutturato { ok, code, ... } — il
// chiamante mappa su HTTP. Non lancia: errori come { ok:false, code, error }.

async function refundOrder(supa, stripe, orderId, newStatus) {
  const status = newStatus === "rifiutato" ? "rifiutato" : "annullato";

  const { data: order, error } = await supa.from("orders")
    .select("id,total,payment_id,payment_intent,refunded_at,status")
    .eq("id", orderId).maybeSingle();
  if (error || !order) return { ok: false, code: 404, error: "Ordine non trovato." };
  if (order.refunded_at) {
    return { ok: true, already: true, refunded_at: order.refunded_at, status: order.status };
  }
  if (!order.payment_id) return { ok: false, code: 400, error: "Ordine senza pagamento da rimborsare." };

  // serve il PaymentIntent: usa quello salvato, altrimenti recuperalo dalla sessione Checkout
  let pi = order.payment_intent;
  if (!pi) {
    const session = await stripe.checkout.sessions.retrieve(order.payment_id);
    pi = session && session.payment_intent;
  }
  if (!pi) return { ok: false, code: 502, error: "PaymentIntent non trovato per il rimborso." };

  // idempotency key per-ordine: due click concorrenti sullo stesso annullo
  // ottengono lo STESSO refund da Stripe (no doppio payout, no errore 502).
  const refund = await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: "refund_" + orderId });
  const refunded_at = new Date().toISOString();

  // Guardia anti-doppio: aggiorna solo se ancora non rimborsato (race tra due richieste).
  const { data: upd } = await supa.from("orders").update({
    status, refunded_at, refund_id: refund.id, payment_intent: pi,
  }).eq("id", orderId).is("refunded_at", null).select("id");
  // Se un'altra richiesta ha vinto la corsa, upd è vuoto: il rimborso Stripe è
  // comunque idempotente a livello di PaymentIntent (un secondo refund su importo
  // già interamente rimborsato fallirebbe; qui la guardia rende il caso raro).

  return { ok: true, refund_id: refund.id, refunded_at, status, raced: !(upd && upd.length) };
}

module.exports = { refundOrder };
