// Endpoint Epson Server Direct Print: la stampante TM-m30III polla QUESTO URL a intervalli.
//   ConnectionType=GetRequest  -> serve il job di stampa piu' vecchio (ePOS-Print XML).
//   ConnectionType=SetResponse -> registra l'esito della stampa (done / retry / error).
// Auth fail-closed: il campo form `ID` deve combaciare con env EPSON_SDP_ID.
// Risponde SEMPRE 200 alla stampante (un non-200 la fa ri-POSTare all'infinito).

const { createClient } = require("@supabase/supabase-js");
const { buildReceiptXml, buildProductionXml } = require("./lib/receipt");
const { sendTelegram } = require("./lib/telegram");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };
const xml = (body) => ({ statusCode: 200, headers: XML_HEADERS, body: body || "" });

// involucro Server Direct Print attorno allo scontrino ePOS-Print
function wrapPrintRequest(printjobid, receiptXml) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<PrintRequestInfo Version="2.00"><ePOSPrint>' +
    "<Parameter><devid>local_printer</devid><timeout>10000</timeout>" +
    (printjobid ? "<printjobid>" + printjobid + "</printjobid>" : "") +
    "</Parameter><PrintData>" + receiptXml + "</PrintData></ePOSPrint></PrintRequestInfo>";
}

exports.handler = async (event) => {
  // --- auth fail-closed ---
  const secret = process.env.EPSON_SDP_ID;
  if (!secret || secret.length < 16) { console.error("epson-sdp: EPSON_SDP_ID mancante/debole"); return xml(""); }

  const body = event && event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : ((event && event.body) || "");
  const form = new URLSearchParams(body);   // URLSearchParams decodifica gia' i campi
  if (form.get("ID") !== secret) return xml("");

  const type = form.get("ConnectionType");

  if (type === "GetRequest") {
    const { data, error } = await supa.rpc("claim_print_job");
    if (error) { console.error("epson-sdp claim:", error.message); return xml(""); }
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return xml("");   // niente in coda

    if (job.kind === "production") {
      try {
        return xml(wrapPrintRequest(job.printjobid, buildProductionXml(job.payload, job.created_at)));
      } catch (e) {
        console.error("epson-sdp build prod:", e && e.message);
        await failJob(job, "build_error");
        return xml("");
      }
    }

    const { data: order, error: oErr } = await supa.from("orders").select("*").eq("id", job.order_id).single();
    if (oErr || !order) { await failJob(job, "order_not_found"); return xml(""); }

    try {
      return xml(wrapPrintRequest(job.printjobid, buildReceiptXml(order)));
    } catch (e) {
      console.error("epson-sdp build:", e && e.message);
      await failJob(job, "build_error");
      return xml("");
    }
  }

  if (type === "SetResponse") {
    try { await handleResult(form.get("ResponseFile") || ""); }
    catch (e) { console.error("epson-sdp result:", e && e.message); }
    return xml("");
  }

  return xml("");
};

// trova l'unico job in 'printing' (invariante della RPC), cross-check con printjobid se presente
async function handleResult(responseXml) {
  const okM = responseXml.match(/<response\b[^>]*\bsuccess="([^"]*)"/i);
  const codeM = responseXml.match(/<response\b[^>]*\bcode="([^"]*)"/i);
  const pjM = responseXml.match(/<printjobid>\s*([^<\s]+)\s*<\/printjobid>/i);
  const success = okM ? /^(1|true)$/i.test(okM[1]) : false;   // success assente => failure
  const code = codeM ? codeM[1] : "?";
  const pj = pjM ? pjM[1] : null;

  let q = supa.from("print_jobs").select("*").eq("status", "printing");
  if (pj) q = q.eq("printjobid", pj);
  const { data: rows } = await q.order("claimed_at", { ascending: true }).limit(1);
  const job = rows && rows[0];
  if (!job) return;   // SetResponse duplicato/tardivo: no-op

  if (success) {
    await supa.from("print_jobs").update({ status: "done", printed_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }
  const attempts = (job.attempts || 0) + 1;
  if (attempts < 3) {
    await supa.from("print_jobs").update({ status: "pending", attempts, last_error: code }).eq("id", job.id);
  } else {
    await markErrorAndAlert(job.id, job.order_id, attempts, code);
  }
}

async function failJob(job, code) {
  await markErrorAndAlert(job.id, job.order_id, (job.attempts || 0) + 1, code);
}

// porta a 'error' con guardia di transizione (neq error) -> alert Telegram una sola volta
async function markErrorAndAlert(id, orderId, attempts, code) {
  const { data } = await supa.from("print_jobs")
    .update({ status: "error", attempts, last_error: code })
    .eq("id", id).neq("status", "error").select("id");
  if (data && data.length) {
    const ref = orderId
      ? "ordine #" + String(orderId).replace(/-/g, "").slice(0, 8).toUpperCase()
      : "PRODUZIONE";
    try { await sendTelegram("⚠️ Stampa fallita " + ref + " — " + code); }
    catch (e) { console.error("epson-sdp alert:", e && e.message); }
  }
}
