// Costruisce il contenuto ePOS-Print XML di uno scontrino ordine (Epson TM-m30III, 80mm / 48 col).
// Ritorna SOLO il blocco <epos-print>…</epos-print>; il wrapper SDP lo aggiunge la function.
// Strategia layout: si lavora su stringhe RAW (lunghezza visibile corretta) e si fa l'escape
// XML UNA volta all'emissione (line()), così l'allineamento colonne non viene falsato da &amp; ecc.

const WIDTH = 48;
const MAX_NOTE_LINES = 60;   // tetto righe stampate del corpo nota (~20 cm di carta)

// i controlli C0 non sono ammessi da XML 1.0 (tranne TAB/LF/CR): la stampante rifiuterebbe il documento
// (testo incollato da PDF/terminale) → si eliminano all'INGRESSO dei builder, prima del layout.
// NON dentro esc(): sparirebbero dopo il calcolo delle colonne e padLine/wrap emetterebbero righe corte.
// (filtro per code-point e non regex: una classe di caratteri di controllo violerebbe no-control-regex)
const stripCtl = (s) => Array.from(String(s == null ? "" : s)).filter((c) => {
  const n = c.codePointAt(0);
  return n > 31 || n === 10;   // solo il LF: TAB e CR li normalizzano cleanField/cleanText qui sotto
}).join("");

// campo di UNA riga: TAB/CR/LF diventano uno spazio invece di sparire, così la larghezza misurata da
// padLine/clip è quella stampata (un a-capo manderebbe la colonna destra a capo dopo il calcolo).
const cleanField = (s) => stripCtl(String(s == null ? "" : s).replace(/[\t\r\n]/g, " "));

// testo MULTIRIGA (nota): gli a-capo dell'utente sono significativi → CRLF/CR normalizzati a LF
// (un incollaggio da Windows deve dare a-capo veri, non CR appesi); il TAB resta una spaziatura.
const cleanText = (s) => stripCtl(String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/\t/g, " "));

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

// a capo morbido a w colonne (parole; TRONCA la parola piu' lunga di w: per spezzarla vedi splitLongWords)
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

// spezza in blocchi da w i token piu' lunghi di w, cosi' wrap() non li tronca (URL, IBAN, codici)
function splitLongWords(s, w = WIDTH) {
  return String(s).split(/\s+/).map((word) => {
    if (len(word) <= w) return word;
    const a = cp(word);
    const parts = [];
    for (let i = 0; i < a.length; i += w) parts.push(a.slice(i, i + w).join(""));
    return parts.join(" ");
  }).join(" ");
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
  const shortId = cleanField(o.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  line(padLine("Ordine #" + shortId, fmtDateTime(o.created_at)));
  line(sep);

  // tipo consegna/ritiro (grassetto)
  raw('<text em="true"/>');
  line(isPickup ? "*** RITIRO ***" : "*** CONSEGNA ***");
  raw('<text em="false"/>');
  const quando = cleanField([o.delivery_date ? fmtDate(o.delivery_date) : "", o.slot_label || ""].filter(Boolean).join("   "));
  if (quando) line((isPickup ? "Ritiro: " : "Consegna: ") + quando);
  line(sep);

  // cliente
  line(padLine(cleanField(o.customer_name || "-"), cleanField(o.customer_phone || "")));
  if (!isPickup && o.address) wrap(cleanField(o.address)).forEach(line);
  line(sep);

  // righe prodotto
  for (const it of items) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    line(padLine(qty + "x " + cleanField(it.format || "?"), euro((Number(it.prezzo_unit) || 0) * qty)));
    const gusti = Array.isArray(it.gusti) ? it.gusti.filter(Boolean).map((g) => cleanField(g)) : [];
    if (gusti.length) wrap(gusti.join(", "), WIDTH - 3).forEach((l) => line("   " + l));
  }
  line(sep);

  // totali
  line(padLine("Subtotale", euro(o.subtotal)));
  if (Number(o.delivery_cost) > 0) line(padLine("Consegna", euro(o.delivery_cost)));
  if (Number(o.discount) > 0) line(padLine("Sconto " + cleanField(o.coupon_code || ""), "-" + euro(o.discount)));
  raw('<text em="true"/><text height="2"/>');   // doppia ALTEZZA (non larghezza): padding a 48 resta valido
  line(padLine("TOTALE", euro(o.total)));
  raw('<text height="1"/><text em="false"/>');
  line(sep);

  // pagamento + note
  if (o.payment_method) line("Pagato: " + cleanField(o.payment_method).toUpperCase());
  if (o.notes) wrap("Note: " + cleanField(o.notes)).forEach(line);
  line(seph);

  raw('<feed line="3"/><cut type="feed"/>');

  return '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + out.join("") + "</epos-print>";
}

