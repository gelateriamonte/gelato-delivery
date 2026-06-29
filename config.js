// ============================================================
// Configurazione — compila con i valori del TUO progetto Supabase
// (Supabase Dashboard → Project Settings → API).
//
// - url + anonKey sono PUBBLICI per design: la sicurezza passa da RLS.
//   NON mettere mai qui la service_role key.
// ============================================================
window.SUPABASE_CONFIG = {
  url:     "https://rlrsyqmwtjfyuqkgzqso.supabase.co",
  anonKey: "sb_publishable_FeopkZa7V-fLzx5fQerykQ_NVN_qVC3"
};

// Stripe — chiave PUBBLICABILE (pk_test_… in test, pk_live_… in produzione).
// È pubblica per design (sta nel browser). La chiave segreta sta SOLO nelle env di Netlify.
window.STRIPE_PUBLISHABLE_KEY = "pk_live_51Tma9pCg2YSipUVe92ymNtMP1q5g1UGF0uq6p90c7lUdEZDFrRH40AITkR2nn6ETCDMxl9oIkyqENyjt4DFhplXY00GLzuheV5";
