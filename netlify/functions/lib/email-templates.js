// Template email transazionali (IT/EN), table-based + CSS inline per
// compatibilità con i client email. Design del sito (avorio/terracotta).
// Input cliente (nome, gusti, indirizzo) SEMPRE escapato in HTML.

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");
const fmtDate = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || "");
};
const isEN = (lang) => String(lang || "it").slice(0, 2).toLowerCase() === "en";

// ---- frammenti riusabili -------------------------------------------------

function summaryBlock(order, lang) {
  const en = isEN(lang);
  const pickup = order.fulfillment === "pickup";
  const when = [fmtDate(order.delivery_date), order.slot_label].filter(Boolean).join(" · ");
  const rows = [];
  rows.push(`<tr><td style="padding:3px 0;color:#7a6e5d;">${pickup ? (en ? "🏪 Pickup" : "🏪 Ritiro") : (en ? "🛵 Delivery" : "🛵 Consegna")}</td><td align="right" style="padding:3px 0;font-weight:600;">${esc(when)}</td></tr>`);
  if (!pickup && order.address) {
    rows.push(`<tr><td style="padding:3px 0;color:#7a6e5d;">${en ? "Address" : "Indirizzo"}</td><td align="right" style="padding:3px 0;">${esc(order.address)}</td></tr>`);
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const lines = items.map((it) => {
    const q = it.qty ? `${it.qty}× ` : "";
    const gusti = Array.isArray(it.gusti) && it.gusti.length ? ` <span style="color:#7a6e5d;">(${esc(it.gusti.join(", "))})</span>` : "";
    return `<tr><td colspan="2" style="padding:4px 0;">${esc(q)}${esc(it.format || "?")}${gusti}</td></tr>`;
  }).join("");

  // importi server-autorevoli (order.subtotal/delivery_cost/discount/total) — NON i prezzi client per-riga
  const totals = [`<tr><td style="padding:3px 0;color:#7a6e5d;">${en ? "Subtotal" : "Subtotale"}</td><td align="right" style="padding:3px 0;">${euro(order.subtotal)}</td></tr>`];
  if (order.delivery_cost && Number(order.delivery_cost) > 0) {
    totals.push(`<tr><td style="padding:3px 0;color:#7a6e5d;">${en ? "Delivery" : "Consegna"}</td><td align="right" style="padding:3px 0;">${euro(order.delivery_cost)}</td></tr>`);
  }
  if (order.discount && Number(order.discount) > 0) {
    totals.push(`<tr><td style="padding:3px 0;color:#7a6e5d;">${en ? "Discount" : "Sconto"}${order.coupon_code ? " " + esc(order.coupon_code) : ""}</td><td align="right" style="padding:3px 0;">−${euro(order.discount)}</td></tr>`);
  }

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6ec;border:1px solid #efe7d8;border-radius:10px;">
    <tr><td style="padding:18px 20px;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#9a8c79;font-weight:700;margin-bottom:12px;">${en ? "Summary" : "Riepilogo"} · ${en ? "order" : "ordine"} #${esc(String(order.id || "").slice(0, 4).toUpperCase())}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3a3026;">${rows.join("")}</table>
      <div style="border-top:1px solid #efe7d8;margin:14px 0;"></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3a3026;">${lines}${totals.join("")}</table>
      <div style="border-top:1px solid #efe7d8;margin:12px 0;"></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Georgia,serif;font-size:17px;color:#3a3026;">
        <tr><td style="font-weight:700;">${en ? "Total" : "Totale"}</td><td align="right" style="font-weight:700;">${euro(order.total)}</td></tr>
      </table>
    </td></tr>
  </table>`;
}

function cancelBlock(lang, cancelUrl) {
  const en = isEN(lang);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:6px 0 10px;">
      <a href="${esc(cancelUrl)}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#8a4a2a;text-decoration:none;background:#fffdf8;border:1.5px solid #d9b9a6;border-radius:999px;padding:11px 24px;">${en ? "Cancel order" : "Annulla ordine"}</a>
    </td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#7a6e5d;text-align:center;">
      ${en
        ? "You can cancel until the cut-off time shown for your time slot. The refund will be issued to the <strong>same payment method</strong> used for the order."
        : "Puoi annullare entro il <strong>termine indicato</strong> per la tua fascia. Il rimborso avverrà <strong>sullo stesso metodo di pagamento</strong> usato per l'ordine."}
    </td></tr>
  </table>`;
}

function noticeBlock(html) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #c9a98f;background:#faf4ea;border-radius:0 8px 8px 0;">
    <tr><td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#6a5e4e;">${html}</td></tr>
  </table>`;
}

function layout({ lang, kicker, title, intro, blocksHtml, legal }) {
  const en = isEN(lang);
  return `<!DOCTYPE html><html lang="${en ? "en" : "it"}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1ece2;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ece2;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fffdf8;border:1px solid #e7ddcb;border-radius:14px;overflow:hidden;">
  <tr><td align="center" style="padding:26px 28px 18px;border-bottom:1px solid #efe7d8;background:linear-gradient(180deg,#fdfaf3,#fffdf8);">
    <img src="${esc(legal.logoUrl)}" width="64" alt="Gelateria BM&amp;V" style="display:block;border:0;width:64px;height:auto;margin:0 auto 6px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9a8c79;font-weight:700;">Monte Petrosu · San Teodoro</div>
  </td></tr>
  <tr><td style="padding:30px 34px 6px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#a8552f;font-weight:700;margin-bottom:10px;">${esc(kicker)}</div>
    <h1 style="margin:0;font-family:Georgia,'Cormorant Garamond',serif;font-size:30px;line-height:1.1;color:#3a3026;font-weight:600;">${title}</h1>
    <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#5a4f41;">${intro}</p>
  </td></tr>
  <tr><td style="padding:18px 34px 6px;">${blocksHtml}</td></tr>
  <tr><td style="padding:20px 34px 28px;border-top:1px solid #efe7d8;background:#fbf6ec;">
    <div style="font-family:Georgia,serif;font-size:15px;color:#3a3026;font-weight:600;margin-bottom:4px;">Gelateria BM&amp;V</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#9a8c79;">
      ${esc(legal.ragioneSociale)} · P.IVA ${esc(legal.piva)} · ${esc(legal.sede)}<br>
      <a href="${esc(legal.tcUrl)}" style="color:#7a6e5d;">${en ? "Terms" : "Condizioni"}</a> ·
      <a href="${esc(legal.privacyUrl)}" style="color:#7a6e5d;">Privacy</a> ·
      <a href="${esc(legal.whatsappUrl)}" style="color:#7a6e5d;">WhatsApp</a><br>
      ${en ? "The Italian version of the documents is the binding one. Service email about your order." : "La versione italiana dei documenti fa fede. Email di servizio relativa al tuo ordine."}
    </div>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// ---- contenuto per stato -------------------------------------------------

function content(order, status, lang, opts) {
  const en = isEN(lang);
  const name = esc(order.customer_name ? String(order.customer_name).split(" ")[0] : "");
  const tc = `<a href="${esc(opts.legal.tcUrl)}" style="color:#a8552f;">${en ? "Terms of sale" : "Condizioni di vendita"}</a>`;
  const recesso = noticeBlock(en
    ? `As this is a fresh, perishable food product, <strong>no right of withdrawal applies</strong> after the order is accepted (art. 59 Italian Consumer Code). The cancellation option above remains available. Details in the ${tc}.`
    : `Trattandosi di alimento fresco e deperibile, dopo l'accettazione dell'ordine <strong>non è previsto il diritto di recesso</strong> (art. 59 Codice del Consumo). Resta la facoltà di annullamento qui sopra. Dettagli nelle ${tc}.`);
  const conserva = noticeBlock(en
    ? `<strong>Storage:</strong> keep frozen and eat <strong>as soon as possible</strong>. <strong>Do not refreeze</strong> once thawed. Allergen information is available per flavour and again at delivery.`
    : `<strong>Conservazione:</strong> tieni in freezer e consuma <strong>preferibilmente subito</strong>. <strong>Non ricongelare</strong> dopo lo scongelamento. Le informazioni sugli allergeni sono disponibili per gusto e nuovamente alla consegna.`);

  switch (status) {
    case "ricevuto":
      return {
        subject: en ? "We received your order" : "Abbiamo ricevuto il tuo ordine",
        kicker: en ? "Order received" : "Ordine ricevuto",
        title: en ? `Thanks ${name}, we received your order` : `Grazie ${name}, abbiamo ricevuto il tuo ordine`,
        intro: en
          ? "It is an <strong>order proposal</strong>: the contract is finalised <strong>only once we accept it</strong>. We check availability and time slot and will write to you <strong>shortly</strong>. Your payment went through."
          : "È una <strong>proposta d'ordine</strong>: il contratto si perfeziona <strong>solo con la nostra accettazione</strong>. Verifichiamo disponibilità e fascia e ti scriviamo <strong>a breve</strong>. Il pagamento è andato a buon fine.",
        blocks: [summaryBlock(order, lang), cancelBlock(lang, opts.cancelUrl), recesso],
      };
    case "accettato":
      return {
        subject: en ? "Your order is confirmed" : "Il tuo ordine è confermato",
        kicker: en ? "Order accepted" : "Ordine accettato",
        title: en ? `${name}, your order is confirmed` : `${name}, il tuo ordine è confermato`,
        intro: en
          ? "We <strong>accepted</strong> your order: the contract is now concluded. Here is your confirmation; keep it for your records. We'll send delivery updates via WhatsApp."
          : "Abbiamo <strong>accettato</strong> il tuo ordine: il contratto è concluso. Questa è la tua conferma, conservala. Gli aggiornamenti di consegna arrivano via WhatsApp.",
        blocks: [summaryBlock(order, lang), conserva, cancelBlock(lang, opts.cancelUrl), recesso],
      };
    case "consegnato":
      return {
        subject: en ? "Thank you! 🍦" : "Grazie! 🍦",
        kicker: en ? "Delivered" : "Consegnato",
        title: en ? `Thank you ${name}!` : `Grazie ${name}!`,
        intro: en
          ? "Your gelato has been delivered. We hope you enjoy it — thank you for choosing Gelateria BM&V. See you soon!"
          : "Il tuo gelato è stato consegnato. Speriamo ti piaccia — grazie per aver scelto la Gelateria BM&V. A presto!",
        blocks: [summaryBlock(order, lang)],
      };
    case "rifiutato":
      return {
        subject: en ? "About your order" : "Riguardo al tuo ordine",
        kicker: en ? "Order not fulfilled" : "Ordine non evaso",
        title: en ? `${name}, we couldn't fulfil your order` : `${name}, non possiamo evadere il tuo ordine`,
        intro: en
          ? "We're sorry: we can't fulfil this order. Any amount paid is <strong>fully refunded to the same payment method</strong> you used, within the technical times of each payment channel."
          : "Ci dispiace: non possiamo evadere questo ordine. L'eventuale importo pagato è <strong>rimborsato integralmente sullo stesso metodo di pagamento</strong> usato, nei tempi tecnici di ciascun canale.",
        blocks: [summaryBlock(order, lang)],
      };
    case "annullato":
      return {
        subject: en ? "Order cancelled" : "Ordine annullato",
        kicker: en ? "Cancellation confirmed" : "Annullamento confermato",
        title: en ? `${name}, your order is cancelled` : `${name}, il tuo ordine è annullato`,
        intro: en
          ? `Your order has been cancelled. <strong>${euro(order.total)}</strong> is refunded to the <strong>same payment method</strong> you used, within the technical times of each payment channel.`
          : `Il tuo ordine è stato annullato. <strong>${euro(order.total)}</strong> viene rimborsato sullo <strong>stesso metodo di pagamento</strong> usato, nei tempi tecnici di ciascun canale.`,
        blocks: [summaryBlock(order, lang)],
      };
    default:
      return null;
  }
}

// Render finale → { subject, html, text } | null se status non gestito.
function renderEmail(order, status, opts) {
  const lang = order.lang || "it";
  const c = content(order, status, lang, opts);
  if (!c) return null;
  const html = layout({ lang, kicker: c.kicker, title: c.title, intro: c.intro, blocksHtml: c.blocks.join('<div style="height:14px"></div>'), legal: opts.legal });
  const text = c.title.replace(/<[^>]+>/g, "") + "\n\n" + c.intro.replace(/<[^>]+>/g, "") + "\n\n" + (opts.cancelUrl && (status === "ricevuto" || status === "accettato") ? (isEN(lang) ? "Cancel: " : "Annulla: ") + opts.cancelUrl + "\n" : "");
  return { subject: c.subject, html, text };
}

module.exports = { renderEmail, esc, euro };
