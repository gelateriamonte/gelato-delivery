import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNoteXml, buildProductionXml, buildReceiptXml } from "../netlify/functions/lib/receipt.js";

// controlli C0 non ammessi da XML 1.0 (tutti tranne TAB/LF/CR)
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

// estrae le righe stampate e le riporta al testo originale (l'escape avviene all'emissione)
const textLines = (xml) => (xml.match(/<text>[^<]*&#10;<\/text>/g) || []).map((t) =>
  t.slice("<text>".length, -"&#10;</text>".length)
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
);

// righe del corpo della nota: esclude separatori, titolo e data/ora dell'intestazione
const bodyLines = (xml) => textLines(xml).filter(
  (l) => l && !/^-+$/.test(l) && l !== "NOTA" && !/^\d{2}\/\d{2}\/\d{4}/.test(l)
);

test("buildNoteXml: intestazione NOTA, data/ora, testo, taglio", () => {
  const xml = buildNoteXml({ text: "Comprare vaschette 1,7 kg" }, "2026-08-01T12:05:00Z");
  assert.match(xml, /^<epos-print /);
  assert.match(xml, /NOTA/);
  assert.match(xml, /width="2" height="2"/, "titolo a doppia dimensione");
  assert.match(xml, /align="center"/, "intestazione centrata");
  assert.ok(xml.includes("01/08/2026"), "data locale Europe/Rome");
  assert.ok(xml.includes("14:05"), "ora locale Europe/Rome");
  assert.ok(textLines(xml).includes("Comprare vaschette 1,7 kg"), "testo della nota presente");
  assert.match(xml, /<cut /, "taglio finale");
});

test("buildNoteXml: gli a-capo dell'utente restano righe distinte", () => {
  const xml = buildNoteXml({ text: "Comprare vaschette\nChiamare fornitore pistacchio" }, "2026-08-01T12:05:00Z");
  const lines = textLines(xml);
  assert.ok(lines.includes("Comprare vaschette"), "prima riga");
  assert.ok(lines.includes("Chiamare fornitore pistacchio"), "seconda riga");
  assert.ok(
    lines.indexOf("Comprare vaschette") < lines.indexOf("Chiamare fornitore pistacchio"),
    "ordine preservato"
  );
});

test("buildNoteXml: riga piu' lunga di 48 colonne va a capo", () => {
  const lunga = "Comprare vaschette da un chilo e sette, coni piccoli e cialde per il fine settimana";
  assert.ok(lunga.length > 48, "il caso di prova deve superare le 48 colonne");
  const xml = buildNoteXml({ text: lunga }, "2026-08-01T12:05:00Z");
  const lines = textLines(xml);
  for (const l of lines) assert.ok(l.length <= 48, `riga oltre 48 colonne: ${l}`);
  // le righe del corpo, riunite, ricompongono il testo originale
  const corpo = lines.filter((l) => l && !/^-+$/.test(l) && l !== "NOTA" && !l.includes("01/08/2026"));
  assert.ok(corpo.length >= 2, "il testo lungo e' stato spezzato su piu' righe");
  assert.equal(corpo.join(" "), lunga, "nessuna parola persa nell'andare a capo");
});

test("buildNoteXml: caratteri XML pericolosi escapati", () => {
  const xml = buildNoteXml({ text: "Panna & fragola <urgente>" }, "2026-08-01T12:05:00Z");
  assert.ok(xml.includes("Panna &amp; fragola &lt;urgente&gt;"), "escape applicato");
  assert.ok(!xml.includes("<urgente>"), "nessun tag grezzo nell'XML");
  assert.ok(!xml.includes("Panna & fragola"), "nessuna & grezza nell'XML");
  assert.ok(textLines(xml).includes("Panna & fragola <urgente>"), "il testo stampato resta leggibile");
});

test("buildNoteXml: testo vuoto o payload assente stampa solo l'intestazione (no crash)", () => {
  for (const payload of [{ text: "" }, { text: "   \n  " }, {}, null, undefined]) {
    const xml = buildNoteXml(payload, "2026-08-01T12:05:00Z");
    assert.match(xml, /NOTA/);
    assert.match(xml, /<cut /);
    assert.ok(!textLines(xml).includes(""), "nessuna riga di corpo con nota vuota");
  }
});

test("buildNoteXml: parola piu' lunga di 48 colonne spezzata senza perdere caratteri", () => {
  const url = "https://www.gelateriamontepetrosu.it/back-office/note/riepilogo-produzione-estate26.pdf";
  assert.equal(url.length, 87, "il caso di prova e' un token unico da 87 caratteri");
  const xml = buildNoteXml({ text: url }, "2026-08-01T12:05:00Z");
  for (const l of textLines(xml)) assert.ok(l.length <= 48, `riga oltre 48 colonne: ${l}`);
  const corpo = bodyLines(xml);
  assert.ok(corpo.length >= 2, "l'URL e' stato spezzato su piu' righe");
  assert.equal(corpo.join(""), url, "nessun carattere perso: l'URL si ricompone");
});

test("buildNoteXml: caratteri di controllo C0 rimossi (la stampante li rifiuterebbe)", () => {
  const xml = buildNoteXml({ text: "Ordine\u001B[1m urgente\u0000 per domani\u000C" }, "2026-08-01T12:05:00Z");
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), "nessun carattere di controllo nell'XML");
  assert.ok(bodyLines(xml).join(" ").includes("urgente"), "il testo leggibile resta stampato");
});

