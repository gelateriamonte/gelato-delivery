// ============================================================
// Chiusura stagionale — settings.season_closed / settings.season_message.
// Incluso su tutte le pagine pubbliche. Se la chiusura è attiva:
//   - riempie e mostra il box di saluto #closed-box (se la pagina ce l'ha);
//   - nasconde gli elementi marcati [data-closed-hide] (CTA, sezioni, app d'ordine);
//   - trasforma in testo semplice i link a /ordina rimasti nei testi (footer NAP).
// Testo: settings.season_message = { it:{title,body}, en:{title,body} }; campo vuoto
// -> default dal dizionario (js/i18n.js, chiavi closed.title / closed.body).
//
// ⚠️ Questo file è PRESENTAZIONE. Il blocco vero degli ordini sta nelle Netlify
// Functions (create-checkout.js, create-order-unpaid.js): rispondono 409 a chiusura
// attiva, perché chiunque può POSTare sulle function senza passare dal browser.
// ============================================================
(function () {
  var cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url) return;

  var MSG = null;

  function lang() { return (window.I18N && window.I18N.lang() === "en") ? "en" : "it"; }
  // testo dal DB per la lingua corrente; fallback all'altra lingua, poi al dizionario
  function field(name) {
    var m = MSG || {};
    var cur = (m[lang()] || {})[name];
    if (cur && String(cur).trim()) return String(cur);
    var alt = (m[lang() === "en" ? "it" : "en"] || {})[name];
    if (alt && String(alt).trim()) return String(alt);
    return window.I18N ? window.I18N.t("closed." + name) : "";
  }

  function fillBox() {
    var box = document.getElementById("closed-box");
    if (!box) return;
    var t = box.querySelector("[data-closed-title]");
    var b = box.querySelector("[data-closed-body]");
    if (t) t.textContent = field("title");
    if (b) b.textContent = field("body");
    box.hidden = false;
    box.style.display = "block";
  }

  // i link testuali a /ordina diventano <span>: nessuna strada verso l'ordine.
  // Da rieseguire a ogni cambio lingua — i18n riscrive l'innerHTML del footer NAP.
  function killOrderLinks() {
    // :not([data-closed-hide]) — quelli li nasconde apply(); sostituirli con uno <span>
    // senza display:none li farebbe ricomparire come testo.
    var links = document.querySelectorAll(
      'a[href="/ordina"]:not([data-closed-hide]),' +
      'a[href="/ordina/"]:not([data-closed-hide]),' +
      'a[href="ordina.html"]:not([data-closed-hide])'
    );
    Array.prototype.forEach.call(links, function (a) {
      var span = document.createElement("span");
      span.textContent = a.textContent;
      a.parentNode.replaceChild(span, a);
    });
  }

  // Rete di sicurezza CSS: un link a /ordina aggiunto DOPO (footer NAP riscritto da footer-nap.js
  // o da i18n) non sarebbe piu' passato da killOrderLinks. La regola vale per sempre.
  function neutralizeStyle() {
    var st = document.createElement("style");
    st.textContent = 'a[href="/ordina"],a[href="/ordina/"],a[href="ordina.html"]' +
      "{pointer-events:none;cursor:default;color:inherit;text-decoration:none;font-weight:inherit}";
    document.head.appendChild(st);
  }

  function apply() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-closed-hide]"), function (el) {
      el.style.display = "none";
    });
    fillBox();
    neutralizeStyle();
    killOrderLinks();
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
      if (window.I18N) window.I18N.onLangChange(function () { fillBox(); killOrderLinks(); });
    })
    .catch(function () { /* rete giù: la pagina resta normale, le function bloccano comunque */ });
})();
