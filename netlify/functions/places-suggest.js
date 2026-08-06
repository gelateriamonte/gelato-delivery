// Autocomplete indirizzi via Google Places (New) — prima scelta del client (decisione Vla
// 2026-08-06: suggerimenti e ricerca devono pescare dalla stessa fonte; OSM ha buchi sui civici).
// Stessa key/env del geocode, server-side. locationRestriction = bbox comune San Teodoro:
// restrizione dura, non bias. Risposta: array [{primary, secondary}], max 5 voci.
// Richiede "Places API (New)" abilitata sul progetto e ammessa nelle restrizioni della key.

exports.handler = async (event) => {
  const q = ((event.queryStringParameters && event.queryStringParameters.q) || "").trim();
  if (!q || q.length > 200) return { statusCode: 400, body: "bad query" };
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return { statusCode: 503, body: "not configured" };
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        input: q, languageCode: "it", includedRegionCodes: ["it"],
        locationRestriction: { rectangle: { low: { latitude: 40.6967, longitude: 9.5776 }, high: { latitude: 40.8649, longitude: 9.7287 } } },
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error("places-suggest:", r.status, (d.error && d.error.message) || "");
      return { statusCode: 502, body: "upstream error" };
    }
    const items = (d.suggestions || []).slice(0, 5).map((s) => {
      const p = s.placePrediction || {}, sf = p.structuredFormat || {};
      return {
        primary: (sf.mainText && sf.mainText.text) || (p.text && p.text.text) || "",
        secondary: (sf.secondaryText && sf.secondaryText.text) || "",
      };
    }).filter((i) => i.primary);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) };
  } catch (e) {
    console.error("places-suggest:", e && e.message ? e.message : e);
    return { statusCode: 502, body: "upstream error" };
  }
};
