// ============================================================
// Footer NAP — override da DB (settings.home_content) su tutte le
// pagine pubbliche. La chiave "footer.nap" si edita nel back office
// (tab Homepage); qui viene applicata anche fuori dalla home.
// - pagine con i18n.js (ordina, grazie, consegna-a-domicilio):
//   merge nel dizionario + applyLang.
// - pagine senza i18n.js (informazioni): elementi [data-footer-nap="it|en"].
// anti-XSS: innerHTML ammette solo <br> <em> <strong> e <a href> con
// href sicuro (tel:, https://, http://, /percorso).
// ============================================================
(function () {
  var cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url) return;
  function sanitizeNap(v) {
    var e = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    e = e.replace(/&lt;(\/?)(br|em|strong)\s*\/?&gt;/gi, "<$1$2>");
    e = e.replace(/&lt;a href="((?:tel:|https?:\/\/|\/)[^"]*)"&gt;/gi, '<a href="$1">').replace(/&lt;\/a&gt;/gi, "</a>");
    return e;
  }
  fetch(cfg.url + "/rest/v1/settings?id=eq.1&select=home_content", {
    headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey }
  })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var hc = (rows && rows[0] && rows[0].home_content) || {};
      var it = hc.it && hc.it["footer.nap"];
      var en = hc.en && hc.en["footer.nap"];
      if (!it && !en) return;
      if (window.I18N) {
        if (it) I18N.merge("it", { "footer.nap": sanitizeNap(it) }, false);
        if (en) I18N.merge("en", { "footer.nap": sanitizeNap(en) }, false);
        I18N.applyLang();
      } else {
        document.querySelectorAll("[data-footer-nap]").forEach(function (el) {
          var v = el.getAttribute("data-footer-nap") === "en" ? (en || it) : (it || en);
          if (v) el.innerHTML = sanitizeNap(v);
        });
      }
    })
    .catch(function () {});
})();
