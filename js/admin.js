// ============ Back office — gestione parametri + ordini live ============
const $ = (id) => document.getElementById(id);
const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");
const kg = (v) => Number(v || 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",") + " kg";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slotMin = (l) => { const m = String(l).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; };  // minuti inizio fascia → ordine orario

const STATUS_META = {
  "ricevuto":        { label: "Ricevuto",        slug: "ricevuto" },
  "accettato":       { label: "Accettato",       slug: "accettato" },
  "in preparazione": { label: "In preparazione", slug: "in-preparazione" },
  "in consegna":     { label: "In consegna",     slug: "in-consegna" },
  "consegnato":      { label: "Consegnato",      slug: "consegnato" },
  "rifiutato":       { label: "Rifiutato",       slug: "rifiutato" },
  "annullato":       { label: "Annullato",       slug: "annullato" },
};
const PROGRESS = ["in preparazione", "in consegna", "consegnato"];
const TERMINAL = new Set(["consegnato", "rifiutato", "annullato"]);
const FILTERS = ["all", "ricevuto", "accettato", "in preparazione", "in consegna", "rifiutato", "annullato"]; // no "consegnato": consegnati → Storico
const COUNTED = new Set(["ricevuto", "accettato", "in preparazione", "in consegna"]); // per contatore giorni (no consegnati/rifiutati/annullati)
let ORDERS = [];
let ACTIVE_FILTER = "all";
let ACTIVE_DAY = "all";
let ACTIVE_SLOT = "all";          // filtro fascia (slot_label) o "all"
let HIDE_CANCELLED = true;        // nascondi rifiutati/annullati dalla vista "Tutti"
const GELATERIA = { lat: 40.8410901, lng: 9.6538693 };  // partenza consegne
const ROUTE_CACHE = {};                                 // "lat,lng" -> {km,min} percorso auto (OSRM)
let SETTINGS = {};                                      // riga settings (incl. wa_templates, delivery_area)
let areaMap = null, areaLayer = null;                   // mappa disegno zona consegna (Parametri)
// ---------- messaggi WhatsApp (default; override modificabili in Parametri) ----------
const WA_STATUSES = ["accettato", "in preparazione", "in consegna", "consegnato", "rifiutato", "annullato"];
const WA_DEFAULTS = {
  "accettato": "Ciao {nome}! 🍦 Il tuo ordine da La Gelateria è confermato. Consegna {giorno}, fascia {fascia}. Grazie!",
  "in preparazione": "Ciao {nome}, stiamo preparando il tuo gelato! Consegna {giorno}, {fascia}.",
  "in consegna": "Ciao {nome}, il tuo gelato è in consegna 🛵 Arriviamo a: {indirizzo}.",
  "consegnato": "Consegnato! Grazie {nome} e buon gelato 🍦 A presto!",
  "rifiutato": "Ciao {nome}, purtroppo non possiamo evadere il tuo ordine. Ci scusiamo per il disagio.",
  "annullato": "Ciao {nome}, il tuo ordine è stato annullato. Per qualsiasi info scrivici pure.",
};
const waTemplates = () => Object.assign({}, WA_DEFAULTS, SETTINGS.wa_templates || {});
function normPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (!d.startsWith("39")) d = "39" + d;   // default Italia
  return d;
}
function waMessage(o, status) {
  const giorno = o.delivery_date ? new Date(o.delivery_date + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" }) : "-";
  return (waTemplates()[status] || "")
    .replace(/{nome}/g, o.customer_name || "")
    .replace(/{giorno}/g, giorno)
    .replace(/{fascia}/g, o.slot_label || "")
    .replace(/{indirizzo}/g, o.address || "")
    .replace(/{totale}/g, euro(o.total));
}
// ---- toggle provvisorio apertura WhatsApp web (fase test) — stato per-device in localStorage ----
const WA_KEY = "gelato_wa_web";
const waWebEnabled = () => localStorage.getItem(WA_KEY) !== "0";   // default ON
function setWaWeb(on) { localStorage.setItem(WA_KEY, on ? "1" : "0"); updateWaToggleBtn(); }
function updateWaToggleBtn() {
  const b = $("wa-toggle"); if (!b) return;
  const on = waWebEnabled();
  b.textContent = "WhatsApp web: " + (on ? "ON" : "OFF");
  b.style.background = on ? "#25D366" : "#b00020";
  b.style.color = "#fff"; b.style.borderColor = "transparent";
}

function waOpen(o, status) {
  if (!waWebEnabled()) { toast("WhatsApp web disattivato (test)."); return; }
  if (!o.customer_phone) { toast("Numero cliente mancante."); return; }
  window.open("https://wa.me/" + normPhone(o.customer_phone) + "?text=" + encodeURIComponent(waMessage(o, status)), "_blank");
}
// cambia stato + apre WhatsApp col messaggio di quello stato (window.open sincrono nel gesto)
function changeStatus(o, status) { waOpen(o, status); updateStatus(o.id, status); }

// ---------- date / calendario (prossimi 7 giorni, oggi incluso) ----------
const WD = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function next7() {
  const out = [], t = new Date(); t.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) { const d = new Date(t); d.setDate(t.getDate() + i); out.push(d); }
  return out;
}
const dayName = (d, i) => (i === 0 ? "Oggi" : i === 1 ? "Domani" : WD[d.getDay()]);

// stato tab Fasce
let SLOT_DAYS = next7();
let SELECTED_DAY = ymd(SLOT_DAYS[0]);
let SLOTS_CATALOG = [];
let DAY_OVERRIDES = new Map();   // slot_id -> active (override del giorno selezionato)

// radio Disponibile / Non disponibile (gusti, formati)
// Toggle switch on/off (un solo controllo). `name` tenuto per compatibilità chiamate.
function availRadios(name, available, onText, offText) {
  onText = onText || "Disponibile"; offText = offText || "Non disponibile";
  return `<label class="switch" data-onoff>` +
    `<input type="checkbox"${available ? " checked" : ""}>` +
    `<span class="track"><span class="thumb"></span></span>` +
    `<span class="switch-lbl"><span class="on-t">${esc(onText)}</span><span class="off-t">${esc(offText)}</span></span>` +
    `</label>`;
}
function wireAvailRadios(el, cb) {
  const sw = el.querySelector('[data-onoff] input[type=checkbox]');
  if (sw) sw.onchange = () => cb(sw.checked);
}

// ---------- LOGIN GATE ----------
function tryLogin() {
  const ok = $("pw").value === window.ADMIN_PASSWORD;
  if (!ok) { toast("Password errata."); return; }
  sessionStorage.setItem("gelato_admin", "1");
  unlockAudio(); ensureNotifyPermission();   // gesto utente: sblocca audio + chiede permesso notifiche
  enterApp();
}
function enterApp() {
  $("gate-wrap").classList.add("hidden");
  $("app").classList.remove("hidden");
  initApp();
}
$("pw-go").onclick = tryLogin;
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
if (sessionStorage.getItem("gelato_admin") === "1") enterApp();

// ---------- TABS ----------
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach((p) => p.classList.add("hidden"));
    t.classList.add("active");
    $("tab-" + t.dataset.tab).classList.remove("hidden");
    if (t.dataset.tab === "settings") setupAreaMap();
    if (t.dataset.tab === "consegne") { if (CONSEGNE_DIRTY) drawConsegne(); else setTimeout(invalidateConsegneMaps, 80); }
  };
});

// refresh manuale ordini
$("orders-refresh").onclick = async () => { await loadOrders(); toast("Ordini aggiornati."); };
$("orders-togglex").onclick = () => { HIDE_CANCELLED = !HIDE_CANCELLED; renderOrders(); };
// toggle provvisorio WhatsApp web (test)
$("wa-toggle").onclick = () => setWaWeb(!waWebEnabled());
updateWaToggleBtn();

