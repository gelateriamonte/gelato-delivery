import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProductionXml } from "../netlify/functions/lib/receipt.js";

test("buildProductionXml: titolo, righe in ordine, checkbox ASCII, kg", () => {
  const xml = buildProductionXml(
    [{ name: "Pistacchio", kg: 3 }, { name: "Fiordilatte", kg: 8 }],
    "2026-06-25T10:00:00Z"
  );
  assert.match(xml, /^<epos-print /);
  assert.match(xml, /PRODUZIONE/);
  assert.ok(xml.includes("[ ] Pistacchio"), "riga pistacchio col quadratino");
  assert.ok(xml.includes("[ ] Fiordilatte"), "riga fiordilatte col quadratino");
  assert.ok(xml.includes("3 kg") && xml.includes("8 kg"), "kg presenti");
  // ordine: Pistacchio prima di Fiordilatte
  assert.ok(xml.indexOf("Pistacchio") < xml.indexOf("Fiordilatte"), "ordine preservato");
  assert.match(xml, /<cut /, "taglio finale");
});

test("buildProductionXml: lista vuota stampa solo intestazione (no crash)", () => {
  const xml = buildProductionXml([], "2026-06-25T10:00:00Z");
  assert.match(xml, /PRODUZIONE/);
  assert.ok(!xml.includes("[ ]"), "nessuna riga gusto");
});
