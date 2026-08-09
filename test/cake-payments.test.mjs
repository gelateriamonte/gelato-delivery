// Pagamenti torte: le funzioni pure di js/admin-torte.js girano in un sandbox vm
// con i globals del browser stubbati. Le function declaration finiscono sul
// contesto e da lì si testano; il resto del file (IIFE di aggancio) si accontenta
// di stub che ritornano null/noop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliSrc = await readFile(new URL("../js/admin-clienti.js", import.meta.url), "utf8");
const torteSrc = await readFile(new URL("../js/admin-torte.js", import.meta.url), "utf8");

const noop = () => {};
const ctx = vm.createContext({
  console,
  $: () => null,
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
  sb: { auth: { getSession: () => Promise.resolve({ data: null }), onAuthStateChange: noop } },
});
// clienti prima di torte, come in admin.html (torte usa cliNormPhone e cliDay)
vm.runInContext(cliSrc, ctx, { filename: "admin-clienti.js" });
vm.runInContext(torteSrc, ctx, { filename: "admin-torte.js" });

test("cakeLastOfMonth: fine mese in formato input date", () => {
  assert.equal(ctx.cakeLastOfMonth(new Date(2026, 7, 9)), "2026-08-31");   // agosto
  assert.equal(ctx.cakeLastOfMonth(new Date(2026, 1, 10)), "2026-02-28");  // febbraio
  assert.equal(ctx.cakeLastOfMonth(new Date(2028, 1, 1)), "2028-02-29");   // bisestile
  assert.equal(ctx.cakeLastOfMonth(new Date(2026, 11, 31)), "2026-12-31"); // dicembre, niente rollover
});

test("cakeUnpaid: consegnato senza incasso, e solo quello", () => {
  assert.equal(ctx.cakeUnpaid({ status: "consegnato", paid_at: null }), true);
  assert.equal(ctx.cakeUnpaid({ status: "consegnato", paid_at: "2026-08-09T10:00:00Z" }), false);
  assert.equal(ctx.cakeUnpaid({ status: "in attesa", paid_at: null }), false);
});

test("cakeByDue: scadenza vicina prima, senza data in fondo", () => {
  const a = { payment_due_date: "2026-08-15", delivered_at: "2026-08-01T10:00:00Z" };
  const b = { payment_due_date: "2026-08-31", delivered_at: "2026-08-02T10:00:00Z" };
  const c = { payment_due_date: null, delivered_at: "2026-08-03T10:00:00Z" };
  const out = [c, b, a].sort(ctx.cakeByDue);
  assert.deepEqual(out, [a, b, c]);
});

test("cakeByDue: a pari scadenza vince la consegna piu' recente", () => {
  const a = { payment_due_date: "2026-08-31", delivered_at: "2026-08-05T10:00:00Z" };
  const b = { payment_due_date: "2026-08-31", delivered_at: "2026-08-01T10:00:00Z" };
  assert.deepEqual([b, a].sort(ctx.cakeByDue), [a, b]);
});