// ---------- INIT ----------
async function initApp() {
  await Promise.all([loadOrders(), loadFlavors(), loadFormats(), loadSlots(), loadSettings(), purgeOldSlotState()]);
  renderOrders();   // re-render con SLOTS_CATALOG caricato (statistiche fasce del giorno)
  subscribeOrders();
}

// ========== ORDINI ==========
async function loadOrders() {
  const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); toast("Errore caricamento ordini."); return; }
  ORDERS = data;
  renderOrders();
}

function renderFilters() {
  const bar = $("orders-filter");
  bar.innerHTML = "";
  const DEL = ORDERS.filter((o) => o.fulfillment !== "pickup" && o.status !== "consegnato");
  const counts = {};
  DEL.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  FILTERS.forEach((f) => {
    const n = f === "all" ? DEL.length : (counts[f] || 0);
    const label = f === "all" ? "Tutti" : STATUS_META[f].label;
    const slug = f === "all" ? "all" : STATUS_META[f].slug;
    const chip = mkBtn("", "fchip f-" + slug + (f === ACTIVE_FILTER ? " sel" : ""),
      () => { ACTIVE_FILTER = f; renderOrders(); });
    chip.innerHTML = `${esc(label)} <span class="fcount">${n}</span>`;
    bar.appendChild(chip);
  });
}

function renderDays() {
  const bar = $("orders-days");
  bar.innerHTML = "";
  const counts = {};
  ORDERS.forEach((o) => {
    if (o.delivery_date && COUNTED.has(o.status) && o.fulfillment !== "pickup") counts[o.delivery_date] = (counts[o.delivery_date] || 0) + 1;
  });
  // chip "Tutti"
  const all = mkBtn("", "dchip" + (ACTIVE_DAY === "all" ? " sel" : ""), () => { ACTIVE_DAY = "all"; ACTIVE_SLOT = "all"; renderOrders(); });
  all.innerHTML = `<div class="dwd">Tutti</div><div class="dnum">·</div><div class="dcount" style="visibility:hidden">0</div>`;
  bar.appendChild(all);
  // 7 giorni: oggi + 6
  next7().forEach((d, i) => {
    const key = ymd(d);
    const n = counts[key] || 0;
    const b = mkBtn("", "dchip day" + (key === ACTIVE_DAY ? " sel" : "") + (i === 0 ? " today" : ""),
      () => { ACTIVE_DAY = (ACTIVE_DAY === key ? "all" : key); ACTIVE_SLOT = "all"; renderOrders(); });
    b.innerHTML = `<div class="dwd">${dayName(d, i)}</div><div class="dnum">${d.getDate()}</div>` +
      `<div class="dcount${n ? " has" : ""}">${n}</div>`;
    bar.appendChild(b);
  });
}

// ---------- fasce del giorno: ordini attivi (in lavorazione) per fascia ----------
function slotStatCard(label, n, max) {
  const hasMax = max != null && Number(max) > 0;
  const m = Number(max);
  const full = hasMax && n >= m;
  const pct = hasMax ? (n === 0 ? 0 : Math.max(6, Math.min(100, (n / m) * 100))) : 0;
  const bar = hasMax
    ? `<div class="thermo"><div class="thermo-fill${full ? " full" : ""}" style="width:${pct}%"></div></div>`
    : "";
  const legend = hasMax
    ? `<span class="thermo-legend${full ? " full" : ""}"><b>${n}</b> in lavorazione / ${m}${full ? " · piena" : ""}</span>`
    : `<span class="thermo-legend"><b>${n}</b> in lavorazione · nessun limite</span>`;
  const sel = ACTIVE_SLOT === label ? " sel" : "";
  return `<div class="slotstat${full ? " full" : ""}${sel}" data-slot="${esc(label)}" role="button" tabindex="0" title="Mostra solo gli ordini di questa fascia"><div class="slotstat-time">${esc(label)}</div>${bar}${legend}</div>`;
}

function renderSlotStats() {
  const wrap = $("orders-slots");
  if (!wrap) return;
  const days = next7();
  const day = (ACTIVE_DAY === "all") ? ymd(days[0]) : ACTIVE_DAY;
  // conteggio ordini attivi (non terminali) per fascia, nel giorno scelto
  const counts = {};
  ORDERS.forEach((o) => {
    if (o.delivery_date === day && !TERMINAL.has(o.status) && o.slot_label && o.fulfillment !== "pickup") {
      counts[o.slot_label] = (counts[o.slot_label] || 0) + 1;
    }
  });
  const cat = (SLOTS_CATALOG || []).slice().sort((a, b) => slotMin(a.label) - slotMin(b.label));
  if (!cat.length && !Object.keys(counts).length) { wrap.innerHTML = ""; return; }
  // fasce del catalogo + eventuali label storiche presenti negli ordini ma non più in catalogo
  const known = new Set(cat.map((s) => s.label));
  const extras = Object.keys(counts).filter((l) => !known.has(l)).sort();
  let cards = cat.map((s) => slotStatCard(s.label, counts[s.label] || 0, s.max_deliveries)).join("");
  cards += extras.map((l) => slotStatCard(l, counts[l], null)).join("");
  const idx = days.findIndex((d) => ymd(d) === day);
  const dlabel = idx >= 0 ? `${dayName(days[idx], idx)} ${days[idx].getDate()}/${days[idx].getMonth() + 1}` : day;
  const tot = Object.values(counts).reduce((a, b) => a + b, 0);
  wrap.innerHTML =
    `<div class="slotstats-head"><span class="eyebrow muted" style="margin:0">Fasce · ${esc(dlabel)}</span>` +
    `<span class="slotstats-tot">${tot} attiv${tot === 1 ? "o" : "i"}</span></div>` +
    `<div class="slotstats">${cards}</div>`;
  // click su una fascia → filtra gli ordini per quella fascia (ri-click = mostra tutte)
  wrap.querySelectorAll(".slotstat[data-slot]").forEach((el) => {
    const s = el.dataset.slot;
    const pick = () => { ACTIVE_SLOT = (ACTIVE_SLOT === s ? "all" : s); renderOrders(); };
    el.onclick = pick;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
  });
}

function renderOrders() {
  const DEL = ORDERS.filter((o) => o.fulfillment !== "pickup" && o.status !== "consegnato");   // Ordini = consegne non ancora evase (consegnati → Storico; ritiri → Take away)
  $("orders-count").textContent = DEL.length;
  renderFilters();
  renderDays();
  renderSlotStats();
  renderLab();
  renderHistory();
  renderConsegne();
  renderTakeaway();
  const hx = $("orders-togglex");
  if (hx) { hx.textContent = HIDE_CANCELLED ? "Mostra rifiutati/annullati" : "Nascondi rifiutati/annullati"; hx.classList.toggle("on", HIDE_CANCELLED); }
  const list = $("orders-list");
  let shown = DEL;
  if (ACTIVE_FILTER !== "all") shown = shown.filter((o) => o.status === ACTIVE_FILTER);
  if (ACTIVE_DAY !== "all") shown = shown.filter((o) => o.delivery_date === ACTIVE_DAY);
  if (ACTIVE_SLOT !== "all") shown = shown.filter((o) => o.slot_label === ACTIVE_SLOT);
  // nascondi rifiutati/annullati dalla vista "Tutti" (i filtri di stato espliciti li mostrano comunque)
  if (HIDE_CANCELLED && ACTIVE_FILTER === "all") shown = shown.filter((o) => o.status !== "rifiutato" && o.status !== "annullato");
  const noFilter = ACTIVE_FILTER === "all" && ACTIVE_DAY === "all" && ACTIVE_SLOT === "all";
  if (!shown.length) {
    list.innerHTML = '<p class="muted small">Nessun ordine' + (noFilter && !HIDE_CANCELLED ? "" : " con questi filtri") + '.</p>';
    return;
  }
  list.innerHTML = "";
  shown.forEach((o) => list.appendChild(orderCard(o)));
  hydrateRoutes();
}