// Checklist di produzione (Epson 80mm/48col). `list` = [{name, kg}]; `createdAtIso` = quando è stato richiesto.
// Quadratino di spunta = "[ ]" ASCII (la termica usa code-page: il glifo Unicode ☐ rischia di non renderizzare).
function buildProductionXml(list, createdAtIso) {
  const items = Array.isArray(list) ? list : [];
  const sep = "-".repeat(WIDTH);
  const seph = "=".repeat(WIDTH);
  const out = [];
  const line = (s) => out.push("<text>" + esc(s) + "&#10;</text>");
  const raw = (xml) => out.push(xml);

  raw('<text align="center"/><text width="2" height="2"/>');
  line("PRODUZIONE");
  raw('<text width="1" height="1"/><text align="left"/>');
  line(seph);
  const when = fmtDateTime(createdAtIso);
  if (when) line(when);
  line(sep);

  items.forEach((it, i) => {
    const nome = it && it.name != null ? cleanField(it.name) : "?";
    const q = it && it.kg != null ? cleanField(it.kg) : "";
    line(padLine("[ ] " + nome, q + " kg"));   // padLine tronca la sinistra: nomi lunghi mai a capo
    if (i < items.length - 1) line(sep);        // linea piena sottile tra i gusti
  });
  line(seph);

  raw('<feed line="3"/><cut type="feed"/>');
  return '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + out.join("") + "</epos-print>";
}

// Nota libera scritta dal back office (Epson 80mm/48col). `payload` = {text}; `createdAtIso` = quando è stata richiesta.
// Gli a-capo dell'utente sono significativi: si spezza su \n e ogni riga passa per wrap() a 48 colonne.
// Tetto di righe stampate del corpo: i 2000 char del campo non limitano la carta (1998 a-capo = ~7 metri).
function buildNoteXml(payload, createdAtIso) {
  // pulizia all'ingresso: C0 via e CRLF/CR → \n, prima di misurare e impaginare
  const text = cleanText(payload && payload.text != null ? payload.text : "");
  const sep = "-".repeat(WIDTH);
  const out = [];
  const line = (s) => out.push("<text>" + esc(s) + "&#10;</text>");
  const raw = (xml) => out.push(xml);

  line(sep);
  raw('<text align="center"/><text width="2" height="2"/>');
  line("NOTA");
  raw('<text width="1" height="1"/>');
  const when = fmtDateTime(createdAtIso);
  if (when) line(when);
  raw('<text align="left"/>');
  line(sep);

  if (text.trim()) {
    const body = [];
    for (const l of text.split("\n")) {
      for (const w of wrap(splitLongWords(l))) {
        // wrap("") → [""]: le righe vuote restano, ma al massimo una consecutiva
        if (w === "" && body[body.length - 1] === "") continue;
        body.push(w);
      }
    }
    if (body.length > MAX_NOTE_LINES) {
      body.length = MAX_NOTE_LINES - 1;
      body.push("... nota troncata");
    }
    line("");
    body.forEach(line);
    line("");
    line(sep);
  }

  raw('<feed line="3"/><cut type="feed"/>');
  return '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + out.join("") + "</epos-print>";
}

// Scontrino di un ordine torta (Epson 80mm/48col). `payload` = la fotografia dell'ordine al momento
// del click; `createdAtIso` = quando e' stata chiesta la stampa.
// In alto cio' che serve in laboratorio (quando si ritira, cosa c'e' scritto sopra): se sbagliato
// manda a monte il lavoro. In fondo il riferimento per ritrovare l'ordine nel back office.
const CAKE_LABEL_W = 9;   // "Cliente: " — la colonna del valore parte sempre da qui

function buildCakeOrderXml(payload, createdAtIso) {
  const p = payload || {};
  const sep = "-".repeat(WIDTH);
  const out = [];
  const line = (s) => out.push("<text>" + esc(s) + "&#10;</text>");
  const raw = (xml) => out.push(xml);

  // campo etichettato: l'etichetta occupa una colonna fissa e le righe successive rientrano sotto
  // il valore. splitLongWords e wrap alla larghezza RESIDUA, se no un URL sfora o viene troncato.
  const campo = (etichetta, valore) => {
    const v = cleanText(valore == null ? "" : String(valore)).trim();
    if (!v) return;
    const lab = etichetta.padEnd(CAKE_LABEL_W);
    const w = WIDTH - lab.length;
    wrap(splitLongWords(v, w), w).forEach((l, i) => line((i ? " ".repeat(lab.length) : lab) + l));
  };

  raw('<text align="center"/>');
  line(sep);
  raw('<text width="2" height="2"/>');
  line("TORTA");
  raw('<text width="1" height="1"/>');
  line(sep);
  raw('<text align="left"/>');

  const ritiro = fmtDateTime(p.pickup_at);
  line(ritiro ? padLine("RITIRO", ritiro) : "RITIRO");
  line(sep);

  line(padLine(cleanField(p.item_name || "-"), cleanField(p.variant || "")));
  campo("Scritta:", p.inscription);
  campo("Extra:", p.extras);
  line(sep);

  campo("Cliente:", p.customer_name);
  // il telefono su una riga sua: spezzato a meta' riga sarebbe inutile a chi deve chiamare
  campo("Tel:", p.customer_phone);
  campo("Note:", p.notes);
  line(sep);

  line(padLine("Prezzo", euro(p.price)));
  line(sep);

  // `createdAtIso` e' la data del JOB DI STAMPA: per "preso" vale la data dell'ORDINE, altrimenti
  // una ristampa di domani direbbe che l'ordine e' di domani.
  const rif = cleanField(p.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  const preso = fmtDateTime(p.created_at || createdAtIso);
  const sinistra = rif ? "Ordine #" + rif : "Ordine";
  line(preso ? padLine(sinistra, "preso " + preso) : sinistra);

  raw('<feed line="3"/><cut type="feed"/>');
  return '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' + out.join("") + "</epos-print>";
}

module.exports = { buildReceiptXml, buildProductionXml, buildNoteXml, buildCakeOrderXml };
