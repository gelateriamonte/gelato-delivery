// Netlify build plugin — a ogni deploy di PRODUZIONE riuscito avvisa il titolare
// via Telegram che e' disponibile una nuova versione (così ricarica il back office).
// Usa le stesse env var delle Netlify Functions: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// No-op silenzioso se mancano le env. Non fa mai fallire il build/deploy.
module.exports = {
  onSuccess: async () => {
    // solo produzione (no deploy-preview / branch-deploy)
    if (process.env.CONTEXT && process.env.CONTEXT !== "production") return;
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    if (!TOKEN || !CHAT_ID) {
      console.log("notify-telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID mancanti, skip");
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: "🔄 Nuova versione software disponibile, ricarica.",
          disable_web_page_preview: true,
        }),
      });
      console.log("notify-telegram: sendMessage status", res.status);
    } catch (e) {
      console.log("notify-telegram: errore invio", e && e.message);
    }
  },
};