// ========== LABORATORIO (solo ordini accettati, kg per gusto per giorno) ==========
// peso in grammi ricavato dal nome formato (es. "500g", "1kg", "1,5 kg"); 0 se assente (coppette)
function formatGrams(name) {
  const m = String(name).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(",", "."));
  return m[2] === "kg" ? v * 1000 : v;
}

function renderLab() {
  const wrap = $("lab-list");
  if (!wrap) return;
  const byDay = {};   // delivery_date -> { count, flavors: {nome: grammi} }
  ORDERS.forEach((o) => {
    if (o.status !== "accettato" || !o.delivery_date) return;
    const d = byDay[o.delivery_date] || (byDay[o.delivery_date] = { count: 0, flavors: {} });
    d.count++;
    (o.items || []).forEach((it) => {
      const g = formatGrams(it.format), gusti = it.gusti || [];
      if (!g || !gusti.length) return;                 // coppette / senza gusti: niente kg
      const per = (g * (it.qty || 1)) / gusti.length;  // peso diviso per n. gusti
      gusti.forEach((n) => { d.flavors[n] = (d.flavors[n] || 0) + per; });
    });
  });

  wrap.innerHTML = "";
  let any = false;
  next7().forEach((dt, i) => {
    const info = byDay[ymd(dt)];
    if (!info) return;   // mostra solo giorni con ordini accettati
    any = true;
    const flavs = Object.entries(info.flavors).sort((a, b) => b[1] - a[1]);
    const totKg = flavs.reduce((s, [, g]) => s + g, 0) / 1000;
    const rows = flavs.length
      ? flavs.map(([n, g]) => `<div class="kgline"><span class="kn">${esc(n)}</span><span class="kv">${kg(g / 1000)}</span></div>`).join("")
      : '<p class="hint">Solo coppette: nessun kg da preparare.</p>';
    const card = document.createElement("div");
    card.className = "labcard";
    card.innerHTML =
      `<div class="labhead"><span class="labday">${esc(dayName(dt, i))} ${dt.getDate()}/${dt.getMonth() + 1}</span>` +
      `<span class="count">${info.count} ordin${info.count === 1 ? "e" : "i"}</span></div>` +
      `<div class="kglist">${rows}</div>` +
      (flavs.length ? `<div class="kgtot"><span>Totale gelato</span><b>${kg(totKg)}</b></div>` : "");
    wrap.appendChild(card);
  });
  if (!any) wrap.innerHTML = '<p class="hint">Nessun ordine accettato da preparare.</p>';
}