test("buildNoteXml: fine riga CRLF e CR sole diventano a-capo veri", () => {
  const xml = buildNoteXml({ text: "Comprare vaschette\r\nChiamare fornitore\rOrdinare coni" }, "2026-08-01T12:05:00Z");
  assert.ok(!xml.includes("\r"), "nessun CR appeso nell'XML");
  assert.deepEqual(
    bodyLines(xml),
    ["Comprare vaschette", "Chiamare fornitore", "Ordinare coni"],
    "tre righe distinte, non una riga sola incollata"
  );
});

// L'allineamento a 48 colonne si calcola su stringhe RAW: se i controlli C0 sparissero solo
// all'emissione (dentro esc()), padLine/wrap li conterebbero e la riga stampata uscirebbe corta,
// con la colonna destra staccata dal margine.
test("buildProductionXml: i controlli C0 non accorciano la riga sotto le 48 colonne", () => {
  const xml = buildProductionXml(
    [{ name: "Cioccolato\u000B fondente\u000C 70%", kg: 16 }],
    "2026-08-01T12:05:00Z"
  );
  assert.ok(!C0.test(xml), "nessun carattere di controllo nell'XML");
  const riga = textLines(xml).find((l) => l.startsWith("[ ] "));
  assert.equal(riga, "[ ] Cioccolato fondente 70%" + " ".repeat(16) + "16 kg");
  assert.equal(riga.length, 48, "i kg restano al margine dei 48 caratteri");
});

test("buildReceiptXml: i controlli C0 nel nome cliente non accorciano la riga", () => {
  const xml = buildReceiptXml({
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    created_at: "2026-08-01T12:05:00Z",
    fulfillment: "pickup",
    customer_name: "Maria\u000C Rossi",
    customer_phone: "3331234567",
  });
  const riga = textLines(xml).find((l) => l.startsWith("Maria"));
  assert.equal(riga, "Maria Rossi" + " ".repeat(27) + "3331234567");
  assert.equal(riga.length, 48, "il telefono resta allineato a destra");
});

