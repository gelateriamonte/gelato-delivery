// ============ Back office — gestione parametri + ordini live ============
const $ = (id) => document.getElementById(id);
if (window.I18N) { try { I18N.setLang("it", false); } catch (e) {} }   // admin sempre IT (default testi dal dizionario italiano)
const ADMIN_UPLOAD_TOKEN = "gx_up_9f3kQ7tB2mZ";                        // speed-bump endpoint upload immagini (auth vera = go-live)
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
function changeStatus(o, status) {
  waOpen(o, status); updateStatus(o.id, status);
  if (status === "accettato" || status === "consegnato") sendOrderEmail(o.id, status);
}

// Header Authorization con il JWT della sessione admin (per function protette).
async function authHeaders() {
  const { data: { session } } = await sb.auth.getSession();
  return session ? { Authorization: "Bearer " + session.access_token } : {};
}

// Invia (best-effort) l'email transazionale al cliente per lo stato dato.
async function sendOrderEmail(orderId, status) {
  try {
    await fetch("/.netlify/functions/send-order-email", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, await authHeaders()),
      body: JSON.stringify({ order_id: orderId, status }),
    });
  } catch (e) { /* best-effort: l'email non deve bloccare il back office */ }
}

// Ristampa: accoda un nuovo job di stampa per l'ordine (la stampante lo prende al polling).
async function reprint(o) {
  const { error } = await sb.from("print_jobs").insert({ order_id: o.id });
  toast(error ? "Errore ristampa." : "In stampa…");
}

// ---------- date / calendario (prossimi 7 giorni, oggi incluso) ----------
const WD = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function maxAdvanceDays() { const n = Number(SETTINGS && SETTINGS.max_advance_days); return n >= 1 && n <= 15 ? n : 6; }
function next7() {   // oggi + max_advance_days (default 6)
  const out = [], t = new Date(); t.setHours(0, 0, 0, 0);
  const days = 1 + maxAdvanceDays();
  for (let i = 0; i < days; i++) { const d = new Date(t); d.setDate(t.getDate() + i); out.push(d); }
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
async function tryLogin() {
  const email = $("email").value.trim();
  const password = $("pw").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { toast("Accesso negato."); return; }
  unlockAudio(); ensureNotifyPermission();   // gesto utente: sblocca audio + chiede permesso notifiche
  enterApp();
}
function enterApp() {
  $("gate-wrap").classList.add("hidden");
  $("app").classList.remove("hidden");
  initApp();
}
async function logout() { await sb.auth.signOut(); location.reload(); }
$("pw-go").onclick = tryLogin;
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
$("email").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
document.getElementById("logout").addEventListener("click", logout);
async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) enterApp();
}
checkSession();
// Ricarica SOLO su logout/scadenza reale. NON su sessione nulla: l'evento INITIAL_SESSION
// per un utente non loggato ha session=null → reload su quello = loop infinito sul login.
sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.reload(); });

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
// TEST: annulla tutti gli ordini con consegna/ritiro prima di oggi (pulizia ordini test)
$("orders-purge-past").onclick = async () => {
  const today = ymd(new Date());
  if (!confirm("Annullare TUTTI gli ordini con consegna/ritiro prima di oggi (" + today + ")? Operazione di pulizia test.")) return;
  const { data, error } = await sb.from("orders").update({ status: "annullato" })
    .lt("delivery_date", today).neq("status", "annullato").select("id");
  if (error) { console.error(error); toast("Errore."); return; }
  toast((data ? data.length : 0) + " ordini passati annullati.");
  loadOrders();
};
// toggle provvisorio WhatsApp web (test)
$("wa-toggle").onclick = () => setWaWeb(!waWebEnabled());
updateWaToggleBtn();

