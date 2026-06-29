// Orchestrazione invio email di un ordine per un dato stato.
// Usato da: stripe-webhook (ricevuto), send-order-email (accettato/consegnato/
// rifiutato/annullato), cancel-order (annullato). Best-effort: non lancia mai.
// Salta in silenzio se l'ordine non ha email (campo opzionale).

const { renderEmail } = require("./email-templates");
const { sendMail } = require("./mailer");
const { business, cancelUrl } = require("./business");

async function sendOrderEmail(order, status) {
  try {
    if (!order || !order.email) return { ok: false, skipped: "ordine senza email" };
    const opts = { legal: business, cancelUrl: cancelUrl(order) };
    const mail = renderEmail(order, status, opts);
    if (!mail) return { ok: false, skipped: "stato senza template: " + status };
    return await sendMail({ to: order.email, subject: mail.subject, html: mail.html, text: mail.text });
  } catch (e) {
    return { ok: false, error: (e && e.message) || "invio fallito" };
  }
}

module.exports = { sendOrderEmail };