// TAB/LF/CR sono gli unici C0 leciti in XML, quindi non basta lasciarli passare: in un campo di una
// riga la stampante andrebbe a capo (o al tab stop) DOPO il calcolo delle colonne → colonna destra
// staccata dal margine. All'ingresso diventano uno spazio, che occupa la stessa larghezza misurata.
test("buildReceiptXml/buildProductionXml: a-capo e tab nei campi di una riga non spostano la colonna destra", () => {
  const xml = buildReceiptXml({
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    created_at: "2026-08-01T12:05:00Z",
    fulfillment: "pickup",
    customer_name: "Maria\nRossi",
    customer_phone: "3331234567",
  });
  const riga = textLines(xml).find((l) => l.startsWith("Maria"));
  assert.equal(riga, "Maria Rossi" + " ".repeat(27) + "3331234567");
  assert.ok(!/[\t\n\r]/.test(riga), "nessuna spaziatura di controllo nella riga gia' impaginata");

  const prod = buildProductionXml([{ name: "Cioccolato\tfondente", kg: 16 }], "2026-08-01T12:05:00Z");
  const rigaProd = textLines(prod).find((l) => l.startsWith("[ ] "));
  assert.equal(rigaProd, "[ ] Cioccolato fondente" + " ".repeat(20) + "16 kg");
  assert.equal(rigaProd.length, 48, "i kg restano al margine dei 48 caratteri");
});

// Copertura: nessun campo di nessuno dei tre builder puo' portare un C0 nell'XML (documento rifiutato).
test("nessuno dei tre builder lascia passare caratteri di controllo C0", () => {
  const v = (s) => "\u0001" + s + "\u001B\u000C";
  const order = {
    id: v("abcdef12-3456-7890-abcd-ef1234567890"),
    created_at: "2026-08-01T12:05:00Z",
    fulfillment: "delivery",
    delivery_date: v("domani"),          // formato non riconosciuto: fmtDate ripassa la stringa grezza
    slot_label: v("18:00-19:00"),
    customer_name: v("Mario Rossi"),
    customer_phone: v("3331234567"),
    address: v("Via Roma 1, San Teodoro"),
    items: [{ qty: 2, format: v("Vaschetta 1kg"), prezzo_unit: 18.5, gusti: [v("Pistacchio"), v("Nocciola")] }],
    subtotal: 37, delivery_cost: 3, discount: 2, coupon_code: v("ESTATE"),
    total: 38, payment_method: v("stripe"), notes: v("citofonare"),
  };
  assert.ok(!C0.test(buildReceiptXml(order)), "scontrino ordine pulito");
  assert.ok(
    !C0.test(buildProductionXml([{ name: v("Cioccolato"), kg: v("16") }], "2026-08-01T12:05:00Z")),
    "checklist produzione pulita"
  );
  assert.ok(!C0.test(buildNoteXml({ text: v("Nota urgente") }, "2026-08-01T12:05:00Z")), "nota pulita");
});

test("buildNoteXml: sequenze di righe vuote collassate (niente scontrino chilometrico)", () => {
  const xml = buildNoteXml({ text: "x" + "\n".repeat(1998) }, "2026-08-01T12:05:00Z");
  const lines = textLines(xml);
  assert.ok(lines.length <= 62, `righe stampate: ${lines.length}`);
  assert.ok(lines.includes("x"), "il contenuto resta stampato");
});

test("buildNoteXml: corpo oltre il tetto troncato con avviso finale", () => {
  const text = Array.from({ length: 200 }, (_, i) => "riga " + (i + 1)).join("\n");
  const xml = buildNoteXml({ text }, "2026-08-01T12:05:00Z");
  const corpo = bodyLines(xml);
  assert.equal(corpo.length, 60, "corpo limitato al tetto di 60 righe stampate");
  assert.equal(corpo[corpo.length - 1], "... nota troncata", "avviso di troncamento come ultima riga");
  assert.ok(corpo.includes("riga 1"), "l'inizio della nota resta");
  assert.ok(!corpo.includes("riga 200"), "la coda oltre il tetto non viene stampata");
});

