// Fallback geocoding via Google: OSM/Nominatim ha buchi sui civici della zona San Teodoro
// (es. "Via Capo Spartivento" assente del tutto, verificato 2026-08-06). Il client prova prima
// Nominatim (gratis, senza key) e chiama questa function solo a vuoto → il consumo Google resta
// nell'ordine di decine di chiamate/mese, dentro il free tier (10k/mese).
// La key resta server-side (env GOOGLE_GEOCODING_API_KEY): mai esporla nel browser.
// Senza key configurata → 503, il client ripiega sul toast "trascina il pin".

exports.handler = async (event) => {
  const q = ((event.queryStringParameters && event.queryStringParameters.q) || "").trim();
  if (!q || q.length > 200) return { statusCode: 400, body: "bad query" };
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return { statusCode: 503, body: "geocoding not configured" };
  // bounds = stesso bbox della zona di consegna usato col viewbox Nominatim in js/order.js
  const url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + encodeURIComponent(q) +
    "&region=it&language=it&bounds=" + encodeURIComponent("40.6967,9.5776|40.8649,9.7287") + "&key=" + key;
  try {
    const d = await (await fetch(url)).json();
    if (d.status === "ZERO_RESULTS") return { statusCode: 404, body: "not found" };
    if (d.status !== "OK" || !d.results || !d.results.length) {
      // REQUEST_DENIED / OVER_QUERY_LIMIT ecc. arrivano come HTTP 200 con lo status nel body:
      // sono errori di configurazione/quota, non "indirizzo non trovato" — vanno nei log.
      console.error("geocode:", d.status, d.error_message || "");
      return { statusCode: 502, body: "upstream error" };
    }
    // Google per una via inesistente non dà ZERO_RESULTS: risponde OK col centroide del paese
    // (types ['locality'], location_type APPROXIMATE). Un pin silenziosamente sbagliato ma "in zona"
    // è peggio del toast "trascina il pin": si accettano solo match a livello strada/edificio.
    // partial_match NON è un filtro affidabile: è true anche su civici interpolati validi.
    const r = d.results[0];
    const okType = (r.types || []).some((t) => ["street_address", "premise", "subpremise", "route"].includes(t));
    const okLoc = ["ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"].includes(r.geometry && r.geometry.location_type);
    if (!okType || !okLoc) return { statusCode: 404, body: "not found" };
    // il bounds di Google è solo bias, non filtro: un risultato fuori Gallura è una query estranea
    // al sito (endpoint pubblico → niente geocoder mondiale gratis a spese della quota).
    const { lat, lng } = r.geometry.location;
    if (lat < 40.55 || lat > 41.05 || lng < 9.35 || lng > 9.95) return { statusCode: 404, body: "not found" };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, formatted: r.formatted_address }),
    };
  } catch (e) {
    console.error("geocode:", e && e.message ? e.message : e);
    return { statusCode: 502, body: "upstream error" };
  }
};
