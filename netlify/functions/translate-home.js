// POST /.netlify/functions/translate-home  body: { it: { "<chiave>": "<testo IT>", ... } }
// Traduce i testi della homepage IT→EN via Claude e ritorna { en: { stesse chiavi } }.
// Chiamata dall'editor admin al "Salva homepage". Gate: header x-admin-token == ADMIN_UPLOAD_TOKEN.
// Modello: Haiku 4.5 (traduzione = task semplice, economico).

const Anthropic = require("@anthropic-ai/sdk");
const json = (s, o) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

const SYS = [
  "Sei un traduttore italiano→inglese per il sito di una gelateria artigianale in Sardegna.",
  "Traduci i VALORI in inglese naturale, idiomatico, con tono caldo ed editoriale (non letterale).",
  "NON tradurre i nomi propri: San Teodoro, Monte Petrosu, BM&V, Sardegna, e nomi di gusti/prodotti.",
  "Mantieni ESATTAMENTE i tag HTML <br> e <em>…</em> dove presenti (stesse posizioni).",
  "Mantieni invariati simboli e numeri (€, orari, quantità).",
  "Rispondi SOLO con un oggetto JSON con le STESSE chiavi dell'input e i valori tradotti in inglese. Nessun testo extra, nessun markdown.",
].join(" ");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });
  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: "Traduzione non configurata (manca ANTHROPIC_API_KEY)." });
  const token = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (!process.env.ADMIN_UPLOAD_TOKEN || token !== process.env.ADMIN_UPLOAD_TOKEN) return json(401, { error: "Non autorizzato." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }
  const it = body.it;
  if (!it || typeof it !== "object" || !Object.keys(it).length) return json(200, { en: {} });

  try {
    const client = new Anthropic();   // legge ANTHROPIC_API_KEY dall'ambiente
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      system: SYS,
      messages: [{ role: "user", content: JSON.stringify(it) }],
    });
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let en = null;
    try { en = JSON.parse(text); }
    catch (e) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { en = JSON.parse(m[0]); } catch (e2) {} } }
    if (!en || typeof en !== "object") return json(502, { error: "Traduzione non interpretabile." });
    // tieni solo le chiavi richieste, valori stringa
    const out = {};
    for (const k of Object.keys(it)) if (typeof en[k] === "string" && en[k].trim()) out[k] = en[k];
    return json(200, { en: out });
  } catch (e) {
    console.error("translate-home:", e && e.message);
    return json(502, { error: "Traduzione fallita." });
  }
};
