// Finestra di annullamento self-service.
// Regola T&C Art. 8.6: il Cliente può annullare fino a `anticipo` ore prima
// dell'inizio della fascia scelta (default 2h) — la STESSA regola che order.js
// usa per nascondere le fasce. Tutto in wall-clock Europe/Rome (DST-safe):
// il contratto parla di orario locale ("due ore prima delle 18:00 = 16:00").

const TZ = "Europe/Rome";
const DEFAULT_ANTICIPO_H = 2;
const CANCELLABLE_STATUSES = new Set(["ricevuto", "accettato"]);

// Estrae i minuti-da-mezzanotte del PRIMO orario HH:MM nella label.
// Gestisce delivery "18:00 - 18:30" / "18:00 – 18:30" e pickup "Ritiro 18:30".
function slotStartMinutes(slotLabel) {
  const m = String(slotLabel || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Componenti wall-clock di `date` nel fuso Europe/Rome.
function romeParts(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year), mo: Number(p.month), d: Number(p.day),
    h: Number(p.hour === "24" ? "0" : p.hour), mi: Number(p.minute),
  };
}

// Valore confrontabile (sortable) per un wall-clock, indipendente dal fuso:
// trattiamo i componenti locali come se fossero UTC. Confronti tra due di
// questi valori = confronto wall-clock corretto. Date.UTC normalizza overflow
// (minuti negativi/oltre 60 → giorni), quindi anticipo che scavalca mezzanotte
// è gestito.
function wallValue(y, mo, d, h, mi) {
  return Date.UTC(y, mo - 1, d, h, mi);
}

// Istante-limite (wall-clock Rome) entro cui si può annullare, per un ordine.
function cancelCutoffWall(deliveryDate, slotLabel, anticipoH) {
  const dm = String(deliveryDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const startMin = slotStartMinutes(slotLabel);
  if (!dm || startMin == null) return null;
  const y = Number(dm[1]), mo = Number(dm[2]), d = Number(dm[3]);
  const anticipoMin = Math.round((anticipoH == null ? DEFAULT_ANTICIPO_H : anticipoH) * 60);
  return wallValue(y, mo, d, 0, startMin - anticipoMin);
}

// Decide se un ordine è annullabile ORA. Ritorna { ok, reason }.
// reason: 'ok' | 'status' | 'refunded' | 'window' | 'invalid'
function canCancel(order, now, anticipoH) {
  if (!order) return { ok: false, reason: "invalid" };
  if (order.refunded_at) return { ok: false, reason: "refunded" };
  if (!CANCELLABLE_STATUSES.has(order.status)) return { ok: false, reason: "status" };
  const cutoff = cancelCutoffWall(order.delivery_date, order.slot_label, anticipoH);
  if (cutoff == null) return { ok: false, reason: "invalid" };
  const n = romeParts(now || new Date());
  const nowWall = wallValue(n.y, n.mo, n.d, n.h, n.mi);
  // T&C Art. 8.6 "entro le 16:00" = il minuto di cutoff è ancora utile (inclusivo).
  if (nowWall > cutoff) return { ok: false, reason: "window" };
  return { ok: true, reason: "ok" };
}

module.exports = {
  TZ, DEFAULT_ANTICIPO_H, CANCELLABLE_STATUSES,
  slotStartMinutes, romeParts, wallValue, cancelCutoffWall, canCancel,
};
