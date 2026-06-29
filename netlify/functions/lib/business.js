// Dati identità/URL del Venditore, usati nelle email (footer, link).
// Sorgente unica: override via env Netlify quando disponibili, altrimenti
// placeholder [[...]] (gli stessi token dei documenti legali). Riempire le env
// quando arrivano i dati reali — non serve toccare il codice.
//   BIZ_RAGIONE_SOCIALE · BIZ_PIVA · BIZ_SEDE · BIZ_WHATSAPP
//   PUBLIC_BASE_URL (default dominio prod)

const BASE = (process.env.PUBLIC_BASE_URL || "https://www.gelateriamontepetrosu.it").replace(/\/$/, "");

const business = {
  base: BASE,
  logoUrl: BASE + "/img/logo-full.png",
  // WIP: puntano ai .md versionati realmente serviti (raw markdown). Nel pass legale
  // diventeranno pagine HTML a URL stabile (es. /legal/privacy-policy.html).
  tcUrl: BASE + "/legal/condizioni-generali-vendita.v2026-06-26.md",
  privacyUrl: BASE + "/legal/privacy-policy.v2026-06-26.md",
  whatsappUrl: process.env.BIZ_WHATSAPP || "https://wa.me/[[TELEFONO]]",
  ragioneSociale: process.env.BIZ_RAGIONE_SOCIALE || "[[RAGIONE_SOCIALE]]",
  piva: process.env.BIZ_PIVA || "[[PIVA]]",
  sede: process.env.BIZ_SEDE || "[[SEDE_LEGALE]]",
};

// Link al flusso di annullamento per un ordine (token segreto per-ordine).
function cancelUrl(order) {
  return order && order.cancel_token
    ? `${BASE}/.netlify/functions/cancel-order?token=${encodeURIComponent(order.cancel_token)}`
    : "";
}

module.exports = { business, cancelUrl };