// Rete di sicurezza: le correzioni della nota non devono toccare scontrino ordine e produzione.
// I due attesi sono l'output catturato PRIMA della modifica, con parole piu' lunghe di 48 colonne.
test("buildReceiptXml/buildProductionXml: output invariato byte a byte (non regressione)", () => {
  const order = {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    created_at: "2026-08-01T12:05:00Z",
    fulfillment: "delivery",
    delivery_date: "2026-08-02",
    slot_label: "18:00-19:00",
    customer_name: "Mario Rossi",
    customer_phone: "3331234567",
    address: "ViaEstremamenteLunghissimaSenzaSpaziDiSortaCheSuperaLeQuarantottoColonne 12, San Teodoro",
    items: [{ qty: 2, format: "Vaschetta 1kg", prezzo_unit: 18.5,
      gusti: ["Pistacchio", "SuperCalifragilisticExpialidocious-Fiordilatte-Extra-Lungo", "Nocciola"] }],
    subtotal: 37, delivery_cost: 3, discount: 2, coupon_code: "ESTATE",
    total: 38, payment_method: "stripe",
    notes: "https://www.esempio.it/percorso/molto/lungo/che/supera/le/quarantotto/colonne/xyz",
  };
  const produzione = [
    { name: "PistacchioDiBronteSuperExtraLungoSenzaSpaziCheSforaLeColonne", kg: 16 },
    { name: "Fiordilatte", kg: 3 },
  ];
  assert.equal(buildReceiptXml(order), "<epos-print xmlns=\"http://www.epson-pos.com/schemas/2011/03/epos-print\"><text align=\"center\"/><text width=\"2\" height=\"2\"/><text>GELATO26&#10;</text><text width=\"1\" height=\"1\"/><text align=\"left\"/><text>================================================&#10;</text><text>Ordine #ABCDEF12               01/08/2026  14:05&#10;</text><text>------------------------------------------------&#10;</text><text em=\"true\"/><text>*** CONSEGNA ***&#10;</text><text em=\"false\"/><text>Consegna: 02/08/2026   18:00-19:00&#10;</text><text>------------------------------------------------&#10;</text><text>Mario Rossi                           3331234567&#10;</text><text>ViaEstremamenteLunghissimaSenzaSpaziDiSortaCheSu&#10;</text><text>12, San Teodoro&#10;</text><text>------------------------------------------------&#10;</text><text>2x Vaschetta 1kg                           37,00&#10;</text><text>   Pistacchio,&#10;</text><text>   SuperCalifragilisticExpialidocious-Fiordilatt&#10;</text><text>   Nocciola&#10;</text><text>------------------------------------------------&#10;</text><text>Subtotale                                  37,00&#10;</text><text>Consegna                                    3,00&#10;</text><text>Sconto ESTATE                              -2,00&#10;</text><text em=\"true\"/><text height=\"2\"/><text>TOTALE                                     38,00&#10;</text><text height=\"1\"/><text em=\"false\"/><text>------------------------------------------------&#10;</text><text>Pagato: STRIPE&#10;</text><text>Note:&#10;</text><text>https://www.esempio.it/percorso/molto/lungo/che/&#10;</text><text>================================================&#10;</text><feed line=\"3\"/><cut type=\"feed\"/></epos-print>");
  assert.equal(buildProductionXml(produzione, "2026-08-01T12:05:00Z"), "<epos-print xmlns=\"http://www.epson-pos.com/schemas/2011/03/epos-print\"><text align=\"center\"/><text width=\"2\" height=\"2\"/><text>PRODUZIONE&#10;</text><text width=\"1\" height=\"1\"/><text align=\"left\"/><text>================================================&#10;</text><text>01/08/2026  14:05&#10;</text><text>------------------------------------------------&#10;</text><text>[ ] PistacchioDiBronteSuperExtraLungoSenza 16 kg&#10;</text><text>------------------------------------------------&#10;</text><text>[ ] Fiordilatte                             3 kg&#10;</text><text>================================================&#10;</text><feed line=\"3\"/><cut type=\"feed\"/></epos-print>");
});
