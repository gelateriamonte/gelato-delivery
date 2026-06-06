// Scheduled function: cancella le bozze ordine non pagate più vecchie di 24h.
// Gira 1×/giorno sul deploy di PRODUZIONE (le scheduled function non girano sui preview).
// Le bozze pagate vengono già cancellate dal webhook; queste sono carrelli abbandonati.

const { createClient } = require("@supabase/supabase-js");
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supa.from("pending_orders").delete().lt("created_at", cutoff).select("id");
  if (error) { console.error("cleanup-pending:", error.message); return { statusCode: 500, body: error.message }; }
  const n = (data || []).length;
  console.log("cleanup-pending: rimosse " + n + " bozze non pagate");
  return { statusCode: 200, body: "deleted " + n };
};
