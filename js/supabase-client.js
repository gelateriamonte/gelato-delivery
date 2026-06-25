// Inizializza il client Supabase condiviso da mobile app e back office.
// Richiede che config.js e la libreria supabase-js (CDN) siano caricati prima.
(function () {
  if (!window.SUPABASE_CONFIG || window.SUPABASE_CONFIG.url.includes("YOUR-PROJECT")) {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML =
        '<div style="font-family:system-ui;padding:24px;max-width:520px;margin:40px auto;' +
        'background:#fff3cd;border:1px solid #ffe69c;border-radius:12px;color:#664d03">' +
        '<h2>⚙️ Configurazione mancante</h2>' +
        '<p>Apri <code>config.js</code> e inserisci <b>url</b> e <b>anonKey</b> del tuo progetto Supabase.</p></div>';
    });
    throw new Error("Supabase non configurato: compila config.js");
  }
  // supabase-js espone il global `supabase` con createClient
  window.sb = supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.anonKey,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );
})();