// ---------- INIT ----------
async function initApp() {
  await Promise.all([loadOrders(), loadFlavors(), loadFormats(), loadSlots(), loadSettings(), loadDiscounts(), purgeOldSlotState()]);
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

// badge conteggio sui tab Ordini / Take away: solo ordini ATTIVI (COUNTED: ricevuto/accettato/in prep/in consegna) con consegna/ritiro oggi o futuri, per tipo
function updateTabBadges() {
  const today = ymd(new Date());
  const act = (pk) => ORDERS.filter((o) => (pk ? o.fulfillment === "pickup" : o.fulfillment !== "pickup") && COUNTED.has(o.status) && o.delivery_date >= today).length;
  const set = (id, n) => { const b = $(id); if (b) { b.textContent = n; b.classList.toggle("show", n > 0); } };
  set("badge-orders", act(false));
  set("badge-takeaway", act(true));
}

function renderOrders() {
  const DEL = ORDERS.filter((o) => o.fulfillment !== "pickup" && o.status !== "consegnato");   // Ordini = consegne non ancora evase (consegnati → Storico; ritiri → Take away)
  const today = ymd(new Date());
  $("orders-count").textContent = ORDERS.filter((o) => o.fulfillment !== "pickup" && COUNTED.has(o.status) && o.delivery_date >= today).length;   // solo attivi (ricevuto/accettato/in prep/in consegna) con consegna oggi o futura
  updateTabBadges();
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
// usato SOLO come fallback per ordini vecchi privi del campo peso_kg.
function formatGrams(name) {
  const m = String(name).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(",", "."));
  return m[2] === "kg" ? v * 1000 : v;
}
// nome cliente della vaschetta derivato dal peso in kg (es. 1 -> "Vaschetta 1Kg", 0.6 -> "Vaschetta 600g")
function vaschettaName(kg) {
  kg = Number(kg) || 0;
  if (kg <= 0) return "Vaschetta";
  if (kg < 1) return `Vaschetta ${Math.round(kg * 1000)}g`;
  const s = Number.isInteger(kg) ? String(kg) : String(kg).replace(".", ",");
  return `Vaschetta ${s}Kg`;
}
// peso item in grammi: campo esplicito peso_kg (nuovi ordini) con fallback al parse dal nome (ordini vecchi)
function itemGrams(it) { return (it.peso_kg != null) ? Number(it.peso_kg) * 1000 : formatGrams(it.format); }
// e' una vaschetta? category esplicita (nuovi ordini) con fallback al peso-da-nome (ordini vecchi)
function itemIsVaschetta(it) { return (it.category != null) ? (it.category === "vaschetta") : (formatGrams(it.format) > 0); }
// badge tipo ordine (consegna / take away)
function fulBadge(ful) {
  return ful === "pickup"
    ? '<span class="labful labful-pk">🏪 Take away</span>'
    : '<span class="labful labful-del">🛵 Consegna</span>';
}

function renderLab() {
  const wrap = $("lab-list");
  if (!wrap) return;
  const byDay = {};   // delivery_date -> { count, flavors:{nome:grammi}, vasche:{}, clients:[] }
  ORDERS.forEach((o) => {
    if (o.status !== "accettato" || !o.delivery_date) return;
    const d = byDay[o.delivery_date] || (byDay[o.delivery_date] = { count: 0, flavors: {}, vasche: {}, clients: [] });
    d.count++;
    const orderVasche = [];   // vaschette di QUESTO ordine (per la lista per-cliente)
    (o.items || []).forEach((it) => {
      const gusti = it.gusti || [], g = itemGrams(it);
      if (itemIsVaschetta(it)) {   // vaschetta: dettaglio per combinazione formato+gusti
        const key = it.format + "|" + gusti.join(",");
        const v = d.vasche[key] || (d.vasche[key] = { format: it.format, gusti, qty: 0 });
        v.qty += (it.qty || 1);
        orderVasche.push({ format: it.format, gusti, qty: it.qty || 1 });
      }
      if (!itemIsVaschetta(it) || !g || !gusti.length) return;  // non-vaschetta / senza gusti: niente kg
      const per = (g * (it.qty || 1)) / gusti.length;  // peso diviso per n. gusti
      gusti.forEach((n) => { d.flavors[n] = (d.flavors[n] || 0) + per; });
    });
    if (orderVasche.length) d.clients.push({ name: o.customer_name, fulfillment: o.fulfillment, vasche: orderVasche });
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
    const vasche = Object.values(info.vasche).sort((a, b) => b.qty - a.qty);
    const totVasche = vasche.reduce((s, v) => s + v.qty, 0);
    // BLOCCO SOTTO: vaschette da preparare (aggregato)
    const aggHtml = vasche.length
      ? vasche.map((v) => `<div class="vline"><span class="vq">${v.qty}×</span><span class="vn">${esc(v.format)}${v.gusti.length ? `<small>${esc(v.gusti.join(", "))}</small>` : ""}</span></div>`).join("")
      : '<p class="hint" style="margin:0">Nessuna vaschetta da preparare.</p>';
    // BLOCCO DX: vaschette per cliente (nominativo + tipo ordine + vaschetta/gusti)
    const clients = info.clients || [];
    const clientsHtml = clients.length
      ? clients.map((c) =>
          `<div class="labclient">` +
            `<div class="labclient-head"><span class="lc-name">${esc(c.name)}</span>${fulBadge(c.fulfillment)}</div>` +
            c.vasche.map((v) => `<div class="vline"><span class="vq">${v.qty}×</span><span class="vn">${esc(v.format)}${v.gusti.length ? `<small>${esc(v.gusti.join(", "))}</small>` : ""}</span></div>`).join("") +
          `</div>`
        ).join("")
      : '<p class="hint" style="margin:0">Nessuna vaschetta in questo giorno.</p>';
    const card = document.createElement("div");
    card.className = "labcard";
    card.innerHTML =
      `<div class="labhead"><span class="labday">${esc(dayName(dt, i))} ${dt.getDate()}/${dt.getMonth() + 1}</span>` +
      `<span class="count">${info.count} ordin${info.count === 1 ? "e" : "i"}</span></div>` +
      `<div class="labbody">` +
        // SX: chili per gusto + totale
        `<div class="labblock">` +
          `<div class="labsub">Chili per gusto</div>` +
          `<div class="kglist">${rows}</div>` +
          (flavs.length ? `<div class="kgtot"><span>Totale gelato</span><b>${kg(totKg)}</b></div>` : "") +
        `</div>` +
        // DX: vaschette per cliente
        `<div class="labblock">` +
          `<div class="labsub">Vaschette per cliente${clients.length ? " · " + clients.length : ""}</div>` +
          clientsHtml +
        `</div>` +
        // SOTTO: vaschette da preparare (aggregato), a tutta larghezza
        `<div class="labblock full">` +
          `<div class="labsub">Vaschette da preparare${vasche.length ? " · " + totVasche : ""}</div>` +
          aggHtml +
        `</div>` +
      `</div>`;
    wrap.appendChild(card);
  });
  if (!any) wrap.innerHTML = '<p class="hint">Nessun ordine accettato da preparare.</p>';
}

// ========== STORICO (ordini consegnati: economico + breakdown formato/gusto) ==========
function renderHistory() {
  const wrap = $("history-list");
  if (!wrap) return;
  const done = ORDERS.filter((o) => o.status === "consegnato");   // consegne a domicilio + ritiri take away (entrambi → "consegnato")
  wrap.innerHTML = "";
  if (!done.length) { wrap.innerHTML = '<p class="muted small">Nessun ordine completato.</p>'; return; }
  const nDom = done.filter((o) => o.fulfillment !== "pickup").length;   // a domicilio
  const nRit = done.length - nDom;                                       // ritiri take away

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
      const g = itemGrams(it), gusti = it.gusti || [], isVasca = itemIsVaschetta(it);
      gusti.forEach((n) => {
        const fl = byFlavor[n] || (byFlavor[n] = { qty: 0, grams: 0 });
        fl.qty += q;
        if (isVasca && g && gusti.length) fl.grams += (g * q) / gusti.length;
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
    `<div class="eco-row sep"><span>Ordini completati</span><b>${done.length}</b></div>` +
    `<div class="eco-row"><span>· a domicilio</span><span>${nDom}</span></div>` +
    `<div class="eco-row"><span>· ritiri (take away)</span><span>${nRit}</span></div>` +
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
    const tag = o.fulfillment === "pickup"
      ? '<span style="font-size:.64rem;font-weight:700;padding:1px 6px;border-radius:6px;background:#f3e7da;color:#a8552f;margin-left:6px">🏪 Ritiro</span>'
      : '<span style="font-size:.64rem;font-weight:700;padding:1px 6px;border-radius:6px;background:#e7f0e7;color:#2f6f3f;margin-left:6px">🛵 Consegna</span>';
    return `<div class="brk hxrow" data-oid="${esc(o.id)}" role="button" tabindex="0" title="Vedi dettaglio completo" style="cursor:pointer"><div class="bn">${esc(o.customer_name)}${tag}<small>${esc(when)} · ${esc(cons)} · ${esc(o.slot_label || "-")}</small></div><div class="bv">${euro(o.total)} ›</div></div>`;
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
    `<p class="eyebrow muted">Ordini completati <span class="muted" style="font-weight:400">(consegne + ritiri)</span></p><div style="height:10px"></div><div class="panel">${orders}</div>`;

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
// OSRM Table: matrice durate (sec) tra tutti i punti. coords [[lat,lng],...]. Cache.
function osrmTable(coords) {
  const key = "T" + coords.map((c) => c[0].toFixed(5) + "," + c[1].toFixed(5)).join(";");
  if (!TRIP_CACHE[key]) {
    TRIP_CACHE[key] = (async () => {
      try {
        const path = coords.map((c) => c[1] + "," + c[0]).join(";");   // OSRM vuole lng,lat
        const u = `https://router.project-osrm.org/table/v1/driving/${path}?annotations=duration`;
        const d = await (await fetch(u)).json();
        if (d.code !== "Ok" || !d.durations) return { err: true };
        return { dur: d.durations };
      } catch (e) { return { err: true }; }
    })();
  }
  return TRIP_CACHE[key];
}

// OSRM Route su waypoint GIÀ ordinati: geometria reale + legs (per la polyline). coords [[lat,lng],...].
function osrmRoute(coords) {
  const key = "R" + coords.map((c) => c[0].toFixed(5) + "," + c[1].toFixed(5)).join(";");
  if (!TRIP_CACHE[key]) {
    TRIP_CACHE[key] = (async () => {
      try {
        const path = coords.map((c) => c[1] + "," + c[0]).join(";");
        const u = `https://router.project-osrm.org/route/v1/driving/${path}?geometries=geojson&overview=full`;
        const d = await (await fetch(u)).json();
        if (d.code !== "Ok" || !d.routes || !d.routes[0]) return { err: true };
        return { geometry: d.routes[0].geometry.coordinates, legs: d.routes[0].legs };
      } catch (e) { return { err: true }; }
    })();
  }
  return TRIP_CACHE[key];
}

// TSP sulla matrice durate (0=gelateria, 1..n=consegne). roundtrip = include il rientro.
// Esatto per n<=8 (brute force), euristico (nearest-neighbor + 2-opt) oltre.
// Tie-break tra ordini di pari costo: parte dalla consegna più vicina alla gelateria (display intuitivo).
function solveOrder(dur, n, roundtrip) {
  const cost = (perm) => {
    let t = dur[0][perm[0]];
    for (let k = 0; k < perm.length - 1; k++) t += dur[perm[k]][perm[k + 1]];
    if (roundtrip) t += dur[perm[perm.length - 1]][0];
    return t;
  };
  let best = null, bestCost = Infinity;
  const consider = (perm) => {
    const c = cost(perm);
    if (c < bestCost - 1e-6) { bestCost = c; best = perm.slice(); }
    else if (Math.abs(c - bestCost) < 1e-6 && best && dur[0][perm[0]] < dur[0][best[0]]) best = perm.slice();
  };
  const idx = []; for (let i = 1; i <= n; i++) idx.push(i);
  if (n <= 8) {
    const permute = (arr, m) => { if (!arr.length) { consider(m); return; } for (let i = 0; i < arr.length; i++) permute(arr.slice(0, i).concat(arr.slice(i + 1)), m.concat(arr[i])); };
    permute(idx, []);
  } else {
    let cur = 0; const left = idx.slice(); let tour = [];
    while (left.length) { left.sort((a, b) => dur[cur][a] - dur[cur][b]); const nx = left.shift(); tour.push(nx); cur = nx; }
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < tour.length - 1; i++) for (let j = i + 1; j < tour.length; j++) {
        const a = tour.slice(); const seg = a.slice(i, j + 1).reverse(); a.splice(i, seg.length, ...seg);
        if (cost(a) < cost(tour) - 1e-6) { tour = a; improved = true; }
      }
    }
    best = tour;
  }
  return best.map((i) => i - 1);   // 0-based negli `orders`
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
  const pts = orders.map((o) => [o.delivery_lat, o.delivery_lng]);
  const coords = [[GELATERIA.lat, GELATERIA.lng]].concat(pts);
  const listEl = $(mapId + "-list"), totEl = $(mapId + "-tot");
  if (!listEl) return;

  const tab = await osrmTable(coords);
  if (tab.err) {   // fallback: ordina per distanza stradale crescente, mappa con soli marker
    const routes = await Promise.all(orders.map((o) => getRoute(o.delivery_lat, o.delivery_lng)));
    const arr = orders.map((o, i) => ({ o, km: (routes[i] && !routes[i].err) ? routes[i].km : Infinity }))
      .sort((a, b) => a.km - b.km).map((x, i) => ({ o: x.o, n: i + 1 }));
    listEl.innerHTML = numberedRows(arr, '<p class="hint" style="margin:0 0 8px">Percorso ottimale non disponibile (riprova tra poco). Ordine per distanza stradale.</p>');
    addMapsBtn(listEl, arr.map((x) => x.o));
    if (totEl) totEl.textContent = "percorso n/d";
    drawConsegneMap(mapId, arr.map((x) => x.o), null);
    return;
  }

  // ordine ottimale: minor TEMPO TOTALE del giro (roundtrip), partendo dal più vicino tra i pari-ottimo
  const order = solveOrder(tab.dur, orders.length, true);
  const ordered = order.map((i) => orders[i]);
  // tempi di guida cumulati dalla matrice (0 = gelateria)
  const seqI = [0].concat(order.map((i) => i + 1));
  const legSec = []; for (let k = 0; k < seqI.length - 1; k++) legSec.push(tab.dur[seqI[k]][seqI[k + 1]]);
  let acc = 0;
  const rows = ordered.map((o, idx) => { acc += legSec[idx]; return { o, n: idx + 1, cum: acc, leg: legSec[idx] }; });
  listEl.innerHTML = numberedRows(rows, null);
  addMapsBtn(listEl, ordered);
  const totSec = acc + tab.dur[seqI[seqI.length - 1]][0];   // + rientro in gelateria

  // geometria reale del percorso ordinato (polyline) + km totali
  const routeCoords = [[GELATERIA.lat, GELATERIA.lng]].concat(order.map((i) => pts[i])).concat([[GELATERIA.lat, GELATERIA.lng]]);
  const route = await osrmRoute(routeCoords);
  let geometry = null, totDist = null;
  if (!route.err) { geometry = route.geometry; totDist = route.legs.reduce((s, l) => s + (l.distance || 0), 0); }
  if (totEl) totEl.textContent = `${totDist != null ? fmtKm(totDist) + " · " : ""}${fmtMin(totSec)} (incl. rientro)`;
  drawConsegneMap(mapId, ordered, geometry);
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

// URL Google Maps Directions col giro già ordinato e a ROUND-TRIP (coerente con
// la polyline e con "incl. rientro"): origine = destinazione = gelateria, tutte
// le consegne sono waypoint in ordine. Tappe consecutive con coordinate identiche
// (es. due clienti allo stesso indirizzo) collassate in una: il waypoint duplicato
// rompe il routing di Google.
function googleMapsRoute(ordered) {
  if (!ordered || !ordered.length) return null;
  const enc = (s) => encodeURIComponent(s);
  const pt = (o) => o.delivery_lat + "," + o.delivery_lng;
  const base = GELATERIA.lat + "," + GELATERIA.lng;
  let waypoints = ordered.map(pt).filter((p, i, a) => i === 0 || p !== a[i - 1]);
  waypoints = waypoints.filter((p) => p !== base);   // rimuovi tappa che coincide con la gelateria
  let u = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + enc(base) + "&destination=" + enc(base);
  if (waypoints.length) u += "&waypoints=" + waypoints.map(enc).join("|");
  return u;
}
// bottone "Apri il giro su Google Maps" subito dopo la lista tappe della fascia
function addMapsBtn(listEl, ordered) {
  if (!listEl || !ordered || !ordered.length) return;
  const url = googleMapsRoute(ordered); if (!url) return;
  const btn = document.createElement("a");
  btn.className = "btn sm"; btn.href = url; btn.target = "_blank"; btn.rel = "noopener";
  btn.style.cssText = "display:inline-flex;align-items:center;gap:7px;margin-top:10px";
  btn.textContent = "🧭 Apri il giro su Google Maps";
  listEl.insertAdjacentElement("afterend", btn);
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
    `${o.coupon_code ? `<br><span class="k">Sconto</span> ${esc(o.coupon_code)} (−${euro(o.discount)})` : ""}` +
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
  const printRow = document.createElement("div"); printRow.className = "actrow";
  printRow.append(mkBtn("🖨️ Ristampa", "btn ghost sm", () => reprint(o)));
  box.append(printRow);
  const st = o.status;
  if (TERMINAL.has(st)) return;   // consegnato / rifiutato / annullato: solo ristampa

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
  if (!paid) { changeStatus(o, status); sendOrderEmail(o.id, status); return; }
  const res = await fetch("/.netlify/functions/refund", {
    method: "POST", headers: Object.assign({ "content-type": "application/json" }, await authHeaders()),
    body: JSON.stringify({ order_id: o.id, status }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) { toast((data && data.error) || "Errore rimborso."); return; }
  const i = ORDERS.findIndex((x) => x.id === o.id);
  if (i >= 0) { ORDERS[i].status = status; ORDERS[i].refunded_at = data.refunded_at || new Date().toISOString(); }
  renderOrders();
  sendOrderEmail(o.id, status);
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

// ========== RIORDINO DRAG (maniglia ⠿, pointer events: desktop + touch) ==========
// Trascinando la .drag-handle si riordinano le righe; al rilascio si scrive
// sort_order sequenziale (onCommit riceve gli id nel nuovo ordine del container).
function enableDragSort(container, handleSel, rowSel, onCommit) {
  const ids = () => [...container.querySelectorAll(rowSel)].map((r) => r.dataset.id);
  container.querySelectorAll(handleSel).forEach((h) => {
    h.style.touchAction = "none";
    h.addEventListener("pointerdown", (e) => startDrag(e, h));
  });
  function startDrag(e, h) {
    const row = h.closest(rowSel);
    if (!row) return;
    e.preventDefault();
    const startY = e.clientY, pid = e.pointerId, before = ids();
    let lifted = false, ph = null, oy = 0, ox = 0, w = 0;
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      if (!lifted) {
        if (Math.abs(dy) < 4) return;          // soglia: evita lift su click
        const r = row.getBoundingClientRect();
        oy = r.top; ox = r.left; w = r.width;
        ph = document.createElement("div");
        ph.className = "drag-ph"; ph.style.height = r.height + "px";
        row.parentNode.insertBefore(ph, row.nextSibling);
        row.classList.add("dragging");
        row.style.position = "fixed"; row.style.left = ox + "px";
        row.style.width = w + "px"; row.style.zIndex = "60"; row.style.pointerEvents = "none";
        lifted = true;
      }
      row.style.top = (oy + dy) + "px";
      const sibs = [...container.querySelectorAll(rowSel)].filter((s) => s !== row);
      let placed = false;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { s.parentNode.insertBefore(ph, s); placed = true; break; }
      }
      if (!placed && sibs.length) sibs[sibs.length - 1].after(ph);
    };
    const onUp = () => {
      h.removeEventListener("pointermove", onMove);
      h.removeEventListener("pointerup", onUp);
      h.removeEventListener("pointercancel", onUp);
      try { h.releasePointerCapture(pid); } catch (_) {}
      if (lifted) {
        row.classList.remove("dragging");
        row.removeAttribute("style");          // pulisce gli inline del drag
        ph.parentNode.insertBefore(row, ph);
        ph.remove();
      }
      if (lifted && JSON.stringify(before) !== JSON.stringify(ids())) onCommit(ids());
    };
    try { h.setPointerCapture(pid); } catch (_) {}
    h.addEventListener("pointermove", onMove);
    h.addEventListener("pointerup", onUp);
    h.addEventListener("pointercancel", onUp);
  }
}
async function persistOrder(table, orderedIds, col = "sort_order") {
  await Promise.all(orderedIds.map((id, i) => sb.from(table).update({ [col]: i + 1 }).eq("id", id)));
}
// sort_order del nuovo item = max corrente + 1 (sempre in fondo, monotono;
// coerente col renumber 1..N del drag — niente wrap come Date.now()%100000)
async function nextSortOrder(table, col = "sort_order") {
  const { data } = await sb.from(table).select(col).order(col, { ascending: false }).limit(1);
  return ((data && data[0] && data[0][col]) || 0) + 1;
}

// ========== GUSTI ==========
let FLAVORS_ALL = [];
const FLAVOR_FILTER = { special: false, daily: false };   // filtri in alto (★ speciali, ☀ del giorno)
function paintFlavorFilters() {
  const fs = $("filter-special"), fd = $("filter-daily");
  if (fs) { fs.classList.toggle("on", FLAVOR_FILTER.special); fs.textContent = FLAVOR_FILTER.special ? "★" : "☆"; }
  if (fd) fd.classList.toggle("on", FLAVOR_FILTER.daily);
}
async function loadFlavors() {
  const { data, error } = await sb.from("flavors").select("*").order("sort_order");
  if (error) { console.error(error); return; }
  FLAVORS_ALL = data || [];
  renderFlavorsList();
  renderProduzione();
  backfillFlavorEn();   // traduci in autonomia l'EN mancante dei gusti del giorno (best-effort, async)
}

// Traduce IT→EN una microdescrizione gusto (Haiku, riusa translate-home). Ritorna stringa EN o null.
async function translateFlavorDesc(itText) {
  const txt = (itText || "").trim();
  if (!txt) return null;
  try {
    const r = await fetch("/.netlify/functions/translate-home", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN_UPLOAD_TOKEN },
      body: JSON.stringify({ it: { d: txt } }),
    });
    const d = await r.json().catch(() => ({}));
    const en = d && d.en && d.en.d;
    return (r.ok && typeof en === "string" && en.trim()) ? en.trim() : null;
  } catch (e) { return null; }
}

// Backfill una-tantum: traduce l'EN mancante dei gusti del giorno che hanno la descrizione IT.
const _flavorEnTried = new Set();   // evita ritentativi a raffica nella stessa sessione
async function backfillFlavorEn() {
  const todo = FLAVORS_ALL.filter((f) =>
    f.daily && f.description && f.description.trim() &&
    !(f.description_en && f.description_en.trim()) && !_flavorEnTried.has(f.id)
  );
  if (!todo.length) return;
  let changed = false;
  for (const f of todo) {
    _flavorEnTried.add(f.id);
    const en = await translateFlavorDesc(f.description);
    if (!en) continue;
    const { error } = await sb.from("flavors").update({ description_en: en }).eq("id", f.id);
    if (error) { console.error("backfill EN gusto:", error.message); continue; }
    f.description_en = en; changed = true;   // aggiorna in memoria
  }
  if (changed) renderFlavorsList();
}
function renderFlavorsList() {
  const list = $("flavors-list");
  list.innerHTML = "";
  const filtering = FLAVOR_FILTER.special || FLAVOR_FILTER.daily;
  list.classList.toggle("filtering", filtering);   // il riordino drag è disattivato col filtro
  const rows = FLAVORS_ALL.filter((f) => (!FLAVOR_FILTER.special || f.special) && (!FLAVOR_FILTER.daily || f.daily));
  if (!rows.length) {
    list.innerHTML = '<p class="muted small" style="margin:0;padding:6px 2px">Nessun gusto con questo filtro.</p>';
    return;
  }
  rows.forEach((f) => list.appendChild(buildFlavorRow(f)));
  if (!filtering) enableDragSort(list, ".drag-handle", ".frow", (orderedIds) => persistOrder("flavors", orderedIds));
}
function buildFlavorRow(f) {
  const frow = document.createElement("div");
  frow.className = "frow"; frow.dataset.id = f.id;
  const el = document.createElement("div");
  el.className = "mrow";
  el.innerHTML =
    `<span class="drag-handle" title="Trascina per ordinare">⠿</span>` +
    `<input class="g-name grow" value="${esc(f.name)}">` +
    `<button class="star-btn" type="button" aria-label="Gusto speciale" title="Gusto speciale">☆</button>` +
    `<button class="daily-btn" type="button" aria-label="Gusto del giorno" title="Gusto del giorno (mostrato in home)">☀</button>` +
    availRadios("fl-" + f.id, f.available) +
    `<button class="btn icon">✕</button>`;
  const name = el.querySelector(".g-name");
  name.onchange = () => updateRow("flavors", f.id, { name: name.value.trim() });
  const star = el.querySelector(".star-btn");
  let special = !!f.special;
  const paintStar = () => { star.classList.toggle("on", special); star.textContent = special ? "★" : "☆"; };
  paintStar();
  const dailyBtn = el.querySelector(".daily-btn");
  let daily = !!f.daily;
  const paintDaily = () => dailyBtn.classList.toggle("on", daily);
  paintDaily();
  wireAvailRadios(el, (val) => updateRow("flavors", f.id, { available: val }));
  el.querySelector(".btn.icon").onclick = async () => { await delRow("flavors", f.id); loadFlavors(); };
  frow.appendChild(el);
  // microdescrizioni (home) — visibili quando "gusto del giorno" è attivo: IT + EN
  const desc = document.createElement("input");
  desc.className = "g-desc";
  desc.placeholder = "Microdescrizione IT (es. tostato)";
  desc.value = f.description || "";
  desc.style.display = daily ? "" : "none";
  frow.appendChild(desc);
  const descEn = document.createElement("input");
  descEn.className = "g-desc g-desc-en";
  descEn.placeholder = "Microdescrizione EN (es. toasted)";
  descEn.value = f.description_en || "";
  descEn.style.display = daily ? "" : "none";
  descEn.onchange = () => updateRow("flavors", f.id, { description_en: descEn.value.trim() || null });
  frow.appendChild(descEn);
  // traduce IT→EN nel campo EN (se vuoto) in autonomia
  async function fillEnFrom(itText) {
    const ph = descEn.placeholder;
    descEn.placeholder = "Traduco…"; descEn.disabled = true;
    const en = await translateFlavorDesc(itText);
    descEn.disabled = false; descEn.placeholder = ph;
    if (!en) return;
    await updateRow("flavors", f.id, { description_en: en });
    f.description_en = en;
    if (descEn.isConnected) descEn.value = en; else renderFlavorsList();
    toast("Descrizione EN tradotta in automatico.");
  }
  desc.onchange = async () => {
    const it = desc.value.trim() || null;
    await updateRow("flavors", f.id, { description: it });
    f.description = it;
    if (it && daily && !descEn.value.trim()) await fillEnFrom(it);   // EN mancante → auto-traduci
  };
  star.onclick = () => {
    special = !special; f.special = special; paintStar();
    updateRow("flavors", f.id, { special });
    if (FLAVOR_FILTER.special || FLAVOR_FILTER.daily) renderFlavorsList();   // esce dalla vista filtrata se non combacia più
  };
  dailyBtn.onclick = () => {
    daily = !daily; f.daily = daily; paintDaily();
    desc.style.display = daily ? "" : "none";
    descEn.style.display = daily ? "" : "none";
    if (daily) desc.focus();
    updateRow("flavors", f.id, { daily });
    if (daily && desc.value.trim() && !descEn.value.trim()) fillEnFrom(desc.value.trim());   // EN mancante → auto-traduci
    if (FLAVOR_FILTER.special || FLAVOR_FILTER.daily) renderFlavorsList();
  };
  return frow;
}
// filtri in alto
if ($("filter-special")) $("filter-special").onclick = () => { FLAVOR_FILTER.special = !FLAVOR_FILTER.special; paintFlavorFilters(); renderFlavorsList(); };
if ($("filter-daily")) $("filter-daily").onclick = () => { FLAVOR_FILTER.daily = !FLAVOR_FILTER.daily; paintFlavorFilters(); renderFlavorsList(); };
paintFlavorFilters();
$("nf-add").onclick = async () => {
  const name = $("nf-name").value.trim(); if (!name) return;
  const order = await nextSortOrder("flavors");
  const prodOrder = await nextSortOrder("flavors", "prod_order");   // nuovo gusto → in fondo anche in Produzione
  await sb.from("flavors").insert({ name, sort_order: order, prod_order: prodOrder });
  $("nf-name").value = "";
  FLAVOR_FILTER.special = false; FLAVOR_FILTER.daily = false; paintFlavorFilters();   // mostra il nuovo gusto
  loadFlavors();
};

// ========== PRODUZIONE ==========
function updateProdStats() {
  const on = FLAVORS_ALL.filter((f) => f.prod_on);
  const tot = on.reduce((s, f) => s + (Number(f.prod_kg) || 0), 0);
  const el = $("prod-stats"); if (el) el.textContent = on.length + " accesi · " + tot + " kg";
  const btn = $("prod-print"); if (btn) btn.disabled = on.length === 0;
}
function buildProdRow(f) {
  const el = document.createElement("div");
  el.className = "prow"; el.dataset.id = f.id;
  el.innerHTML =
    `<span class="drag-handle" title="Trascina per ordinare">⠿</span>` +
    `<span class="pname">${esc(f.name)}</span>` +
    availRadios("prod", !!f.prod_on, "Produci", "Spento") +
    `<div class="kgstep">` +
      `<button type="button" class="kg-dec" aria-label="meno">−</button>` +
      `<span class="kg-val">${Number(f.prod_kg) || 3}</span>` +
      `<button type="button" class="kg-inc" aria-label="più">+</button>` +
      `<span class="kg-unit">kg</span>` +
    `</div>`;
  // toggle prod_on
  wireAvailRadios(el, (on) => { f.prod_on = on; updateRow("flavors", f.id, { prod_on: on }); updateProdStats(); });
  // stepper kg (clamp 1..8)
  const valEl = el.querySelector(".kg-val");
  const setKg = (n) => {
    const v = Math.min(8, Math.max(1, n));
    f.prod_kg = v; valEl.textContent = String(v);
    updateRow("flavors", f.id, { prod_kg: v });
    updateProdStats();
  };
  el.querySelector(".kg-dec").onclick = () => setKg((Number(f.prod_kg) || 3) - 1);
  el.querySelector(".kg-inc").onclick = () => setKg((Number(f.prod_kg) || 3) + 1);
  return el;
}
function renderProduzione() {
  const list = $("prod-list");
  if (!list) return;
  list.innerHTML = "";
  const rows = [...FLAVORS_ALL].sort((a, b) => (a.prod_order || 0) - (b.prod_order || 0) || a.name.localeCompare(b.name));
  rows.forEach((f) => list.appendChild(buildProdRow(f)));
  enableDragSort(list, ".drag-handle", ".prow", (ids) => {
    ids.forEach((id, i) => { const f = FLAVORS_ALL.find((x) => x.id === id); if (f) f.prod_order = i + 1; });
    persistOrder("flavors", ids, "prod_order");
  });
  updateProdStats();
}
$("prod-print").onclick = async () => {
  const list = [...FLAVORS_ALL]
    .filter((f) => f.prod_on)
    .sort((a, b) => (a.prod_order || 0) - (b.prod_order || 0))
    .map((f) => ({ name: f.name, kg: Number(f.prod_kg) || 3 }));
  if (!list.length) { toast("Nessun gusto acceso."); return; }
  const { error } = await withAuthRetry(() => sb.from("print_jobs").insert({ kind: "production", payload: list }));
  if (error) console.error("stampa print_jobs", error);
  toast(error ? "Errore stampa." : "Inviato in stampa…");
};
// Reset produzione: spegne tutti i gusti e riporta i kg a 3 (default).
$("prod-reset").onclick = async () => {
  if (!confirm("Reset produzione: spegne TUTTI i gusti e riporta i kg a 3. Procedere?")) return;
  const { error } = await withAuthRetry(() => sb.from("flavors").update({ prod_on: false, prod_kg: 3 }).not("id", "is", null));
  if (error) { console.error("reset produzione", error); toast("Errore reset."); return; }
  FLAVORS_ALL.forEach((f) => { f.prod_on = false; f.prod_kg = 3; });
  renderProduzione();
  toast("Produzione resettata.");
};

// ========== PRODOTTI (ex Formati) — due categorie: Vaschette / Altri prodotti ==========
const FORMAT_CATS = [
  { key: "vaschetta", label: "Vaschette" },
  { key: "altro", label: "Altri prodotti" },
];
// category null -> vaschetta (default migration); qualsiasi valore inatteso ->
// altro, così nessun prodotto sparisce da back office e cliente.
const normFmtCat = (f) => ((f.category || "vaschetta") === "vaschetta" ? "vaschetta" : "altro");
function buildFormatCard(f) {
  const el = document.createElement("div");
  el.className = "fmt-card"; el.dataset.id = f.id;
  const cur = normFmtCat(f);
  const isV = cur === "vaschetta";
  const catOpts = FORMAT_CATS.map((c) => `<option value="${c.key}"${cur === c.key ? " selected" : ""}>${esc(c.label)}</option>`).join("");
  // vaschetta: titolo auto-derivato dal peso (no input nome); altro: nome libero
  const topInner = isV
    ? `<span class="f-title">${esc(f.name || vaschettaName(f.weight_kg))}</span>`
    : `<input class="f-name grow" value="${esc(f.name)}">`;
  const body = isV
    ? `<div class="grid2">` +
        `<div class="field" style="margin:0"><label>Categoria</label><div class="select-wrap"><select class="f-cat">${catOpts}</select></div></div>` +
        `<div class="field" style="margin:0"><label>Peso (kg)</label><input class="f-weight" type="number" min="0" step="0.1" value="${f.weight_kg != null ? f.weight_kg : ""}" placeholder="es. 1"></div>` +
      `</div>` +
      `<div class="grid2">` +
        `<div class="field" style="margin:0"><label>Gusti max</label><input class="f-max" type="number" min="0" value="${f.max_flavors}"></div>` +
        `<div class="field" style="margin:0"><label>Prezzo €</label><input class="f-price" type="number" min="0" step="0.50" value="${f.price}"></div>` +
      `</div>`
    : `<div class="grid2">` +
        `<div class="field" style="margin:0"><label>Categoria</label><div class="select-wrap"><select class="f-cat">${catOpts}</select></div></div>` +
        `<div class="field" style="margin:0"><label>Gusti max</label><input class="f-max" type="number" min="0" value="${f.max_flavors}"></div>` +
      `</div>` +
      `<div class="field" style="margin:0"><label>Prezzo €</label><input class="f-price" type="number" min="0" step="0.50" value="${f.price}"></div>`;
  el.innerHTML =
    `<div class="fmt-card-top"><span class="drag-handle" title="Trascina per ordinare">⠿</span>${topInner}</div>` +
    body +
    `<div class="foot">` + availRadios("fo-" + f.id, f.available) + `<button class="btn icon" style="width:auto;padding:8px 14px">Elimina</button></div>`;
  const max = el.querySelector(".f-max"), price = el.querySelector(".f-price"), cat = el.querySelector(".f-cat");
  const del = el.querySelector(".foot .btn.icon");
  max.onchange = () => updateRow("formats", f.id, { max_flavors: parseInt(max.value || "0", 10) });
  price.onchange = () => updateRow("formats", f.id, { price: parseFloat(price.value || "0") });
  if (isV) {
    const w = el.querySelector(".f-weight");
    w.onchange = async () => {
      const kg = parseFloat(w.value || "0") || 0;
      await updateRow("formats", f.id, { weight_kg: kg > 0 ? kg : null, name: vaschettaName(kg) });
      loadFormats();   // aggiorna il titolo derivato dal peso
    };
  } else {
    const name = el.querySelector(".f-name");
    name.onchange = () => updateRow("formats", f.id, { name: name.value.trim() });
  }
  cat.onchange = async () => {
    const patch = { category: cat.value };
    if (cat.value === "vaschetta" && f.weight_kg != null) patch.name = vaschettaName(f.weight_kg);
    if (cat.value === "altro") patch.weight_kg = null;
    await updateRow("formats", f.id, patch); loadFormats();
  };
  wireAvailRadios(el, (val) => updateRow("formats", f.id, { available: val }));
  del.onclick = async () => { await delRow("formats", f.id); loadFormats(); };
  return el;
}
// renumber globale (vaschette poi altri, ordine DOM) dopo un drag in una categoria
function persistFormatsOrder() {
  const ids = [...$("formats-list").querySelectorAll(".fmt-card")].map((c) => c.dataset.id);
  return persistOrder("formats", ids);
}
async function loadFormats() {
  const { data, error } = await sb.from("formats").select("*").order("sort_order");
  if (error) { console.error(error); return; }
  const root = $("formats-list");
  root.innerHTML = "";
  FORMAT_CATS.forEach((c) => {
    const rows = data.filter((f) => normFmtCat(f) === c.key);
    const group = document.createElement("div");
    group.className = "fmt-group"; group.dataset.cat = c.key;
    group.innerHTML = `<p class="fmt-cat-head">${esc(c.label)}</p>`;
    const listEl = document.createElement("div");
    listEl.className = "fmt-list stack";
    if (!rows.length) listEl.innerHTML = `<p class="muted small" style="margin:0;padding:2px 0">Nessun prodotto.</p>`;
    rows.forEach((f) => listEl.appendChild(buildFormatCard(f)));
    group.appendChild(listEl);
    root.appendChild(group);
    enableDragSort(listEl, ".drag-handle", ".fmt-card", () => persistFormatsOrder());
  });
}
$("nfo-add").onclick = async () => {
  const cat = $("nfo-cat").value;
  let name, weight_kg = null;
  if (cat === "vaschetta") {
    weight_kg = parseFloat($("nfo-weight").value || "0") || 0;
    if (weight_kg <= 0) { toast("Inserisci il peso della vaschetta (kg)."); return; }
    name = vaschettaName(weight_kg);              // nome derivato dal peso
  } else {
    name = $("nfo-name").value.trim();
    if (!name) { toast("Inserisci il nome del prodotto."); return; }
  }
  const order = await nextSortOrder("formats");
  await sb.from("formats").insert({
    name, category: cat, weight_kg,
    max_flavors: parseInt($("nfo-max").value || "0", 10),
    price: parseFloat($("nfo-price").value || "0"),
    sort_order: order,
  });
  $("nfo-name").value = ""; $("nfo-weight").value = ""; $("nfo-max").value = 1; $("nfo-price").value = 0;
  loadFormats();
};
// create form: vaschetta -> campo Peso; altro -> campo Nome
function syncNewProductFields() {
  const isV = $("nfo-cat").value === "vaschetta";
  $("nfo-weight-field").style.display = isV ? "" : "none";
  $("nfo-name-field").style.display = isV ? "none" : "";
}
$("nfo-cat").onchange = syncNewProductFields;
syncNewProductFields();

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
  $("set-lead").value = data.slot_lead_hours != null ? data.slot_lead_hours : 2;
  $("set-maxdays").value = data.max_advance_days != null ? data.max_advance_days : 6;
  $("set-cancel-lead").value = data.cancel_lead_hours != null ? data.cancel_lead_hours : 2;
  const t = waTemplates();
  WA_STATUSES.forEach((s) => { const el = $("wa-" + STATUS_META[s].slug); if (el) el.value = t[s] || ""; });
  renderOpeningHoursEditor();
  // applica i giorni max prenotabili ai calendari (Fasce + barra giorni Ordini)
  SLOT_DAYS = next7();
  if (!SLOT_DAYS.some((d) => ymd(d) === SELECTED_DAY)) SELECTED_DAY = ymd(SLOT_DAYS[0]);
  renderCal(); renderOrders();
  loadHomeContent();
}
$("set-save").onclick = async () => {
  let cl = parseInt($("set-cancel-lead").value || "2", 10);
  if (!(cl >= 0)) cl = 0; if (cl > 24) cl = 24;
  $("set-cancel-lead").value = cl;
  const { error } = await sb.from("settings").update({
    delivery_cost: parseFloat($("set-delivery").value || "0"),
    min_order: parseFloat($("set-min").value || "0"),
    cancel_lead_hours: cl,
  }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio."); return; }
  SETTINGS.cancel_lead_hours = cl;
  toast("Parametri salvati.");
};
// Tempo di anticipo da inizio fascia (ore, 1..6): auto-save
$("set-lead").onchange = async () => {
  let h = parseInt($("set-lead").value || "2", 10);
  if (!(h >= 1)) h = 1; if (h > 6) h = 6;
  $("set-lead").value = h;
  const { error } = await sb.from("settings").update({ slot_lead_hours: h }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio."); return; }
  SETTINGS.slot_lead_hours = h;
  toast("Tempo di anticipo salvato.");
};
// Giorni max prenotabili in futuro (1..15): auto-save + rigenera i calendari
$("set-maxdays").onchange = async () => {
  let n = parseInt($("set-maxdays").value || "6", 10);
  if (!(n >= 1)) n = 1; if (n > 15) n = 15;
  $("set-maxdays").value = n;
  const { error } = await sb.from("settings").update({ max_advance_days: n }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio."); return; }
  SETTINGS.max_advance_days = n;
  SLOT_DAYS = next7();
  if (!SLOT_DAYS.some((d) => ymd(d) === SELECTED_DAY)) SELECTED_DAY = ymd(SLOT_DAYS[0]);
  renderCal(); renderOrders();
  toast("Giorni max prenotabili salvati.");
};

// ========== HOMEPAGE (editor contenuti) ==========
// chiavi = stesse di i18n.js (home.*); il default IT viene dal dizionario (I18N.t).
const HOME_FIELDS = [
  { key: "home.hero.eyebrow", label: "Hero — sopratitolo", type: "text" },
  { key: "home.hero.title", label: "Hero — titolo (HTML: <br> <em>)", type: "area", manualEn: true },
  { key: "home.story.eyebrow", label: "Storia — sopratitolo", type: "text" },
  { key: "home.story.lede", label: "Storia — frase principale (HTML: <em>)", type: "area", manualEn: true },
  { key: "home.story.body", label: "Storia — testo", type: "area", manualEn: true },
  { key: "home.delivery.eyebrow", label: "Consegna — sopratitolo", type: "text" },
  { key: "home.delivery.title", label: "Consegna — titolo", type: "text" },
  { key: "home.delivery.body", label: "Consegna — testo (HTML: <strong>)", type: "area", manualEn: true },
  { key: "home.delivery.link", label: "Consegna — link zone", type: "text" },
  { key: "home.carousel.title", label: "Carosello — titolo", type: "text" },
  { key: "home.carousel.slide1.title", label: "Slide 1 — titolo", type: "text" },
  { key: "home.carousel.slide1.caption", label: "Slide 1 — didascalia", type: "text" },
  { key: "home.carousel.slide2.title", label: "Slide 2 — titolo", type: "text" },
  { key: "home.carousel.slide2.caption", label: "Slide 2 — didascalia", type: "text" },
  { key: "home.carousel.slide3.title", label: "Slide 3 — titolo", type: "text" },
  { key: "home.carousel.slide3.caption", label: "Slide 3 — didascalia", type: "text" },
  { key: "home.carousel.slide4.title", label: "Slide 4 — titolo", type: "text" },
  { key: "home.carousel.slide4.caption", label: "Slide 4 — didascalia", type: "text" },
  { key: "home.daily.intro", label: "Gusti del giorno — intro", type: "text" },
  { key: "home.cta.button", label: "CTA — bottone", type: "text" },
  { key: "home.cta.note", label: "CTA — nota", type: "text" },
  { key: "footer.nap", label: "Footer — testo su tutte le pagine (HTML: <strong> <a href>)", type: "area", manualEn: true },
];
const HOME_OPS = [
  { key: "location", label: "Luogo (card \"Dove siamo\")", ph: "Monte Petrosu" },
  { key: "maps_url", label: "Link Google Maps", ph: "https://maps.app.goo.gl/…" },
  { key: "whatsapp", label: "Numero WhatsApp (internazionale, senza +)", ph: "39333…" },
];
const HOME_MEDIA = [
  { key: "hero", label: "Immagine hero" },
  { key: "slide1", label: "Carosello — slide 1" }, { key: "slide2", label: "Carosello — slide 2" },
  { key: "slide3", label: "Carosello — slide 3" }, { key: "slide4", label: "Carosello — slide 4" },
];
let HOME_CONTENT = { it: {}, en: {}, ops: {}, media: {} };
const homeDefault = (key) => (window.I18N ? I18N.t(key) : "") || "";
// default EN dal dizionario (admin è pinnato IT: leggo EN temporaneamente)
const homeDefaultEn = (key) => {
  if (!window.I18N) return "";
  const cur = I18N.lang(); I18N.setLang("en", false);
  const v = I18N.t(key); I18N.setLang(cur, false);
  return v || "";
};
const HOME_MANUAL_EN = new Set(HOME_FIELDS.filter((f) => f.manualEn).map((f) => f.key));

function renderHomeEditor() {
  const wrap = $("home-editor"); if (!wrap) return;
  const hc = HOME_CONTENT;
  let html = '<div class="he-grp"><div class="he-h">Testi (italiano)</div>';
  HOME_FIELDS.forEach((f) => {
    const v = (hc.it && hc.it[f.key] != null) ? hc.it[f.key] : homeDefault(f.key);
    const itInput = f.type === "area"
      ? `<textarea class="he-f" data-k="${f.key}" rows="2">${esc(v)}</textarea>`
      : `<input class="he-f" data-k="${f.key}" type="text" value="${esc(v)}">`;
    html += `<div class="field" style="margin:0 0 10px"><label>${esc(f.label)}${f.manualEn ? " · IT" : ""}</label>${itInput}</div>`;
    if (f.manualEn) {
      const ve = (hc.en && hc.en[f.key] != null) ? hc.en[f.key] : homeDefaultEn(f.key);
      const enInput = f.type === "area"
        ? `<textarea class="he-en" data-k="${f.key}" rows="2">${esc(ve)}</textarea>`
        : `<input class="he-en" data-k="${f.key}" type="text" value="${esc(ve)}">`;
      html += `<div class="field" style="margin:0 0 14px"><label>${esc(f.label)} · EN</label>${enInput}</div>`;
    }
  });
  html += '</div><div class="he-grp"><div class="he-h">Contatti / link</div>';
  HOME_OPS.forEach((o) => {
    const v = (hc.ops && hc.ops[o.key] != null) ? hc.ops[o.key] : "";
    html += `<div class="field" style="margin:0 0 10px"><label>${esc(o.label)}</label><input class="he-op" data-k="${o.key}" type="text" placeholder="${esc(o.ph)}" value="${esc(v)}"></div>`;
  });
  html += '</div><div class="he-grp"><div class="he-h">Immagini (max 5MB · jpg/png/webp)</div>';
  HOME_MEDIA.forEach((m) => {
    const url = (hc.media && hc.media[m.key]) || "";
    html += `<div class="he-img" data-k="${m.key}">
      <div class="he-thumb"${url ? ` style="background-image:url('${esc(url)}')"` : ""}></div>
      <div class="he-imeta"><label>${esc(m.label)}</label>
        <input class="he-file" type="file" accept="image/*" data-k="${m.key}">
        <div class="he-state" data-k="${m.key}">${url ? "immagine caricata" : "nessuna immagine"}</div></div>
    </div>`;
  });
  html += "</div>";
  wrap.innerHTML = html;
  wrap.querySelectorAll(".he-file").forEach((inp) => { inp.onchange = () => uploadHomeImage(inp); });
}

function loadHomeContent() {
  const hc = (SETTINGS && SETTINGS.home_content) || {};
  HOME_CONTENT = { it: hc.it || {}, en: hc.en || {}, ops: hc.ops || {}, media: hc.media || {} };
  renderHomeEditor();
}

async function uploadHomeImage(inp) {
  const file = inp.files && inp.files[0]; if (!file) return;
  if (file.size > 4 * 1024 * 1024) { toast("Immagine troppo grande: max 4MB."); inp.value = ""; return; }
  const slot = inp.dataset.k;
  const state = $("home-editor").querySelector('.he-state[data-k="' + slot + '"]');
  if (state) state.textContent = "carico…";
  try {
    const dataBase64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej; r.readAsDataURL(file);
    });
    const resp = await fetch("/.netlify/functions/upload-home-image", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN_UPLOAD_TOKEN },
      body: JSON.stringify({ slot: slot, contentType: file.type, dataBase64: dataBase64 }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.url) { if (state) state.textContent = "errore"; toast(data.error || "Upload fallito."); return; }
    HOME_CONTENT.media[slot] = data.url;
    const thumb = $("home-editor").querySelector('.he-img[data-k="' + slot + '"] .he-thumb');
    if (thumb) thumb.style.backgroundImage = "url('" + data.url + "')";
    if (state) state.textContent = "immagine caricata";
    toast("Immagine caricata. Ricordati di salvare.");
  } catch (e) { console.error(e); if (state) state.textContent = "errore"; toast("Upload fallito."); }
}

$("home-save").onclick = async () => {
  const btn = $("home-save"); btn.disabled = true; const lbl = btn.textContent; btn.textContent = "Salvo e traduco…";
  const it = {};
  $("home-editor").querySelectorAll(".he-f").forEach((el) => {
    const k = el.dataset.k, v = el.value.trim();
    if (v && v !== homeDefault(k)) it[k] = v;   // salva solo gli override ≠ default
  });
  // EN manuale (campi doppi): salvo solo override ≠ default EN
  const manualEn = {};
  $("home-editor").querySelectorAll(".he-en").forEach((el) => {
    const k = el.dataset.k, v = el.value.trim();
    if (v && v !== homeDefaultEn(k)) manualEn[k] = v;
  });
  const ops = {};
  $("home-editor").querySelectorAll(".he-op").forEach((el) => { const v = el.value.trim(); if (v) ops[el.dataset.k] = v; });
  // auto-traduco SOLO le chiavi non manuali; per i manuali l'EN viene dai campi doppi
  const autoIt = {};
  Object.keys(it).forEach((k) => { if (!HOME_MANUAL_EN.has(k)) autoIt[k] = it[k]; });
  let en = {};
  Object.keys(autoIt).forEach((k) => { if (HOME_CONTENT.en && HOME_CONTENT.en[k]) en[k] = HOME_CONTENT.en[k]; });
  let enMsg = "";
  if (Object.keys(autoIt).length) {
    try {
      const r = await fetch("/.netlify/functions/translate-home", {
        method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN_UPLOAD_TOKEN },
        body: JSON.stringify({ it: autoIt }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.en) { en = d.en; enMsg = " Inglese auto-tradotto."; }
      else enMsg = " ⚠ inglese auto NON aggiornato (" + (d.error || "errore") + ")";
    } catch (e) { enMsg = " ⚠ inglese auto NON aggiornato (rete)."; }
  }
  Object.assign(en, manualEn);   // i campi manuali sovrascrivono l'auto
  const payload = { it: it, en: en, ops: ops, media: HOME_CONTENT.media || {} };
  const { error } = await sb.from("settings").update({ home_content: payload }).eq("id", 1);
  btn.disabled = false; btn.textContent = lbl;
  if (error) { console.error(error); toast("Errore salvataggio homepage."); return; }
  SETTINGS.home_content = payload; HOME_CONTENT = payload;
  toast("Homepage salvata." + enMsg);
};

// ========== CODICI SCONTO ==========
let DISCOUNTS = [];
async function loadDiscounts() {
  const { data, error } = await sb.from("discount_codes").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); return; }
  DISCOUNTS = data || [];
  renderDiscounts();
}
function renderDiscounts() {
  const wrap = $("dc-list"); if (!wrap) return;
  if (!DISCOUNTS.length) { wrap.innerHTML = '<p class="muted small" style="margin:0">Nessun codice sconto creato.</p>'; return; }
  wrap.innerHTML = DISCOUNTS.map((d) => {
    const val = d.discount_type === "percent" ? `${Number(d.value)}%` : euro(d.value);
    const kindB = d.kind === "oneoff"
      ? `<span class="dc-tag oneoff">One-off${d.burned ? " · bruciato" : ""}</span>`
      : `<span class="dc-tag always">Sempre</span>`;
    return `<div class="dc-row${d.active ? "" : " off"}">` +
      `<div class="dc-main"><b>${esc(d.code)}</b> <span class="dc-val">−${val}</span> ${kindB}` +
      `<small>usato ${d.used_count} volt${d.used_count === 1 ? "a" : "e"}${d.active ? "" : " · disattivato"}</small></div>` +
      `<div class="dc-actions">` +
      (d.burned ? "" : `<button class="btn ghost sm" data-act="toggle" data-id="${d.id}">${d.active ? "Disattiva" : "Attiva"}</button>`) +
      `<button class="btn danger sm" data-act="del" data-id="${d.id}">Elimina</button>` +
      `</div></div>`;
  }).join("");
  wrap.querySelectorAll("[data-act]").forEach((b) => {
    b.onclick = () => {
      const d = DISCOUNTS.find((x) => x.id === b.dataset.id); if (!d) return;
      if (b.dataset.act === "toggle") toggleDiscount(d); else delDiscount(d);
    };
  });
}
async function addDiscount() {
  const code = $("dc-code").value.trim().toUpperCase();
  if (!code) { toast("Inserisci un codice."); return; }
  const value = Number($("dc-value").value);
  if (!(value > 0)) { toast("Valore sconto non valido."); return; }
  const { error } = await sb.from("discount_codes").insert({ code, kind: $("dc-kind").value, discount_type: $("dc-dtype").value, value });
  if (error) { toast(/duplicate|unique/i.test(error.message || "") ? "Codice già esistente." : "Errore creazione."); return; }
  $("dc-code").value = ""; $("dc-value").value = "";
  toast("Codice creato."); loadDiscounts();
}
async function toggleDiscount(d) {
  const { error } = await sb.from("discount_codes").update({ active: !d.active }).eq("id", d.id);
  if (error) { toast("Errore."); return; }
  loadDiscounts();
}
async function delDiscount(d) {
  if (!confirm(`Eliminare il codice ${d.code}?`)) return;
  const { error } = await sb.from("discount_codes").delete().eq("id", d.id);
  if (error) { toast("Errore."); return; }
  loadDiscounts();
}
$("dc-add").onclick = addDiscount;
$("dc-code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addDiscount(); } });
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
// Esegue una scrittura Supabase; se fallisce, prova un refresh della sessione e ritenta
// una volta. Copre i write intermittenti quando il JWT di sessione scade prima
// dell'auto-refresh (o un blip di rete) → senza, l'admin vede "Errore salvataggio/stampa".
async function withAuthRetry(fn) {
  let res = await fn();
  if (res && res.error) {
    const { error: rerr } = await sb.auth.refreshSession();
    if (!rerr) res = await fn();
  }
  return res;
}
async function updateRow(table, id, patch) {
  const { error } = await withAuthRetry(() => sb.from(table).update(patch).eq("id", id));
  if (error) { console.error("updateRow", table, id, error); toast("Errore salvataggio."); }
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