// ========== STORICO (ordini consegnati: economico + breakdown formato/gusto) ==========
function renderHistory() {
  const wrap = $("history-list");
  if (!wrap) return;
  const done = ORDERS.filter((o) => o.status === "consegnato");
  wrap.innerHTML = "";
  if (!done.length) { wrap.innerHTML = '<p class="muted small">Nessun ordine consegnato.</p>'; return; }

  let fatturato = 0, prodotti = 0, consegne = 0;
  const byFormat = {};   // nome -> { qty, rev }
  const byFlavor = {};   // nome -> { qty, grams }
  done.forEach((o) => {
    fatturato += Number(o.total || 0);
    prodotti  += Number(o.subtotal || 0);
    consegne  += Number(o.delivery_cost || 0);
    (o.items || []).forEach((it) => {
      const q = it.qty || 1;
      const f = byFormat[it.format] || (byFormat[it.format] = { qty: 0, rev: 0 });
      f.qty += q; f.rev += Number(it.prezzo_unit || 0) * q;
      const g = formatGrams(it.format), gusti = it.gusti || [];
      gusti.forEach((n) => {
        const fl = byFlavor[n] || (byFlavor[n] = { qty: 0, grams: 0 });
        fl.qty += q;
        if (g && gusti.length) fl.grams += (g * q) / gusti.length;
      });
    });
  });
  const media = fatturato / done.length;

  // riepilogo economico
  const eco =
    `<div class="panel ecocard">` +
    `<div class="eco-row big"><span>Fatturato totale</span><b>${euro(fatturato)}</b></div>` +
    `<div class="eco-row"><span>di cui prodotti</span><span>${euro(prodotti)}</span></div>` +
    `<div class="eco-row"><span>di cui consegne</span><span>${euro(consegne)}</span></div>` +
    `<div class="eco-row sep"><span>Scontrino medio</span><b>${euro(media)}</b></div>` +
    `<div class="eco-row"><span>Ordini consegnati</span><span>${done.length}</span></div>` +
    `</div>`;

  // breakdown per formato
  const fmts = Object.entries(byFormat).sort((a, b) => b[1].rev - a[1].rev)
    .map(([n, v]) => `<div class="brk"><div class="bn">${esc(n)}<small>${v.qty} pz</small></div><div class="bv">${euro(v.rev)}</div></div>`).join("");

  // breakdown per gusto
  const flv = Object.entries(byFlavor).sort((a, b) => b[1].qty - a[1].qty)
    .map(([n, v]) => `<div class="brk"><div class="bn">${esc(n)}<small>${v.qty} volte</small></div><div class="bv">${v.grams ? kg(v.grams / 1000) : "—"}</div></div>`).join("");

  // lista ordini consegnati (recenti prima)
  const orders = done.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((o) => {
    const when = new Date(o.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const cons = o.delivery_date ? new Date(o.delivery_date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : "-";
    return `<div class="brk hxrow" data-oid="${esc(o.id)}" role="button" tabindex="0" title="Vedi dettaglio completo" style="cursor:pointer"><div class="bn">${esc(o.customer_name)}<small>${esc(when)} · ${esc(cons)} · ${esc(o.slot_label || "-")}</small></div><div class="bv">${euro(o.total)} ›</div></div>`;
  }).join("");

  wrap.innerHTML =
    `<div class="subgrid">` +
      `<div><p class="eyebrow muted">Riepilogo economico</p><div style="height:10px"></div>${eco}</div>` +
      `<div>` +
        `<p class="eyebrow muted">Per tipologia (formato)</p><div style="height:10px"></div><div class="panel">${fmts}</div>` +
        `<div style="height:18px"></div>` +
        `<p class="eyebrow muted">Per gusto</p><div style="height:10px"></div><div class="panel">${flv}</div>` +
      `</div>` +
    `</div>` +
    `<div style="height:22px"></div>` +
    `<p class="eyebrow muted">Ordini consegnati</p><div style="height:10px"></div><div class="panel">${orders}</div>`;

  // click su una riga → dettaglio completo in overlay
  wrap.querySelectorAll(".hxrow[data-oid]").forEach((el) => {
    const o = ORDERS.find((x) => x.id === el.dataset.oid);
    if (!o) return;
    const open = () => openOrderDetail(o);
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
  });
}

// ---------- distanza/tempo auto dalla gelateria (OSRM, no key) ----------
// ROUTE_CACHE["lat,lng"] = Promise<{km,min}|{err}>
function getRoute(lat, lng) {
  const key = lat + "," + lng;
  if (!ROUTE_CACHE[key]) {
    ROUTE_CACHE[key] = (async () => {
      try {
        const u = `https://router.project-osrm.org/route/v1/driving/${GELATERIA.lng},${GELATERIA.lat};${lng},${lat}?overview=false`;
        const d = await (await fetch(u)).json();
        return (d.code === "Ok" && d.routes && d.routes[0])
          ? { km: d.routes[0].distance / 1000, min: d.routes[0].duration / 60 } : { err: true };
      } catch (e) { return { err: true }; }
    })();
  }
  return ROUTE_CACHE[key];
}
function fillRoute(el, v) {
  el.textContent = (!v || v.err) ? "" : ` · ${v.km.toFixed(1).replace(".", ",")} km · ${Math.round(v.min)} min`;
}
function hydrateRoutes() {
  document.querySelectorAll(".route-info[data-rk]").forEach((el) => {
    const [la, lo] = el.dataset.rk.split(",").map(Number);
    getRoute(la, lo).then((v) => fillRoute(el, v));
  });
}

// ========== CONSEGNE — giro di oggi per fascia, percorso ottimale (TSP) su mappa ==========
// Ordini: consegne attive di OGGI (accettato/in preparazione/in consegna), raggruppate per fascia.
// Per fascia: percorso ottimale dalla gelateria (andata+ritorno) via OSRM /trip, mappa + lista
// numerata in ordine di percorso con durate di guida cumulate. Render lazy (solo a tab visibile).
let CONSEGNE_DIRTY = true;
const TRIP_CACHE = {};
const CONSEGNE_MAPS = {};   // mapId -> { map, bounds }
const ACTIVE_DELIVERY = new Set(["accettato", "in preparazione", "in consegna"]);

const fmtMin = (sec) => Math.round(sec / 60) + " min";
const fmtKm = (m) => (m / 1000).toFixed(1).replace(".", ",") + " km";

function consegneToday() {
  const today = ymd(new Date());
  return ORDERS.filter((o) => o.fulfillment !== "pickup" && o.delivery_date === today && ACTIVE_DELIVERY.has(o.status));
}

// OSRM Trip (TSP): coords [[lat,lng],...] con la gelateria prima. Cache per set di coordinate.
function osrmTrip(coords) {
  const key = coords.map((c) => c[0].toFixed(5) + "," + c[1].toFixed(5)).join(";");
  if (!TRIP_CACHE[key]) {
    TRIP_CACHE[key] = (async () => {
      try {
        const path = coords.map((c) => c[1] + "," + c[0]).join(";");   // OSRM vuole lng,lat
        const u = `https://router.project-osrm.org/trip/v1/driving/${path}?source=first&roundtrip=true&geometries=geojson&overview=full`;
        const d = await (await fetch(u)).json();
        if (d.code !== "Ok" || !d.trips || !d.trips[0]) return { err: true };
        return { waypoints: d.waypoints, legs: d.trips[0].legs, geometry: d.trips[0].geometry.coordinates };
      } catch (e) { return { err: true }; }
    })();
  }
  return TRIP_CACHE[key];
}

function renderConsegne() {
  CONSEGNE_DIRTY = true;
  const sec = $("tab-consegne");
  if (sec && !sec.classList.contains("hidden")) drawConsegne();   // visibile → disegna subito
}

async function drawConsegne() {
  const wrap = $("consegne-list");
  if (!wrap) return;
  CONSEGNE_DIRTY = false;
  Object.keys(CONSEGNE_MAPS).forEach((k) => { try { CONSEGNE_MAPS[k].map.remove(); } catch (e) {} delete CONSEGNE_MAPS[k]; });

  const list = consegneToday();
  if (!list.length) { wrap.innerHTML = '<p class="hint">Nessuna consegna in programma per oggi.</p>'; return; }

  const bySlot = {};
  list.forEach((o) => { const s = o.slot_label || "Senza fascia"; (bySlot[s] || (bySlot[s] = [])).push(o); });
  const slots = Object.keys(bySlot).sort((a, b) => slotMin(a) - slotMin(b));

  wrap.innerHTML = "";
  slots.forEach((slot, si) => {
    const orders = bySlot[slot];
    const withGeo = orders.filter((o) => o.delivery_lat != null && o.delivery_lng != null);
    const noGeo = orders.filter((o) => o.delivery_lat == null || o.delivery_lng == null);
    const mapId = "consegne-map-" + si;

    const box = document.createElement("div");
    box.className = "panel"; box.style.cssText = "margin-bottom:18px";
    box.innerHTML =
      `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">` +
        `<b style="font-size:1.05rem">${esc(slot)}</b>` +
        `<span class="count">${orders.length} consegn${orders.length === 1 ? "a" : "e"}</span>` +
        `<span class="muted small" id="${mapId}-tot" style="margin-left:auto"></span></div>` +
      (withGeo.length ? `<div id="${mapId}" style="height:260px;border-radius:12px;overflow:hidden;margin-bottom:10px"></div>` : "") +
      `<div class="panel" id="${mapId}-list"></div>` +
      (noGeo.length ? `<p class="hint" style="margin-top:8px">⚠ Senza posizione sulla mappa: ${esc(noGeo.map((o) => o.customer_name).join(", "))}</p>` : "");
    wrap.appendChild(box);

    if (withGeo.length) buildSlotRoute(withGeo, mapId);
    else $(mapId + "-list").innerHTML = numberedRows(orders.map((o, i) => ({ o, n: i + 1 })), null);
  });
}

async function buildSlotRoute(orders, mapId) {
  const coords = [[GELATERIA.lat, GELATERIA.lng]].concat(orders.map((o) => [o.delivery_lat, o.delivery_lng]));
  const trip = await osrmTrip(coords);
  const listEl = $(mapId + "-list"), totEl = $(mapId + "-tot");
  if (!listEl) return;

  if (trip.err) {   // fallback: ordina per distanza stradale crescente, mappa con soli marker
    const routes = await Promise.all(orders.map((o) => getRoute(o.delivery_lat, o.delivery_lng)));
    const arr = orders.map((o, i) => ({ o, km: (routes[i] && !routes[i].err) ? routes[i].km : Infinity }))
      .sort((a, b) => a.km - b.km).map((x, i) => ({ o: x.o, n: i + 1 }));
    listEl.innerHTML = numberedRows(arr, '<p class="hint" style="margin:0 0 8px">Percorso ottimale non disponibile (riprova tra poco). Ordine per distanza stradale.</p>');
    if (totEl) totEl.textContent = "percorso n/d";
    drawConsegneMap(mapId, arr.map((x) => x.o), null);
    return;
  }

  const wp = trip.waypoints;
  const seq = orders.map((o, i) => ({ o, pos: wp[i + 1].waypoint_index })).sort((a, b) => a.pos - b.pos);
  const legDur = trip.legs.map((l) => l.duration);
  const cumAt = (p) => legDur.slice(0, p).reduce((s, d) => s + d, 0);
  const rows = seq.map((x, idx) => ({ o: x.o, n: idx + 1, cum: cumAt(x.pos), leg: legDur[x.pos - 1] }));
  listEl.innerHTML = numberedRows(rows, null);

  const totSec = legDur.reduce((s, d) => s + d, 0);
  const totDist = trip.legs.reduce((s, l) => s + (l.distance || 0), 0);
  if (totEl) totEl.textContent = `${fmtKm(totDist)} · ${fmtMin(totSec)} (incl. rientro)`;
  drawConsegneMap(mapId, seq.map((x) => x.o), trip.geometry);
}

function numberedRows(rows, noteHtml) {
  const body = rows.map(({ o, n, cum, leg }) => {
    const time = (cum != null) ? `<small>🕒 ${fmtMin(cum)} dalla gelateria${leg != null ? " · +" + fmtMin(leg) : ""}</small>` : "";
    const num = `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#a8552f;color:#fff;font-size:.72rem;font-weight:700;margin-right:7px;flex:none">${n}</span>`;
    return `<div class="brk"><div class="bn">${num}${esc(o.customer_name)}` +
      `<small>${esc(o.address || "")}${o.customer_phone ? " · " + esc(o.customer_phone) : ""}</small>${time}</div>` +
      `<div class="bv">${euro(o.total)}</div></div>`;
  }).join("");
  return (noteHtml || "") + body;
}

function consDivIcon(html, size) {
  return L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
function drawConsegneMap(mapId, orders, geometry) {
  const el = $(mapId);
  if (!el || typeof L === "undefined") return;
  if (CONSEGNE_MAPS[mapId]) { try { CONSEGNE_MAPS[mapId].map.remove(); } catch (e) {} delete CONSEGNE_MAPS[mapId]; }
  const map = L.map(mapId, { zoomControl: true, attributionControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  let bounds = L.latLngBounds([[GELATERIA.lat, GELATERIA.lng]]);
  if (geometry && geometry.length) {
    const line = geometry.map((c) => [c[1], c[0]]);   // [lng,lat] → [lat,lng]
    const pl = L.polyline(line, { color: "#a8552f", weight: 4, opacity: .85 }).addTo(map);
    bounds = pl.getBounds().extend([GELATERIA.lat, GELATERIA.lng]);
  }
  L.marker([GELATERIA.lat, GELATERIA.lng], { icon: consDivIcon('<div style="width:28px;height:28px;border-radius:50%;background:#1f6f3f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.95rem;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">🍦</div>', 28) })
    .addTo(map).bindPopup("Gelateria");
  orders.forEach((o, i) => {
    L.marker([o.delivery_lat, o.delivery_lng], { icon: consDivIcon(`<div style="width:26px;height:26px;border-radius:50%;background:#a8552f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>`, 26) })
      .addTo(map).bindPopup(`<b>${i + 1}. ${esc(o.customer_name)}</b><br>${esc(o.address || "")}`);
    bounds.extend([o.delivery_lat, o.delivery_lng]);
  });
  map.fitBounds(bounds, { padding: [24, 24] });
  CONSEGNE_MAPS[mapId] = { map, bounds };
  setTimeout(() => map.invalidateSize(), 60);
}
function invalidateConsegneMaps() {
  Object.values(CONSEGNE_MAPS).forEach(({ map, bounds }) => {
    try { map.invalidateSize(); if (bounds) map.fitBounds(bounds, { padding: [24, 24] }); } catch (e) {}
  });
}

// ========== TAKE AWAY (solo ritiri in negozio, attivi) ==========
function renderTakeaway() {
  const wrap = $("takeaway-list");
  if (!wrap) return;
  const list = ORDERS.filter((o) => o.fulfillment === "pickup" && !TERMINAL.has(o.status));
  if (!list.length) { wrap.innerHTML = '<p class="hint">Nessun ordine da ritirare al momento.</p>'; return; }
  const key = (o) => (o.delivery_date || "") + " " + (o.slot_label || "");   // per giorno+orario di ritiro
  list.sort((a, b) => key(a).localeCompare(key(b)));
  wrap.innerHTML = "";
  list.forEach((o) => wrap.appendChild(orderCard(o)));
}

// iconcine metodo di pagamento: carta (generica), PayPal (logo), Satispay (glifo)
const PAY_ICONS = {
  card: '<svg class="payi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>',
  paypal: '<svg class="payi" viewBox="7.056 3 37.351 45" aria-hidden="true"><path fill="#002991" d="M38.914 13.35c0 5.574-5.144 12.15-12.927 12.15H18.49l-.368 2.322L16.373 39H7.056l5.605-36h15.095c5.083 0 9.082 2.833 10.555 6.77a9.687 9.687 0 0 1 .603 3.58z"/><path fill="#60CDFF" d="M44.284 23.7A12.894 12.894 0 0 1 31.53 34.5h-5.206L24.157 48H14.89l1.483-9 1.75-11.178.367-2.322h7.497c7.773 0 12.927-6.576 12.927-12.15 3.825 1.974 6.055 5.963 5.37 10.35z"/><path fill="#008CFF" d="M38.914 13.35C37.31 12.511 35.365 12 33.248 12h-12.64L18.49 25.5h7.497c7.773 0 12.927-6.576 12.927-12.15z"/></svg>',
  satispay: '<svg class="payi" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="6" fill="#F94C43"/><path d="M12 17.6s-4.3-2.6-4.3-5.5a2.45 2.45 0 0 1 4.3-1.55 2.45 2.45 0 0 1 4.3 1.55c0 2.9-4.3 5.5-4.3 5.5z" fill="#fff"/></svg>',
};
function payBadge(o) {
  const m = (o.payment_method || "").toLowerCase();
  let label, cls, icon = "";
  if (m === "card") { label = "Carta"; cls = "pay-card"; icon = PAY_ICONS.card; }
  else if (m === "paypal") { label = "PayPal"; cls = "pay-paypal"; icon = PAY_ICONS.paypal; }
  else if (m === "satispay") { label = "Satispay"; cls = "pay-satispay"; icon = PAY_ICONS.satispay; }
  else if (o.payment_provider === "stripe") { label = "Pagato"; cls = "pay-other"; }
  else return "";
  return `<span class="paybadge ${cls}">${icon}${label}</span>`;
}

function orderCard(o, bare) {   // bare=true → vista sola lettura (no WhatsApp, no azioni): usata nel dettaglio Storico
  const meta = STATUS_META[o.status] || { label: o.status, slug: "ricevuto" };
  const isPk = o.fulfillment === "pickup";
  const pb = payBadge(o);
  const el = document.createElement("div");
  el.className = "order";
  el.setAttribute("data-s", o.status);
  el.id = "order-" + o.id;
  const items = (o.items || []).map((i) =>
    `<div class="it"><div class="t">${i.qty}× ${esc(i.format)}<small>${esc((i.gusti || []).join(", "))}</small></div>` +
    `<div class="p">${euro(i.prezzo_unit * i.qty)}</div></div>`
  ).join("");
  const when = new Date(o.created_at).toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const cons = o.delivery_date ? new Date(o.delivery_date + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" }) : "-";
  el.innerHTML =
    `<div class="top"><div class="who">${esc(o.customer_name)}</div>` +
    `<span class="status" data-s="${esc(o.status)}"><span class="led"></span>${esc(meta.label)}</span></div>` +
    `<div class="meta"><span class="k">${esc(when)}</span> · ${esc(o.customer_phone)}${o.email ? " · " + esc(o.email) : ""}<br>` +
    `${esc(o.address)}${o.delivery_lat != null ? ` · <a class="maplink" href="https://www.google.com/maps?q=${o.delivery_lat},${o.delivery_lng}" target="_blank" rel="noopener">Mappa</a><span class="route-info" data-rk="${o.delivery_lat},${o.delivery_lng}"></span>` : ""}<br>` +
    `<span class="k">${isPk ? "Ritiro" : "Consegna"}</span> ${esc(cons)} · ${esc((o.slot_label || "-").replace(/^Ritiro /, "ore "))}` +
    `${pb ? `<br><span class="k">Pagamento</span> ${pb}` : ""}` +
    `${o.notes ? `<br><span class="k">Note</span> ${esc(o.notes)}` : ""}</div>` +
    `<div class="items">${items}</div>` +
    `<div class="foot"><span class="del">${isPk ? "Ritiro" : "Consegna"} ${euro(o.delivery_cost)}</span><span class="tot">${euro(o.total)}</span></div>` +
    (!bare && o.status !== "ricevuto" ? `<div class="wa-row"><button class="btn wa sm wa-btn">WhatsApp</button></div>` : "") +
    (bare ? "" : `<div class="actions"></div>`);
  if (!bare) {
    renderActions(el.querySelector(".actions"), o);
    const wb = el.querySelector(".wa-btn"); if (wb) wb.onclick = () => waOpen(o, o.status);
  }
  return el;
}

// ---------- dettaglio ordine in overlay (Storico → click su una riga) ----------
function closeOrderDetail() {
  const ov = $("order-detail-overlay"); if (ov) ov.remove();
  document.removeEventListener("keydown", escCloseDetail);
}
function escCloseDetail(e) { if (e.key === "Escape") closeOrderDetail(); }
function openOrderDetail(o) {
  closeOrderDetail();
  const ov = document.createElement("div");
  ov.id = "order-detail-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto";
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;max-width:520px;width:100%";
  const close = mkBtn("✕", "btn ghost sm", closeOrderDetail);
  close.style.cssText = "position:absolute;top:8px;right:8px;z-index:1";
  wrap.append(close, orderCard(o, true));
  ov.appendChild(wrap);
  ov.onclick = (e) => { if (e.target === ov) closeOrderDetail(); };
  document.addEventListener("keydown", escCloseDetail);
  document.body.appendChild(ov);
  hydrateRoutes();   // riempie distanza/tempo nel dettaglio (consegna con coordinate)
}

function mkBtn(text, cls, onclick) {
  const b = document.createElement("button");
  b.className = cls; b.textContent = text; b.onclick = onclick;
  return b;
}

function renderActions(box, o) {
  box.innerHTML = "";
  const st = o.status;
  if (TERMINAL.has(st)) return;   // consegnato / rifiutato / annullato: nessuna azione

  if (st === "ricevuto") {
    const row = document.createElement("div"); row.className = "actrow";
    row.append(
      mkBtn("Accetta", "btn ok sm", () => changeStatus(o, "accettato")),
      mkBtn("Rifiuta", "btn danger sm", () => rejectOrRefund(o, "rifiutato"))
    );
    box.append(row);
    return;
  }

  // RITIRO: dopo "accettato" niente preparazione/consegna → solo "ritirato" (consegnato) + annulla
  if (o.fulfillment === "pickup") {
    const row = document.createElement("div"); row.className = "actrow";
    row.append(mkBtn("Segna ritirato", "btn ok sm", () => changeStatus(o, "consegnato")));
    const cancelRow = document.createElement("div"); cancelRow.className = "actrow";
    cancelRow.append(mkBtn("Annulla ordine", "btn danger sm", () => rejectOrRefund(o, "annullato")));
    box.append(row, cancelRow);
    return;
  }

  // CONSEGNA · accettato / in preparazione / in consegna → step + annulla (ognuno apre WhatsApp)
  const steps = document.createElement("div"); steps.className = "actrow steps";
  PROGRESS.forEach((s) => {
    steps.append(mkBtn(STATUS_META[s].label, "chip" + (s === st ? " sel" : ""), () => changeStatus(o, s)));
  });
  const cancelRow = document.createElement("div"); cancelRow.className = "actrow";
  cancelRow.append(mkBtn("Annulla ordine", "btn danger sm", () => rejectOrRefund(o, "annullato")));
  box.append(steps, cancelRow);
}

async function updateStatus(id, status) {
  const { error } = await sb.from("orders").update({ status }).eq("id", id);
  if (error) { console.error(error); toast("Errore aggiornamento stato."); return; }
  toast("Stato aggiornato.");
}

// Rifiuto/annullamento: se l'ordine è PAGATO, rimborsa (funzione server) e poi cambia stato;
// altrimenti cambia solo stato (comportamento storico, apre WhatsApp).
async function rejectOrRefund(o, status) {
  const verb = status === "rifiutato" ? "Rifiutare" : "Annullare";
  const paid = o.payment_id && !o.refunded_at;
  if (!confirm(paid ? `${verb} l'ordine e rimborsare ${euro(o.total)} al cliente?` : `${verb} questo ordine?`)) return;
  if (!paid) { changeStatus(o, status); return; }
  const res = await fetch("/.netlify/functions/refund", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: o.id, status }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) { toast((data && data.error) || "Errore rimborso."); return; }
  const i = ORDERS.findIndex((x) => x.id === o.id);
  if (i >= 0) { ORDERS[i].status = status; ORDERS[i].refunded_at = data.refunded_at || new Date().toISOString(); }
  renderOrders();
  toast(data.already ? "Era già rimborsato." : "Rimborsato €" + Number(o.total).toFixed(2) + " e " + status + ".");
}

function subscribeOrders() {
  sb.channel("orders-rt")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (p) => {
      ORDERS.unshift(p.new); renderOrders();
      toast("Nuovo ordine ricevuto."); beep(); notifyNewOrder(p.new);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (p) => {
      const i = ORDERS.findIndex((o) => o.id === p.new.id);
      if (i >= 0) { ORDERS[i] = p.new; renderOrders(); }
    })
    .subscribe((status) => {
      $("conn").style.color = status === "SUBSCRIBED" ? "#bff5c8" : "#ffd6d6";
    });
}

// ========== GUSTI ==========
async function loadFlavors() {
  const { data, error } = await sb.from("flavors").select("*").order("sort_order");
  if (error) { console.error(error); return; }
  const list = $("flavors-list");
  list.innerHTML = "";
  data.forEach((f) => {
    const el = document.createElement("div");
    el.className = "mrow";
    el.innerHTML =
      `<input class="g-name grow" value="${esc(f.name)}">` +
      availRadios("fl-" + f.id, f.available) +
      `<button class="btn icon">✕</button>`;
    const name = el.querySelector(".g-name");
    name.onchange = () => updateRow("flavors", f.id, { name: name.value.trim() });
    wireAvailRadios(el, (val) => updateRow("flavors", f.id, { available: val }));
    el.querySelector(".btn.icon").onclick = async () => { await delRow("flavors", f.id); loadFlavors(); };
    list.appendChild(el);
  });
}
$("nf-add").onclick = async () => {
  const name = $("nf-name").value.trim(); if (!name) return;
  const order = Date.now() % 100000;
  await sb.from("flavors").insert({ name, sort_order: order });
  $("nf-name").value = ""; loadFlavors();
};

// ========== FORMATI ==========
async function loadFormats() {
  const { data, error } = await sb.from("formats").select("*").order("sort_order");
  if (error) { console.error(error); return; }
  const list = $("formats-list");
  list.innerHTML = "";
  data.forEach((f) => {
    const el = document.createElement("div");
    el.className = "fmt-card";
    el.innerHTML =
      `<input class="f-name" value="${esc(f.name)}">` +
      `<div class="grid2">` +
      `<div class="field" style="margin:0"><label>Gusti max</label><input class="f-max" type="number" min="1" value="${f.max_flavors}"></div>` +
      `<div class="field" style="margin:0"><label>Prezzo €</label><input class="f-price" type="number" min="0" step="0.50" value="${f.price}"></div>` +
      `</div>` +
      `<div class="foot">` + availRadios("fo-" + f.id, f.available) + `<button class="btn icon" style="width:auto;padding:8px 14px">Elimina</button></div>`;
    const name = el.querySelector(".f-name"), max = el.querySelector(".f-max"), price = el.querySelector(".f-price");
    const del = el.querySelector(".foot .btn.icon");
    name.onchange = () => updateRow("formats", f.id, { name: name.value.trim() });
    max.onchange = () => updateRow("formats", f.id, { max_flavors: parseInt(max.value || "1", 10) });
    price.onchange = () => updateRow("formats", f.id, { price: parseFloat(price.value || "0") });
    wireAvailRadios(el, (val) => updateRow("formats", f.id, { available: val }));
    del.onclick = async () => { await delRow("formats", f.id); loadFormats(); };
    list.appendChild(el);
  });
}
$("nfo-add").onclick = async () => {
  const name = $("nfo-name").value.trim(); if (!name) return;
  await sb.from("formats").insert({
    name,
    max_flavors: parseInt($("nfo-max").value || "1", 10),
    price: parseFloat($("nfo-price").value || "0"),
    sort_order: Date.now() % 100000,
  });
  $("nfo-name").value = ""; $("nfo-max").value = 1; $("nfo-price").value = 0;
  loadFormats();
};

// ========== FASCE (catalogo condiviso + acceso/spento per giorno) ==========
const slotScope = () => (document.querySelector('input[name="slot-scope"]:checked') || {}).value || "day";
const slotActive = (s) => (DAY_OVERRIDES.has(s.id) ? DAY_OVERRIDES.get(s.id) : s.active);

function renderCal() {
  const cal = $("slot-cal");
  cal.innerHTML = "";
  SLOT_DAYS.forEach((d, i) => {
    const key = ymd(d);
    const b = document.createElement("button");
    b.className = "day" + (key === SELECTED_DAY ? " sel" : "") + (i === 0 ? " today" : "");
    b.innerHTML = `<div class="dwd">${dayName(d, i)}</div><div class="dnum">${d.getDate()}</div>`;
    b.onclick = () => {
      SELECTED_DAY = key;
      const sd = $("scope-day");
      if (sd) sd.textContent = i === 0 ? "oggi" : i === 1 ? "domani" : dayName(d, i).toLowerCase() + " " + d.getDate();
      loadSlots();
    };
    cal.appendChild(b);
  });
}

async function loadSlots() {
  renderCal();
  const cat = await sb.from("time_slots").select("*").order("sort_order");
  if (cat.error) { console.error(cat.error); return; }
  SLOTS_CATALOG = (cat.data || []).slice().sort((a, b) => slotMin(a.label) - slotMin(b.label));  // ordine orario
  const ov = await sb.from("slot_day_state").select("slot_id, active").eq("day", SELECTED_DAY);
  if (ov.error) { console.error(ov.error); }
  DAY_OVERRIDES = new Map((ov.data || []).map((r) => [r.slot_id, r.active]));
  renderSlotsList();
}

function renderSlotsList() {
  const list = $("slots-list");
  list.innerHTML = "";
  if (!SLOTS_CATALOG.length) { list.innerHTML = '<p class="muted small">Nessuna fascia. Aggiungine una sopra.</p>'; return; }
  SLOTS_CATALOG.forEach((s) => {
    const on = slotActive(s);
    const el = document.createElement("div");
    el.className = "mrow";
    el.innerHTML =
      `<input class="s-label grow" value="${esc(s.label)}" style="font-variant-numeric:tabular-nums">` +
      `<label class="slotmax"><span class="slotmax-lbl">Max</span>` +
      `<input class="s-max" type="number" min="1" placeholder="∞" title="Max consegne al giorno (vuoto = illimitato)" value="${s.max_deliveries ?? ""}"></label>` +
      availRadios("sl-" + s.id, on, "Accesa", "Spenta") +
      `<button class="btn icon">✕</button>`;
    const label = el.querySelector(".s-label");
    label.onchange = () => updateRow("time_slots", s.id, { label: label.value.trim() });
    const smax = el.querySelector(".s-max");
    smax.onchange = () => {
      const v = smax.value.trim(), n = v === "" ? null : parseInt(v, 10);
      updateRow("time_slots", s.id, { max_deliveries: (n && n > 0) ? n : null });
    };
    wireAvailRadios(el, (val) => setSlotActive(s.id, val));
    el.querySelector(".btn.icon").onclick = async () => { await delRow("time_slots", s.id); loadSlots(); };
    list.appendChild(el);
  });
}

async function setSlotActive(slotId, active) {
  const all = slotScope() === "all";
  const days = all ? SLOT_DAYS.map(ymd) : [SELECTED_DAY];
  const rows = days.map((day) => ({ slot_id: slotId, day, active }));
  const { error } = await sb.from("slot_day_state").upsert(rows, { onConflict: "slot_id,day" });
  if (error) { console.error(error); toast("Errore salvataggio fascia."); return; }
  DAY_OVERRIDES.set(slotId, active);
  toast(all ? "Applicato a tutti e 7 i giorni." : "Aggiornato.");
}

async function purgeOldSlotState() {
  await sb.from("slot_day_state").delete().lt("day", ymd(next7()[0]));
}

// selettori inizio/fine fascia: step 30 min, 12:00 → 24:00
const SLOT_MIN = 12 * 60, SLOT_MAX = 24 * 60, SLOT_STEP = 30;
const fmtTime = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
function fillSlotStart() {
  const s = $("ns-start"); s.innerHTML = "";
  for (let m = SLOT_MIN; m <= SLOT_MAX - SLOT_STEP; m += SLOT_STEP) s.appendChild(new Option(fmtTime(m), m));
}
function fillSlotEnd() {
  const start = parseInt($("ns-start").value, 10);
  const e = $("ns-end"); const prev = parseInt(e.value, 10); e.innerHTML = "";
  for (let m = start + SLOT_STEP; m <= SLOT_MAX; m += SLOT_STEP) e.appendChild(new Option(fmtTime(m), m));
  if (prev > start && prev <= SLOT_MAX) e.value = prev;   // mantieni scelta se ancora valida
}
fillSlotStart(); fillSlotEnd();
$("ns-start").onchange = fillSlotEnd;

$("ns-add").onclick = async () => {
  const start = parseInt($("ns-start").value, 10), end = parseInt($("ns-end").value, 10);
  if (!(end > start)) { toast("La fine deve essere dopo l'inizio."); return; }
  const label = fmtTime(start) + " - " + fmtTime(end);
  if (SLOTS_CATALOG.some((s) => s.label === label)) { toast("Fascia già presente."); return; }
  const maxRaw = $("ns-max").value.trim(), maxVal = maxRaw === "" ? null : parseInt(maxRaw, 10);
  await sb.from("time_slots").insert({ label, sort_order: start, max_deliveries: (maxVal && maxVal > 0) ? maxVal : null });
  $("ns-max").value = "";
  loadSlots();
};

// ========== PARAMETRI ==========
async function loadSettings() {
  const { data, error } = await sb.from("settings").select("*").eq("id", 1).single();
  if (error) { console.error(error); return; }
  SETTINGS = data || {};
  $("set-delivery").value = data.delivery_cost;
  $("set-min").value = data.min_order;
  const t = waTemplates();
  WA_STATUSES.forEach((s) => { const el = $("wa-" + STATUS_META[s].slug); if (el) el.value = t[s] || ""; });
  renderOpeningHoursEditor();
}
$("set-save").onclick = async () => {
  const { error } = await sb.from("settings").update({
    delivery_cost: parseFloat($("set-delivery").value || "0"),
    min_order: parseFloat($("set-min").value || "0"),
  }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio."); return; }
  toast("Parametri salvati.");
};
$("wa-save").onclick = async () => {
  const tpl = {};
  WA_STATUSES.forEach((s) => { const el = $("wa-" + STATUS_META[s].slug); if (el) tpl[s] = el.value.trim(); });
  const { error } = await sb.from("settings").update({ wa_templates: tpl }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio messaggi."); return; }
  SETTINGS.wa_templates = tpl;
  toast("Messaggi WhatsApp salvati.");
};

// ---------- zona di consegna disegnabile (Parametri) ----------
function setupAreaMap() {
  if (!areaMap) initAreaMap();
  else setTimeout(() => areaMap.invalidateSize(), 60);
}
function initAreaMap() {
  if (typeof L === "undefined" || !L.PM || !$("area-map")) return;
  areaMap = L.map("area-map", { center: [40.7716, 9.6704], zoom: 11 });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(areaMap);
  // riferimento: confine comune San Teodoro (non editabile)
  (window.SAN_TEODORO_POLY || []).forEach((ring) =>
    L.polygon(ring, { color: "#9b9285", weight: 1, dashArray: "4 4", fill: false, interactive: false }).addTo(areaMap));
  areaMap.pm.addControls({ position: "topleft", drawPolygon: true, editMode: true, dragMode: true, removalMode: true,
    rotateMode: false, drawMarker: false, drawPolyline: false, drawRectangle: false, drawCircle: false, drawCircleMarker: false, drawText: false, cutPolygon: false });
  try { areaMap.pm.setLang("it"); } catch (e) {}
  const area = SETTINGS.delivery_area;
  if (Array.isArray(area) && area.length >= 3) {
    areaLayer = L.polygon(area, { color: "#a8552f", weight: 2, fillColor: "#a8552f", fillOpacity: .1 }).addTo(areaMap);
    areaMap.fitBounds(areaLayer.getBounds(), { padding: [20, 20] });
  } else if (window.SAN_TEODORO_POLY) {
    areaMap.fitBounds(L.polygon(window.SAN_TEODORO_POLY).getBounds(), { padding: [10, 10] });
  }
  // una sola zona: alla creazione rimuovi la precedente
  areaMap.on("pm:create", (e) => {
    if (areaLayer) areaMap.removeLayer(areaLayer);
    areaLayer = e.layer;
  });
  setTimeout(() => areaMap.invalidateSize(), 80);
}
$("area-save").onclick = async () => {
  if (!areaLayer) { toast("Disegna prima una zona sulla mappa."); return; }
  const pts = (areaLayer.getLatLngs()[0] || []).map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)]);
  if (pts.length < 3) { toast("Servono almeno 3 punti."); return; }
  const { error } = await sb.from("settings").update({ delivery_area: pts }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio zona."); return; }
  SETTINGS.delivery_area = pts;
  toast("Zona di consegna salvata.");
};
$("area-reset").onclick = async () => {
  if (!confirm("Ripristinare la zona al comune di San Teodoro?")) return;
  const { error } = await sb.from("settings").update({ delivery_area: null }).eq("id", 1);
  if (error) { console.error(error); toast("Errore."); return; }
  SETTINGS.delivery_area = null;
  if (areaLayer && areaMap) { areaMap.removeLayer(areaLayer); areaLayer = null; }
  toast("Zona ripristinata: comune di San Teodoro.");
};

// ---------- orari di apertura (Parametri; usati per il ritiro in negozio) ----------
// chiavi giorno e default allineati a js/order.js (WD_KEY / OPENING_DEFAULTS)
const OH_DAYS = [["lun", "Lun"], ["mar", "Mar"], ["mer", "Mer"], ["gio", "Gio"], ["ven", "Ven"], ["sab", "Sab"], ["dom", "Dom"]];
const OH_DEFAULTS = { lun: { open: "16:00", close: "24:00" }, mar: { open: "16:00", close: "24:00" }, mer: { open: "16:00", close: "24:00" }, gio: { open: "16:00", close: "24:00" }, ven: { open: "16:00", close: "24:00" }, sab: { open: "16:00", close: "24:00" }, dom: { open: "16:00", close: "24:00" } };
function ohTimes() {                                       // "00:00" .. "24:00", passo 30 min
  const out = [];
  for (let m = 0; m <= 1440; m += 30) out.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  return out;
}
const ohOptions = (sel) => ohTimes().map((t) => `<option value="${t}"${t === sel ? " selected" : ""}>${t}</option>`).join("");
function renderOpeningHoursEditor() {
  const wrap = $("oh-editor"); if (!wrap) return;
  const oh = Object.assign({}, OH_DEFAULTS, SETTINGS.opening_hours || {});
  wrap.innerHTML = OH_DAYS.map(([k, lbl]) => {
    const h = oh[k] || {}, cl = !!h.closed;
    return `<div class="oh-erow" data-k="${k}">
      <span class="oh-day">${lbl}</span>
      <label class="oh-closed"><input type="checkbox" class="oh-cl"${cl ? " checked" : ""}> Chiuso</label>
      <select class="oh-open"${cl ? " disabled" : ""}>${ohOptions(h.open || "16:00")}</select>
      <span class="oh-sep">–</span>
      <select class="oh-close"${cl ? " disabled" : ""}>${ohOptions(h.close || "24:00")}</select>
    </div>`;
  }).join("");
  wrap.querySelectorAll(".oh-erow").forEach((row) => {
    const cb = row.querySelector(".oh-cl");
    cb.onchange = () => row.querySelectorAll("select").forEach((s) => { s.disabled = cb.checked; });
  });
}
$("oh-save").onclick = async () => {
  const oh = {};
  $("oh-editor").querySelectorAll(".oh-erow").forEach((row) => {
    oh[row.dataset.k] = {
      closed: row.querySelector(".oh-cl").checked,
      open: row.querySelector(".oh-open").value,
      close: row.querySelector(".oh-close").value,
    };
  });
  const { error } = await sb.from("settings").update({ opening_hours: oh }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio orari."); return; }
  SETTINGS.opening_hours = oh;
  toast("Orari di apertura salvati.");
};

// ---------- helper DB ----------
async function updateRow(table, id, patch) {
  const { error } = await sb.from(table).update(patch).eq("id", id);
  if (error) { console.error(error); toast("Errore salvataggio."); }
}
async function delRow(table, id) {
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) { console.error(error); toast("Errore eliminazione."); }
}

// ---------- util ----------
let toastTimer = null;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
// ---------- AVVISI NUOVO ORDINE: audio robusto + notifica browser ----------
// L'AudioContext parte "suspended" finché non c'è un gesto utente: senza sblocco il
// primo beep è muto. Lo sblocchiamo al login e al primo gesto (copre l'auto-login da reload).
let _audioCtx = null;
function unlockAudio() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
  } catch (e) { /* audio non disponibile */ }
}
function ensureNotifyPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  } catch (e) { /* notifiche non disponibili */ }
}
// primo gesto utile, ovunque: sblocca audio + chiede permesso notifiche (una volta sola)
["pointerdown", "keydown"].forEach((ev) =>
  document.addEventListener(ev, () => { unlockAudio(); ensureNotifyPermission(); }, { once: true }));

function beep() {
  try {
    unlockAudio();
    const ctx = _audioCtx; if (!ctx) return;
    const tone = (freq, at, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq; g.gain.value = 0.08;
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur);
    };
    tone(880, 0, 0.18); tone(1175, 0.22, 0.18);   // due toni: più riconoscibile di un beep secco
  } catch (e) { /* audio non disponibile */ }
}

function notifyNewOrder(o) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const tipo = o.fulfillment === "pickup" ? "Ritiro" : "Consegna";
    const dd = String(o.delivery_date || "").replace(/^(\d{4})-(\d{2})-(\d{2}).*/, "$3/$2");
    const body = [o.customer_name, tipo, dd, o.slot_label].filter(Boolean).join(" · ");
    const n = new Notification("🍦 Nuovo ordine — " + euro(o.total), { body, tag: "ordine-" + o.id, renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { /* ignora */ }
}
