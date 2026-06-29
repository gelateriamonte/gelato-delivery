import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const W = require("../netlify/functions/lib/order-window.js");

// utility: Date reale che in Europe/Rome (estate = CEST, UTC+2) vale le ore indicate
const romeSummer = (h, mi = 0, d = 1) => new Date(Date.UTC(2026, 6, d, h - 2, mi)); // luglio
// inverno (CET, UTC+1)
const romeWinter = (h, mi = 0, d = 1) => new Date(Date.UTC(2026, 0, d, h - 1, mi)); // gennaio

test("slotStartMinutes: delivery, pickup, en-dash, garbage", () => {
  assert.equal(W.slotStartMinutes("18:00 - 18:30"), 18 * 60);
  assert.equal(W.slotStartMinutes("Ritiro 18:30"), 18 * 60 + 30);
  assert.equal(W.slotStartMinutes("19:00 – 19:30"), 19 * 60); // en dash
  assert.equal(W.slotStartMinutes("21:00 - 21:30"), 21 * 60);
  assert.equal(W.slotStartMinutes("nessun orario"), null);
  assert.equal(W.slotStartMinutes(null), null);
});

test("cancelCutoffWall: 2h prima della fascia (default)", () => {
  // fascia 18:00 il 2026-07-01, anticipo 2 → cutoff wall 16:00
  assert.equal(W.cancelCutoffWall("2026-07-01", "18:00 - 18:30"), Date.UTC(2026, 6, 1, 16, 0));
  // pickup "Ritiro 09:30", anticipo 2 → 07:30
  assert.equal(W.cancelCutoffWall("2026-07-01", "Ritiro 09:30"), Date.UTC(2026, 6, 1, 7, 30));
});

test("canCancel: dentro finestra (estate/CEST) → ok", () => {
  const order = { status: "ricevuto", delivery_date: "2026-07-01", slot_label: "18:00 - 18:30", refunded_at: null };
  assert.deepEqual(W.canCancel(order, romeSummer(15, 0)), { ok: true, reason: "ok" });
});

test("canCancel: oltre finestra → window", () => {
  const order = { status: "accettato", delivery_date: "2026-07-01", slot_label: "18:00 - 18:30", refunded_at: null };
  assert.deepEqual(W.canCancel(order, romeSummer(16, 30)), { ok: false, reason: "window" });
});

test("canCancel: esattamente al cutoff (16:00) ancora ok (inclusivo)", () => {
  const order = { status: "ricevuto", delivery_date: "2026-07-01", slot_label: "18:00 - 18:30", refunded_at: null };
  assert.equal(W.canCancel(order, romeSummer(16, 0)).ok, true);
  assert.equal(W.canCancel(order, romeSummer(16, 1)).ok, false);
});

test("canCancel: stato non idoneo → status", () => {
  const order = { status: "in preparazione", delivery_date: "2026-07-01", slot_label: "18:00 - 18:30", refunded_at: null };
  assert.deepEqual(W.canCancel(order, romeSummer(10, 0)), { ok: false, reason: "status" });
});

test("canCancel: già rimborsato → refunded (precede ogni altro check)", () => {
  const order = { status: "ricevuto", delivery_date: "2026-07-01", slot_label: "18:00 - 18:30", refunded_at: "2026-06-30T10:00:00Z" };
  assert.deepEqual(W.canCancel(order, romeSummer(10, 0)), { ok: false, reason: "refunded" });
});

test("canCancel: DST inverno (CET/UTC+1) coerente wall-clock", () => {
  const order = { status: "ricevuto", delivery_date: "2026-01-15", slot_label: "18:00 - 18:30", refunded_at: null };
  // 15:00 Rome (inverno) = 14:00 UTC → dentro (<16:00)
  assert.equal(W.canCancel(order, new Date(Date.UTC(2026, 0, 15, 14, 0))).ok, true);
  // 16:30 Rome = 15:30 UTC → fuori
  assert.equal(W.canCancel(order, new Date(Date.UTC(2026, 0, 15, 15, 30))).ok, false);
});

test("canCancel: dati invalidi → invalid", () => {
  assert.equal(W.canCancel(null, romeSummer(10)).reason, "invalid");
  assert.equal(W.canCancel({ status: "ricevuto", delivery_date: "x", slot_label: "y", refunded_at: null }, romeSummer(10)).reason, "invalid");
});
