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
  url:     "https://hsnikgbwsggusqlanwmt.supabase.co",
  anonKey: "sb_publishable_efCBXPaGPk4JsmUWkvASkg_9GHaHuB3"
};

window.ADMIN_PASSWORD = "gelato2026";

// Stripe — chiave PUBBLICABILE (pk_test_… in test, pk_live_… in produzione).
// È pubblica per design (sta nel browser). La chiave segreta sta SOLO nelle env di Netlify.
window.STRIPE_PUBLISHABLE_KEY = "pk_test_51TfKmZDURGKjK0gjwpU60Dogc2KtSTRsYIhKJakNVidDiO95yfEkwH55BMFpw4dKlnDOQXAJMKyExvavmrUg04Nq00keeeocdp";
