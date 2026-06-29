import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home exposes the information link through the multilingual dictionary", () => {
  const html = read("index.html");
  const i18n = read("js/i18n.js");

  assert.match(html, /href="informazioni\.html"/);
  assert.match(html, /data-i18n-attr="aria-label:home\.legal\.aria"/);
  assert.match(html, /data-i18n="home\.legal\.eyebrow"/);
  assert.match(html, /data-i18n="home\.legal\.title"/);
  assert.match(html, /data-i18n="home\.legal\.copy"/);
  assert.match(i18n, /"home\.legal\.title": "Allergeni, Privacy e Condizioni"/);
  assert.match(i18n, /"home\.legal\.title": "Allergens, Privacy and Terms"/);
  assert.match(i18n, /"home\.legal\.copy": "Scheda allergeni e documenti del servizio"/);
  assert.match(i18n, /"home\.legal\.copy": "Allergen sheet and service documents"/);
});

test("consumer information page separates Italian and English detail panels", () => {
  const html = read("informazioni.html");
  assert.match(html, /legal\/privacy-policy\.v2026-06-26\.md/);
  assert.match(html, /legal\/condizioni-generali-vendita\.v2026-06-26\.md/);
  assert.match(html, /legal\/allergeni\.v2026-06-26\.md/);
  assert.match(html, /data-lang-btn="it"/);
  assert.match(html, /data-lang-btn="en"/);
  assert.match(html, /data-lang-panel="it"/);
  assert.match(html, /data-lang-panel="en"/);
  assert.match(html, /Informazioni sugli allergeni/);
  assert.match(html, /Allergen information/);
  assert.match(html, /contaminazione crociata/i);
  assert.match(html, /cross-contamination/i);
  assert.match(html, /allergie gravi/i);
  assert.match(html, /severe allergies/i);
});

test("allergen document covers required customer-facing warnings", () => {
  const doc = read("legal/allergeni.v2026-06-26.md");
  assert.match(doc, /14 allergeni/i);
  assert.match(doc, /Regolamento \(UE\) 1169\/2011/);
  assert.match(doc, /contaminazione crociata/i);
  assert.match(doc, /allergie gravi/i);
  assert.match(doc, /latte/i);
  assert.match(doc, /frutta a guscio/i);
});

test("versioned legal documents describe shop acceptance, refunds, and the cancellation cutoff", () => {
  const terms = read("legal/condizioni-generali-vendita.v2026-06-26.md");
  const privacy = read("legal/privacy-policy.v2026-06-26.md");

  assert.match(terms, /back[- ]office/i);
  assert.match(terms, /contratto[\s\S]{0,160}accettazione[\s\S]{0,120}Venditore/i);
  assert.match(terms, /rifiut[\wàèéìòù]*[\s\S]{0,220}rimbors\w*[\s\S]{0,160}canale di pagamento originale/i);
  assert.match(terms, /annullare[\s\S]{0,160}due ore[\s\S]{0,160}inizio della fascia[\s\S]{0,120}(consegna|ritiro)/i);
  assert.doesNotMatch(terms, /contratto si perfeziona e l'ordine viene registrato solo dopo la conferma del buon esito del pagamento/i);

  assert.match(privacy, /ordine[\s\S]{0,160}accettazione[\s\S]{0,120}Venditore/i);
  assert.doesNotMatch(privacy, /ordine si registra solo dopo la conferma del pagamento/i);
});

test("terms assign customer responsibility for delivery data and same-day pickup after failed delivery", () => {
  const terms = read("legal/condizioni-generali-vendita.v2026-06-26.md");

  assert.match(terms, /indirizzo[\s\S]{0,120}coordinate[\s\S]{0,160}corrett[\wàèéìòù]*/i);
  assert.match(terms, /dati[\s\S]{0,140}incompleti o inesatti[\s\S]{0,160}consegna non possa essere eseguita/i);
  assert.match(terms, /impossibile[\s\S]{0,120}contattare il Cliente/i);
  assert.match(terms, /prodotto[\s\S]{0,120}riportato presso la gelateria/i);
  assert.match(terms, /ritirato[\s\S]{0,160}orari di apertura[\s\S]{0,120}giorno di consegna/i);
});
