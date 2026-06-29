// Verifica che la richiesta provenga dall'admin autenticato (Supabase Auth).
// Il back office fa signInWithPassword e ha un access_token (JWT). Le function
// sensibili (refund, send-order-email) richiedono header
//   Authorization: Bearer <access_token>
// validato server-side. Signup pubblico è DISABILITATO (vedi CLAUDE.md hardening):
// quindi "utente autenticato valido" ≡ admin.

// `supa` è un client Supabase (service role va bene: getUser valida il JWT passato).
async function requireAdmin(event, supa) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { ok: false, code: 401, error: "Autenticazione richiesta." };
  const token = m[1].trim();
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data || !data.user) return { ok: false, code: 401, error: "Sessione non valida." };
  // Difesa in profondità: non basta "autenticato", deve essere l'admin atteso.
  // Così la sicurezza non dipende solo dal signup disabilitato lato Supabase.
  // Override via env ADMIN_EMAIL se l'utente admin reale è diverso.
  const allow = (process.env.ADMIN_EMAIL || "admin@gelateriamontepetrosu.it").trim().toLowerCase();
  if (String(data.user.email || "").trim().toLowerCase() !== allow) {
    return { ok: false, code: 403, error: "Accesso non autorizzato." };
  }
  return { ok: true, user: data.user };
}

module.exports = { requireAdmin };
