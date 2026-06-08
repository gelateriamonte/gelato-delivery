// POST /.netlify/functions/upload-home-image  body: { slot, contentType, dataBase64 }
// Carica un'immagine della homepage nel bucket pubblico 'home' (service role) e ritorna l'URL pubblico.
// slot: hero | slide1..slide4. Solo immagini reali (magic bytes), max ~4MB (limite body Netlify 6MB → base64).
// Gate: header x-admin-token == ADMIN_UPLOAD_TOKEN (speed-bump; auth admin vera = go-live).

const { createClient } = require("@supabase/supabase-js");
const json = (s, o) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const SLOTS = ["hero", "slide1", "slide2", "slide3", "slide4"];

function sniff(buf) {   // magic bytes → content-type reale (rifiuta file fasulli)
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "image/avif";   // box ftyp (famiglia avif)
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo non consentito." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Configurazione server mancante." });
  const token = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (!process.env.ADMIN_UPLOAD_TOKEN || token !== process.env.ADMIN_UPLOAD_TOKEN) return json(401, { error: "Non autorizzato." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Richiesta non valida." }); }
  const { slot, contentType, dataBase64 } = body;
  if (!SLOTS.includes(slot)) return json(400, { error: "Slot non valido." });
  const ext = EXT[contentType];
  if (!ext) return json(400, { error: "Formato non supportato (jpg, png, webp, avif)." });
  if (!dataBase64) return json(400, { error: "File mancante." });

  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length) return json(400, { error: "File non valido." });
  if (buf.length > 4 * 1024 * 1024) return json(413, { error: "Immagine troppo grande (max 4MB)." });
  if (sniff(buf) !== contentType) return json(400, { error: "Il file non è un'immagine valida." });

  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const path = slot + "-" + Date.now() + "." + ext;
  const up = await supa.storage.from("home").upload(path, buf, { contentType, upsert: true });
  if (up.error) { console.error("upload-home-image:", up.error); return json(502, { error: "Upload fallito." }); }
  const { data } = supa.storage.from("home").getPublicUrl(path);
  return json(200, { url: data.publicUrl, path });
};
