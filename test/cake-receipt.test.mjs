import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCakeOrderXml } from "../netlify/functions/lib/receipt.js";

// pickup_at e' un timestamptz: 15:00Z = 17:00 a Roma in agosto (CEST). Lo scontrino
// stampa l'ora LOCALE della gelateria, quindi il fixture porta lo Z e ci si aspetta 17:00.
const ORDINE = {
  id: "a1b2c3d4-0000-0000-0000-000000000000",
  created_at: "2026-08-01T18:15:00Z",
  customer_name: "Rossi Mario",
  customer_phone: "3351234567",
  item_name: "Sacher",
  variant: "grande",
  price: 40,
  pickup_at: "2026-08-09T15:00:00Z",
  inscription: "Buon compleanno Anna",
  extras: "6 candeline",
  notes: "senza glutine",
};

// estrae il testo stampato, de-escapato, cosi' si asserisce su cio' che esce dalla carta
function righe(xml) {
  return [...xml.matchAll(/<text>([^<]*)<\/text>/g)]
    .map((m) => m[1]
      .replace(/&#10;/g, "")
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
    .map((s) => s.trimEnd());
}

test("buildCakeOrderXml: intestazione, ritiro, torta, scritta, prezzo, taglio", () => {
  const xml = buildCakeOrderXml(ORDINE, "2026-08-01T20:00:00Z");
  assert.match(xml, /^<epos-print /);
  const r = righe(xml).join("\n");
  assert.match(r, /TORTA/);
  assert.match(xml, /width="2" height="2"/, "titolo a doppia dimensione");
  assert.match(r, /09\/08/, "data di ritiro presente");
  assert.match(r, /17:00/, "ora di ritiro locale Europe/Rome");
  assert.match(r, /Sacher/);
  assert.match(r, /grande/);
  assert.match(r, /Buon compleanno Anna/);
  assert.match(r, /6 candeline/);
  assert.match(r, /Rossi Mario/);
  assert.match(r, /senza glutine/);
  assert.match(r, /40,00/, "prezzo in formato italiano");
  assert.match(xml, /<cut /);
});

test("buildCakeOrderXml: il telefono c'e' ed e' su una riga sua, non spezzato", () => {
  const xml = buildCakeOrderXml(ORDINE, "2026-08-01T20:00:00Z");
  const rigaTel = righe(xml).find((l) => l.startsWith("Tel:"));
  assert.ok(rigaTel, "esiste una riga dedicata al telefono");
  assert.match(rigaTel, /3351234567/, "il numero e' intero su quella riga");
  assert.ok(!/Rossi Mario/.test(rigaTel), "il telefono non e' accodato al nome");
});

test("buildCakeOrderXml: le etichette allineano il valore alla stessa colonna", () => {
  const r = righe(buildCakeOrderXml(ORDINE, "2026-08-01T20:00:00Z"));
  for (const atteso of [
    "Scritta: Buon compleanno Anna",
    "Extra:   6 candeline",
    "Cliente: Rossi Mario",
    "Tel:     3351234567",
    "Note:    senza glutine",
  ]) assert.ok(r.includes(atteso), `riga attesa: "${atteso}"`);
});

test("buildCakeOrderXml: riferimento ordine e data di presa in carico", () => {
  const xml = buildCakeOrderXml(ORDINE, "2026-08-01T20:00:00Z");
  const r = righe(xml).join("\n");
  assert.match(r, /#A1B2C3D4/, "riferimento breve dell'ordine");
  assert.match(r, /01\/08\/2026/, "data in cui l'ordine e' stato preso");
});

test("buildCakeOrderXml: 'preso' e' la data dell'ordine, non quella del job di stampa", () => {
  // ristampa fatta il 15/08 di un ordine preso il 01/08: sullo scontrino deve restare il 01/08
  const xml = buildCakeOrderXml(ORDINE, "2026-08-15T09:00:00Z");
  const riga = righe(xml).find((l) => l.startsWith("Ordine "));
  assert.ok(riga, "esiste la riga di riferimento dell'ordine");
  assert.match(riga, /preso 01\/08\/2026/, "data dell'ordine");
  assert.ok(!/15\/08\/2026/.test(riga), "non la data della ristampa");
});

test("buildCakeOrderXml: senza created_at si ripiega sulla data del job di stampa", () => {
  const { created_at, ...senzaData } = ORDINE;
  assert.ok(created_at, "il fixture ha created_at");
  const xml = buildCakeOrderXml(senzaData, "2026-08-15T09:00:00Z");
  assert.match(righe(xml).join("\n"), /preso 15\/08\/2026/);
});

test("buildCakeOrderXml: campi facoltativi assenti non lasciano righe vuote", () => {
  const xml = buildCakeOrderXml(
    { ...ORDINE, inscription: "", extras: null, notes: undefined },
    "2026-08-01T20:00:00Z"
  );
  const r = righe(xml);
  assert.ok(!r.some((l) => /^Scritta:\s*$/.test(l)), "nessuna riga 'Scritta:' vuota");
  assert.ok(!r.some((l) => /^Extra:\s*$/.test(l)), "nessuna riga 'Extra:' vuota");
  assert.ok(!r.some((l) => /^Note:\s*$/.test(l)), "nessuna riga 'Note:' vuota");
  assert.ok(r.some((l) => l.startsWith("Tel:")), "il telefono resta");
});

test("buildCakeOrderXml: scritta lunghissima senza spazi non perde caratteri", () => {
  const lunga = "Z".repeat(90);   // Z non compare altrove nello scontrino
  const xml = buildCakeOrderXml({ ...ORDINE, inscription: lunga }, "2026-08-01T20:00:00Z");
  const r = righe(xml);
  assert.ok(r.every((l) => l.length <= 48), "nessuna riga oltre 48 colonne");
  assert.equal(r.join("").split("Z").length - 1, 90, "i caratteri non vengono persi");
});

test("buildCakeOrderXml: nessuna riga supera le 48 colonne", () => {
  const xml = buildCakeOrderXml({
    ...ORDINE,
    customer_name: "Bartolomeo Della Rovere Di Montefeltro Junior",
    item_name: "Torta al cioccolato fondente con lamponi e meringa",
    variant: "grande",
    notes: "citofonare al secondo piano interno 4, il campanello non funziona",
    price: 12345.67,
  }, "2026-08-01T20:00:00Z");
  for (const l of righe(xml)) assert.ok(l.length <= 48, `riga troppo lunga: "${l}"`);
});

// controlli C0 non ammessi da XML 1.0 (tutti tranne TAB/LF/CR): la stampante rifiuterebbe il documento
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

test("buildCakeOrderXml: escape XML una volta sola, C0 tolti all'ingresso", () => {
  const xml = buildCakeOrderXml({
    ...ORDINE,
    customer_name: "Rossi & <Figli>",
    inscription: "\u0007Auguri \"Anna\"\u0000",
  }, "2026-08-01T20:00:00Z");
  assert.ok(!C0.test(xml), "nessun controllo C0 nell'XML");
  assert.ok(xml.includes("Rossi &amp; &lt;Figli&gt;"), "escape applicato");
  assert.ok(!xml.includes("&amp;amp;"), "escape non applicato due volte");
  const r = righe(xml);
  assert.ok(r.includes("Cliente: Rossi & <Figli>"), "il testo stampato e' quello originale");
  assert.ok(r.includes('Scritta: Auguri "Anna"'), "i controlli spariscono, il resto no");
});

test("buildCakeOrderXml: payload vuoto non lancia", () => {
  for (const p of [{}, null, undefined]) {
    assert.doesNotThrow(() => buildCakeOrderXml(p, "2026-08-01T20:00:00Z"));
    const xml = buildCakeOrderXml(p, "2026-08-01T20:00:00Z");
    assert.match(xml, /^<epos-print /);
    assert.match(xml, /<\/epos-print>$/);
    for (const l of righe(xml)) assert.ok(l.length <= 48, `riga troppo lunga: "${l}"`);
  }
});
