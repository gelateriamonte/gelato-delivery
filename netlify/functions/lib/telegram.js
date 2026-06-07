// Notifica Telegram al titolare quando arriva un ordine pagato.
// Credenziali SOLO in env var Netlify (mai nel client):
//   TELEGRAM_BOT_TOKEN  — token del bot (@BotFather)
//   TELEGRAM_CHAT_ID    — id della chat dove ricevere gli avvisi (la tua)
// No-op silenzioso se le env mancano: il deploy resta sicuro anche prima del setup del bot.
// File in sottocartella `lib/` → NON è una Netlify Function, è un modulo condiviso.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const fmtEuro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");
const fmtDate = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || "");
};

// Riassunto leggibile dell'ordine (plain text: nessun parse_mode → niente 400 su caratteri speciali).
function orderText(o) {
  const tipo = o.fulfillment === "pickup" ? "🏪 Ritiro" : "🛵 Consegna";
  const quando = [o.delivery_date ? fmtDate(o.delivery_date) : "", o.slot_label || ""].filter(Boolean).join(" · ");
  const items = Array.isArray(o.items) ? o.items : [];
  const righe = items.map((it) => {
    const q = it.qty ? `${it.qty}× ` : "";
    const gusti = Array.isArray(it.gusti) && it.gusti.length ? ` (${it.gusti.join(", ")})` : "";
    return `• ${q}${it.format || "?"}${gusti}`;
  }).join("\n");

  const lines = [
    `🍦 Nuovo ordine — ${fmtEuro(o.total)}`,
    `${tipo}${quando ? " · " + quando : ""}`,
    `👤 ${o.customer_name || "-"} · ${o.customer_phone || "-"}`,
  ];
  if (o.fulfillment !== "pickup" && o.address) lines.push(`📍 ${o.address}`);
  if (righe) lines.push("", righe);
  if (o.notes) lines.push("", `📝 ${o.notes}`);
  if (o.payment_method) lines.push(`💳 ${o.payment_method}`);
  return lines.join("\n");
}

// Invia un testo libero. Ritorna {ok, ...} senza mai lanciare per env mancanti.
async function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) {
    return { ok: false, skipped: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID non configurati" };
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

// Best-effort: non lancia mai (così non può rompere la risposta 200 al webhook Stripe).
async function notifyOrder(order) {
  try {
    return await sendTelegram(orderText(order));
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { notifyOrder, sendTelegram, orderText };
