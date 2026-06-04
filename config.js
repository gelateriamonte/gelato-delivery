// ============================================================
// Configurazione — compila con i valori del TUO progetto Supabase
// (Supabase Dashboard → Project Settings → API).
//
// - url + anonKey sono PUBBLICI per design: la sicurezza passa da RLS.
//   NON mettere mai qui la service_role key.
// - ADMIN_PASSWORD è una protezione DEBOLE lato client (solo prototipo).
//   Chiunque legga questo file la vede. Auth vera = fase successiva.
// ============================================================
window.SUPABASE_CONFIG = {
  url:     "https://YOUR-PROJECT-REF.supabase.co",
  anonKey: "YOUR-ANON-KEY"
};

window.ADMIN_PASSWORD = "gelato2026";
