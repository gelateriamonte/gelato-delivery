// Invio email transazionali via SMTP (Register.it, provider UE → niente
// trasferimento extra-UE). Credenziali SOLO in env Netlify:
//   SMTP_HOST (default smtps.register.it) · SMTP_PORT (default 465)
//   SMTP_USER · SMTP_PASS · SMTP_FROM (default = SMTP_USER)
// No-op silenzioso se host/user/pass mancano: il deploy resta sicuro anche
// prima del setup SMTP (come telegram.js). Non lancia mai.

let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (e) { /* dipendenza non installata: no-op */ }

const HOST = process.env.SMTP_HOST || "smtps.register.it";
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.SMTP_FROM || (USER ? `Gelateria BM&V <${USER}>` : null);

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (!nodemailer || !USER || !PASS) return null;
  transport = nodemailer.createTransport({
    host: HOST, port: PORT, secure: PORT === 465,
    auth: { user: USER, pass: PASS },
  });
  return transport;
}

// Ritorna { ok, skipped?, error?, id? } senza mai lanciare.
async function sendMail({ to, subject, html, text }) {
  if (!to) return { ok: false, skipped: "destinatario assente" };
  const t = getTransport();
  if (!t) return { ok: false, skipped: "SMTP non configurato" };
  try {
    const info = await t.sendMail({ from: FROM, to, subject, html, text });
    return { ok: true, id: info && info.messageId };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "invio fallito" };
  }
}

module.exports = { sendMail };
