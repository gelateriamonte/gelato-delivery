// Pricing autorevole lato server, condiviso da create-checkout (path Stripe) e
// create-order-unpaid (path "paga al ritiro"). Unica fonte di verità su importi
// e validazione coupon: mai fidarsi dei prezzi inviati dal client.

// Ricalcola il subtotale dai prezzi reali in `formats`. Ritorna anche le righe
// (nome + prezzo unitario) per costruire la Checkout Session Stripe.
async function priceCart(supa, items) {
  if (!Array.isArray(items) || !items.length) return { error: "Carrello vuoto." };
  const ids = [...new Set(items.map((i) => i.format_id).filter((x) => x != null))];
  if (!ids.length) return { error: "Formati non validi." };
  const { data: formats, error } = await supa.from("formats").select("id,name,price,available").in("id", ids);
  if (error) return { error: "Errore lettura formati." };
  const byId = Object.fromEntries((formats || []).map((f) => [f.id, f]));

  const lines = [];
  let subtotalCents = 0;
  for (const it of items) {
    const f = byId[it.format_id];
    if (!f || f.available === false) return { error: "Un formato selezionato non è più disponibile." };
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const unit = Math.round(Number(f.price) * 100);
    subtotalCents += unit * qty;
    const gusti = Array.isArray(it.gusti) ? it.gusti.join(", ") : "";
    lines.push({ name: f.name + (gusti ? " — " + gusti : ""), unitCents: unit, qty });
  }
  return { subtotalCents, lines };
}

// Valida un codice sconto e calcola lo sconto in centesimi sul `baseCents` dato.
// Replica la regola di create-checkout: 'oneoff' usa-e-getta, 'always' una volta
// per cliente (stesso telefono/email su ordini PAGATI). Ritorna { error } se non valido.
// Normalizza a cellulare locale (cifre, senza prefisso 39/0039).
// DEVE combaciare con la SQL public.norm_mobile usata da rpc_coupon_precheck.
const normMobile = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("0039")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("39")) d = d.slice(2);
  return d;
};

async function applyCoupon(supa, code, baseCents, phone, email) {
  if (!code) return { discountCents: 0, couponCode: null };
  const c = String(code).trim();
  const { data: dc } = await supa.from("discount_codes").select("*").ilike("code", c).maybeSingle();
  if (!dc || !dc.active) return { error: "Codice sconto non valido." };
  if (dc.kind === "oneoff" && (dc.burned || dc.used_count > 0)) return { error: "Codice sconto già utilizzato." };
  if (dc.kind !== "oneoff") {
    const phoneN = normMobile(phone);
    const emailNorm = (email || "").trim().toLowerCase();
    const { data: prev } = await supa.from("orders").select("customer_phone,email,status").ilike("coupon_code", dc.code);
    const giaUsato = (prev || [])
      .filter((o) => o.status !== "annullato" && o.status !== "rifiutato")   // ordini annullati/rifiutati liberano il codice
      .some((o) =>
        (phoneN && normMobile(o.customer_phone) === phoneN) ||
        (emailNorm && o.email && String(o.email).trim().toLowerCase() === emailNorm));
    if (giaUsato) return { error: "Hai già usato questo codice: è valido una volta per cliente." };
  }
  let discountCents = dc.discount_type === "percent"
    ? Math.round(baseCents * Number(dc.value) / 100)
    : Math.round(Number(dc.value) * 100);
  discountCents = Math.max(0, Math.min(discountCents, baseCents));
  return { discountCents, couponCode: dc.code };
}

// Brucia/conta l'uso del coupon dopo la creazione dell'ordine (best-effort).
async function burnCoupon(supa, couponCode) {
  if (!couponCode) return;
  try {
    const { data: dc } = await supa.from("discount_codes").select("id,kind,used_count").ilike("code", couponCode).maybeSingle();
    if (dc) {
      const upd = { used_count: (dc.used_count || 0) + 1 };
      if (dc.kind === "oneoff") { upd.burned = true; upd.active = false; }
      await supa.from("discount_codes").update(upd).eq("id", dc.id);
    }
  } catch (e) { /* best-effort */ }
}

module.exports = { priceCart, applyCoupon, burnCoupon };
