import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderEmail } = require("../netlify/functions/lib/email-templates.js");

const legal = {
  logoUrl: "https://x/img/logo-full.png", tcUrl: "https://x/tc", privacyUrl: "https://x/pp",
  whatsappUrl: "https://wa.me/1", ragioneSociale: "ACME Srl", piva: "01234567890", sede: "Via Test 1",
};
const baseOrder = {
  id: "abcd1234", customer_name: "Marco Rossi", email: "x@y.it", lang: "it",
  fulfillment: "delivery", address: "Via Mare 1", delivery_date: "2026-07-01", slot_label: "18:00 - 18:30",
  items: [{ format: "Vaschetta 500g", gusti: ["pistacchio", "<script>"], qty: 1, prezzo_unit: 9 }],
  subtotal: 9, delivery_cost: 2, discount: 0, total: 11,
};
const opts = { legal, cancelUrl: "https://x/.netlify/functions/cancel-order?token=TKN" };

test("ricevuto IT: subject, nome, totale, pulsante annulla, recesso", () => {
  const m = renderEmail(baseOrder, "ricevuto", opts);
  assert.match(m.subject, /ricevuto/i);
  assert.match(m.html, /Grazie Marco/);
  assert.match(m.html, /€ 11,00/);
  assert.match(m.html, /Annulla ordine/);
  assert.match(m.html, /token=TKN/);
  assert.match(m.html, /diritto di recesso/i);
});

test("input cliente escapato (XSS)", () => {
  const m = renderEmail(baseOrder, "ricevuto", opts);
  assert.ok(!m.html.includes("<script>"), "lo <script> nei gusti non deve finire grezzo");
  assert.match(m.html, /&lt;script&gt;/);
});

test("accettato: include conservazione + annulla", () => {
  const m = renderEmail(baseOrder, "accettato", opts);
  assert.match(m.html, /Conservazione/i);
  assert.match(m.html, /ricongelare/i);
  assert.match(m.html, /Annulla ordine/);
});

test("consegnato: ringraziamento, NIENTE pulsante annulla", () => {
  const m = renderEmail(baseOrder, "consegnato", opts);
  assert.match(m.html, /Grazie Marco/);
  assert.ok(!m.html.includes("Annulla ordine"), "consegnato non deve avere il pulsante annulla");
});

test("rifiutato/annullato: nota rimborso stesso metodo", () => {
  assert.match(renderEmail(baseOrder, "rifiutato", opts).html, /stesso metodo di pagamento/);
  assert.match(renderEmail(baseOrder, "annullato", opts).html, /stesso metodo di pagamento/);
});

test("EN: lingua inglese sui testi", () => {
  const m = renderEmail({ ...baseOrder, lang: "en" }, "ricevuto", opts);
  assert.match(m.subject, /received/i);
  assert.match(m.html, /Cancel order/);
  assert.match(m.html, /Thanks Marco/);
});

test("status sconosciuto → null", () => {
  assert.equal(renderEmail(baseOrder, "in preparazione", opts), null);
});
