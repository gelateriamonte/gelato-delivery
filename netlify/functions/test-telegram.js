// GET /.netlify/functions/test-telegram
// Invia un messaggio di prova per verificare che bot + env (TELEGRAM_BOT_TOKEN/CHAT_ID) funzionino,
// senza dover creare un ordine reale. Risponde con l'esito JSON dell'API Telegram.
const { sendTelegram } = require("./lib/telegram");

exports.handler = async () => {
  const r = await sendTelegram(
    "✅ Test notifiche La Gelateria — il bot funziona. Qui riceverai i nuovi ordini."
  );
  return {
    statusCode: r.ok ? 200 : (r.skipped ? 400 : 500),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(r, null, 2),
  };
};
