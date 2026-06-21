// Costruisce il contenuto ePOS-Print XML di uno scontrino ordine (Epson TM-m30III, 80mm / 48 col).
// Ritorna SOLO il blocco <epos-print>…</epos-print>; il wrapper SDP lo aggiunge la function.
// Strategia layout: si lavora su stringhe RAW (lunghezza visibile corretta) e si fa l'escape
// XML UNA volta all'emissione (line()), così l'allineamento colonne non viene falsato da &amp; ecc.

const WIDTH = 48;

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const euro = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");

// conteggio per code-point (no split su coppie surrogate)
const cp = (s) => Array.from(String(s));
const len = (s) => cp(s).length;
const clip = (s, n) => { const a = cp(s); return a.length <= n ? String(s) : a.slice(0, Math.max(0, n)).join(""); };

// "sinistra ............ destra" su w colonne (almeno 1 spazio), troncando la sinistra
function padLine(left, right, w = WIDTH) {
  const r = String(right);
  const l = clip(left, Math.max(0, w - len(r) - 1));
  const gap = w - len(l) - len(r);
  return l + " ".repeat(Math.max(1, gap)) + r;
}

// a capo morbido a w colonne (parole; spezza la parola se piu' lunga di w)
function wrap(s, w = WIDTH) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const word of words) {
    if (!cur) cur = clip(word, w);
    else if (len(cur) + 1 + len(word) <= w) cur += " " + word;
    else { out.push(cur); cur = clip(word, w); }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

const fmtDate = (d) => {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || "");
};

// data+ora locale Europe/Rome da ISO (created_at), senza dipendenze
function fmtDateTime(iso) {
  try {
    const parts = new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(iso));
    const g = (t) => { const p = parts.find((x) => x.type === t); return p ? p.value : ""; };
    return `${g("day")}/${g("month")}/${g("year")}  ${g("hour")}:${g("minute")}`;
  } catch (e) { return ""; }
}

function buildReceiptXml(order) {
  const o = order || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const isPickup = o.fulfillment === "pickup";
  const sep = "-".repeat(WIDTH);
  const seph = "=".repeat(WIDTH);
  const out = [];

  // emette una riga di testo (escape qui, una sola volta) + newline
  const line = (s) => out.push("<text>" + esc(s) + "&#10;</text>");
  const raw = (xml) => out.push(xml);

  // intestazione (titolo: doppia dimensione, centrato → nessun calcolo padding)
  raw('<text align="center"/><text width="2" height="2"/>');
  line("GELATO26");
  raw('<text width="1" height="1"/><text align="left"/>');
  line(seph);

  // ordine + data/ora
  const shortId = String(o.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  line(padLine("Ordine #" + shortId, fmtDateTime(o.created_at)));
  line(sep);

  // tipo consegna/ritiro (grassetto)
  raw('<text em="true"/>');
  line(isPickup ? "*** RITIRO ***" : "*** CONSEGNA ***");
  raw('<text em="false"/>');
  const quando = [o.delivery_date ? fmtDate(o.delivery_date) : "", o.slot_label || ""].filter(Boolean).join("   ");
  if (quando) line((isPickup ? "Ritiro: " : "Consegna: ") + quando);
  line(sep);

  // cliente
  line(padLine(o.customer_name || "-", o.customer_phone || ""));
  if (!isPickup && o.address) wrap(o.address).forEach(line);
  line(sep);

  // righe prodotto
  for (const it of items) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    line(padLine(qty + "x " + (it.format || "?"), euro((Number(it.prezzo_unit) || 0) * qty)));
    const gusti = Array.isArray(it.gusti) ? it.gusti.filter(Boolean) : [];
    if (gusti.length) wrap(gusti.join(", "), WIDTH - 3).forEach((l) => line("   " + l));
  }
  line(sep);

  // totali
  line(padLine("Subtotale", euro(o.subtotal)));
  if (Number(o.delivery_cost) > 0) line(padLine("Consegna", euro(o.delivery_cost)));
  if (Number(o.discount) > 0) line(padLine("Sconto " + (o.coupon_code || ""), "-" + euro(o.discount)));
  raw('<text em="true"/><text height="2"/>');   // doppia ALTEZZA (non larghezza): padding a 48 resta valido
  line(padLine("TOTALE", euro(o.total)));
  raw('<text height="1"/><text em="false"/>');
  line(sep);

  // pagamento + note
  if (o.payment_method) line("Pagato: " + String(o.payment_method).toUpperCase());
  if (o.notes) wrap("Note: " + o.notes).forEach(line);
  line(seph);

  raw('<feed line="3"/><cut type="feed"/>');

  return '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + out.join("") + "</epos-print>";
}

module.exports = { buildReceiptXml };
