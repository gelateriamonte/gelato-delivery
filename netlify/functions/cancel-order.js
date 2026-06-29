// /.netlify/functions/cancel-order?token=<cancel_token>
// Annullamento self-service del cliente, token-gated (link in email).
//   GET  = SOLO pagina di conferma (nessun effetto: gli email client fanno
//          prefetch dei link → un GET non deve mai rimborsare).
//   POST = esegue: ri-valida finestra+stato lato server, rimborsa sul metodo
//          originale, stato→annullato, invia email. Idempotente.
// Finestra = 2h prima dell'inizio fascia (T&C Art. 8.6). Pagine rese qui (HTML).

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { canCancel } = require("./lib/order-window");
const { refundOrder } = require("./lib/refund-core");
const { sendOrderEmail } = require("./lib/order-email");
const { business } = require("./lib/business");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");
const isEN = (l) => String(l || "it").slice(0, 2).toLowerCase() === "en";
const html = (code, body) => ({ statusCode: code, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" }, body });

const ORDER_COLS = "id,customer_name,email,lang,fulfillment,address,delivery_date,slot_label,items,subtotal,delivery_cost,discount,coupon_code,total,cancel_token,status,refunded_at,payment_id,payment_intent";

function page(lang, { title, bodyHtml, tone = "neutral" }) {
  const accent = tone === "ok" ? "#537f68" : tone === "warn" ? "#a8552f" : "#3a3026";
  return `<!DOCTYPE html><html lang="${isEN(lang) ? "en" : "it"}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  body{margin:0;background:#f1ece2;font-family:-apple-system,BlinkMacSystemFont,'Hanken Grotesk',Arial,sans-serif;color:#3a3026;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:560px;margin:0 auto;padding:40px 18px;}
  .card{background:#fffdf8;border:1px solid #e7ddcb;border-radius:16px;padding:34px 30px;box-shadow:0 30px 60px -40px rgba(60,40,30,.4);}
  .kick{font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:${accent};margin:0 0 12px;}
  h1{font-family:Georgia,'Cormorant Garamond',serif;font-size:28px;line-height:1.12;margin:0 0 14px;color:#3a3026;font-weight:600;}
  p{font-size:15px;line-height:1.65;color:#5a4f41;margin:0 0 14px;}
  .sum{background:#fbf6ec;border:1px solid #efe7d8;border-radius:10px;padding:14px 16px;font-size:14px;margin:18px 0;}
  .sum b{font-family:Georgia,serif;}
  .btn{display:inline-block;border:0;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;color:#fff;background:#a8552f;border-radius:999px;padding:13px 28px;text-decoration:none;}
  .btn.ghost{background:#fffdf8;color:#8a4a2a;border:1.5px solid #d9b9a6;}
  .muted{font-size:12.5px;color:#9a8c79;margin-top:16px;}
  a{color:#a8552f;}
</style></head>
<body><div class="wrap"><div class="card">${bodyHtml}</div>
<p class="muted" style="text-align:center;">Gelateria BM&amp;V · Monte Petrosu, San Teodoro</p></div></body></html>`;
}

function summaryLine(order, lang) {
  const when = [String(order.delivery_date || "").split("-").reverse().join("/"), order.slot_label].filter(Boolean).join(" · ");
  return `<div class="sum">${esc(order.customer_name || "")} · ${esc(when)}<br><b>${isEN(lang) ? "Total" : "Totale"} ${euro(order.total)}</b></div>`;
}

function waLink() { return business.whatsappUrl; }

// pagina "non annullabile" con motivo + contatto WhatsApp
function notCancellablePage(order, lang, reason, anticipoH) {
  const en = isEN(lang);
  const h = anticipoH != null ? anticipoH : 2;
  const msg = reason === "window"
    ? (en ? `The cancellation window has closed (cancellation is possible up to ${h} hour(s) before the time slot).`
          : `La finestra di annullamento è chiusa (si può annullare fino a ${h} or${h === 1 ? "a" : "e"} prima della fascia).`)
    : reason === "refunded"
    ? (en ? "This order has already been cancelled and refunded." : "Questo ordine è già stato annullato e rimborsato.")
    : reason === "status"
    ? (en ? "This order can no longer be cancelled because preparation has started or it is already completed."
          : "Questo ordine non è più annullabile perché la preparazione è iniziata o è già completato.")
    : (en ? "This cancellation link is not valid." : "Questo link di annullamento non è valido.");
  return page(lang, {
    tone: "warn",
    title: en ? "Cannot cancel" : "Non annullabile",
    bodyHtml: `<p class="kick">${en ? "Cancellation" : "Annullamento"}</p>
      <h1>${en ? "It's no longer possible to cancel" : "Non è più possibile annullare"}</h1>
      <p>${msg}</p>
      <p>${en ? "For information please contact us on WhatsApp." : "Per informazioni contattaci su WhatsApp."}</p>
      <p><a class="btn" href="${esc(waLink())}">${en ? "Contact on WhatsApp" : "Scrivici su WhatsApp"}</a></p>`,
  });
}

exports.handler = async (event) => {
  const method = event.httpMethod;
  // token: querystring (GET) o body urlencoded (POST)
  let token = (event.queryStringParameters && event.queryStringParameters.token) || "";
  if (method === "POST") {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
    const params = new URLSearchParams(raw);
    token = params.get("token") || token;
  }
  if (!token) return html(400, page("it", { tone: "warn", title: "Link non valido", bodyHtml: "<h1>Link non valido</h1><p>Token mancante.</p>" }));

  const { data: order } = await supa.from("orders").select(ORDER_COLS).eq("cancel_token", token).maybeSingle();
  if (!order) return html(404, page("it", { tone: "warn", title: "Ordine non trovato", bodyHtml: "<h1>Ordine non trovato</h1><p>Questo link di annullamento non è valido o è scaduto.</p>" }));

  const lang = order.lang || "it";
  const en = isEN(lang);
  // termine di annullamento configurabile nel back office (Parametri → cancel_lead_hours)
  const { data: cfg } = await supa.from("settings").select("cancel_lead_hours").eq("id", 1).maybeSingle();
  const anticipoH = cfg && cfg.cancel_lead_hours != null ? Number(cfg.cancel_lead_hours) : undefined;
  const decision = canCancel(order, new Date(), anticipoH);

  // --- GET: solo pagina di conferma (nessun effetto) ---
  if (method !== "POST") {
    if (!decision.ok) return html(200, notCancellablePage(order, lang, decision.reason, anticipoH));
    return html(200, page(lang, {
      title: en ? "Cancel order" : "Annulla ordine",
      bodyHtml: `<p class="kick">${en ? "Cancellation" : "Annullamento"}</p>
        <h1>${en ? "Cancel this order?" : "Vuoi annullare questo ordine?"}</h1>
        ${summaryLine(order, lang)}
        <p>${en
          ? `If you confirm, the order is cancelled and <strong>${euro(order.total)}</strong> is refunded to the <strong>same payment method</strong> you used, within the technical times of each payment channel.`
          : `Se confermi, l'ordine viene annullato e <strong>${euro(order.total)}</strong> viene rimborsato sullo <strong>stesso metodo di pagamento</strong> usato, nei tempi tecnici di ciascun canale.`}</p>
        <form method="POST" action="/.netlify/functions/cancel-order" style="margin-top:18px;">
          <input type="hidden" name="token" value="${esc(token)}">
          <button class="btn" type="submit">${en ? "Confirm cancellation" : "Conferma annullamento"}</button>
        </form>`,
    }));
  }

  // --- POST: esegue ---
  if (!decision.ok) {
    // se già rimborsato → pagina "fatto"; altrimenti "non annullabile"
    if (decision.reason === "refunded") {
      return html(200, page(lang, { tone: "ok", title: en ? "Already cancelled" : "Già annullato",
        bodyHtml: `<p class="kick">${en ? "Cancellation" : "Annullamento"}</p><h1>${en ? "Order already cancelled" : "Ordine già annullato"}</h1><p>${en ? "This order was already cancelled and the refund issued to your original payment method." : "Questo ordine era già stato annullato e il rimborso emesso sul tuo metodo di pagamento originale."}</p>` }));
    }
    return html(200, notCancellablePage(order, lang, decision.reason, anticipoH));
  }

  const paid = !!order.payment_id;
  if (paid) {
    const r = await refundOrder(supa, stripe, order.id, "annullato");
    if (!r.ok) {
      return html(502, page(lang, { tone: "warn", title: en ? "Error" : "Errore",
        bodyHtml: `<h1>${en ? "Something went wrong" : "Qualcosa è andato storto"}</h1><p>${en ? "We couldn't complete the cancellation. Please contact us on WhatsApp." : "Non siamo riusciti a completare l'annullamento. Contattaci su WhatsApp."}</p><p><a class="btn" href="${esc(waLink())}">WhatsApp</a></p>` }));
    }
  } else {
    // "paga al ritiro": nessun pagamento incassato → nessun rimborso, solo annullamento
    await supa.from("orders").update({ status: "annullato" }).eq("id", order.id);
  }

  // email di conferma annullamento (best-effort)
  try { await sendOrderEmail(Object.assign({}, order, { status: "annullato" }), "annullato"); } catch (e) { /* best-effort */ }

  const refundLine = paid
    ? (en ? `<p><strong>${euro(order.total)}</strong> is refunded to the <strong>same payment method</strong> you used, within the technical times of each payment channel.</p>`
          : `<p><strong>${euro(order.total)}</strong> viene rimborsato sullo <strong>stesso metodo di pagamento</strong> usato, nei tempi tecnici di ciascun canale.</p>`)
    : (en ? `<p>No payment had been taken, so there is nothing to refund.</p>`
          : `<p>Non era previsto alcun pagamento anticipato: nessun importo è stato addebitato.</p>`);

  return html(200, page(lang, { tone: "ok", title: en ? "Order cancelled" : "Ordine annullato",
    bodyHtml: `<p class="kick">${en ? "Cancellation confirmed" : "Annullamento confermato"}</p>
      <h1>${en ? "Your order is cancelled" : "Il tuo ordine è annullato"}</h1>
      ${summaryLine(order, lang)}
      ${refundLine}
      <p>${en ? "A confirmation email is on its way if you provided an address." : "Se hai lasciato un'email, ricevi a breve la conferma."}</p>` }));
};
