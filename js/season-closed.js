// ============================================================
// Chiusura stagionale — settings.season_closed / settings.season_message.
// Incluso su tutte le pagine pubbliche. Se la chiusura è attiva:
//   - mostra il box di saluto #closed-box (se la pagina ce l'ha) col testo del DB;
//   - nasconde gli elementi marcati [data-closed-hide] (CTA, sezioni, app d'ordine);
//   - rende inerti i link a /ordina rimasti nei testi (footer NAP).
// Testo: settings.season_message = { it:{title,body}, en:{title,body} }, iniettato nel
// dizionario i18n (chiavi closed.title / closed.body); campo vuoto -> resta il default.
//
// ⚠️ Questo file è PRESENTAZIONE. Il blocco vero degli ordini sta nelle Netlify
// Functions (create-checkout.js, create-order-unpaid.js): rispondono 409 a chiusura
// attiva, perché chiunque può POSTare sulle function senza passare dal browser.
// ============================================================
(function () {
  var cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url) return;

  var MSG = null;

  // Il testo del DB entra nel DIZIONARIO, non nel DOM. Scriverlo con textContent non regge:
  // ogni I18N.applyLang() riscrive i nodi [data-i18n] col dizionario, e applyLang() lo chiamano
  // dopo di noi sia il merge di home_content (index.html) sia footer-nap.js. Passando da merge()
  // il testo giusto sopravvive a tutte le riapplicazioni e al cambio lingua, senza listener.
  // merge() ignora i valori vuoti: se manca l'EN resta il default inglese del dizionario.
  function mergeText() {
    if (!window.I18N) return;
    ["it", "en"].forEach(function (l) {
      var m = (MSG && MSG[l]) || {}, o = {};
      if (m.title) o["closed.title"] = m.title;
      if (m.body) o["closed.body"] = m.body;
      if (o["closed.title"] || o["closed.body"]) window.I18N.merge(l, o, false);
    });
    window.I18N.applyLang();
  }

  function showBox() {
    var box = document.getElementById("closed-box");
    if (!box) return;
    box.hidden = false;
    box.style.display = "block";
  }

  var ORDER_SEL = 'a[href="/ordina"], a[href="/ordina/"], a[href="ordina.html"]';

  // Due mosse, nessuna riscrittura del DOM: i link a /ordina ricompaiono da soli ogni volta che
  // i18n riapplica il footer NAP (merge di home_content, footer-nap.js, cambio lingua), quindi
  // sostituirli con uno <span> non regge. Invece:
  //   - la regola CSS li fa leggere come testo normale;
  //   - il listener in CATTURA annulla l'attivazione, click del mouse e Invio da tastiera
  //     (pointer-events:none ferma il mouse ma non la tastiera).
  function neutralizeOrderLinks() {
    var st = document.createElement("style");
    st.textContent = 'a[href="/ordina"],a[href="/ordina/"],a[href="ordina.html"]' +
      "{pointer-events:none;cursor:default;color:inherit;text-decoration:none;font-weight:inherit}";
    document.head.appendChild(st);
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest(ORDER_SEL);
      if (a) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  function apply() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-closed-hide]"), function (el) {
      el.style.display = "none";
    });
    mergeText();
    showBox();
    neutralizeOrderLinks();
  }

  fetch(cfg.url + "/rest/v1/settings?id=eq.1&select=season_closed,season_message", {
    headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey }
  })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var s = rows && rows[0];
      if (!s || !s.season_closed) return;
      MSG = s.season_message || {};
      apply();
    })
    .catch(function () { /* rete giù: la pagina resta normale, le function bloccano comunque */ });
})();
