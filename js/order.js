// ============ Mobile app — composizione e invio ordine ============
const t = (k, v) => window.I18N.t(k, v);
const $ = (id) => document.getElementById(id);
const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");

let DATA = { settings: { delivery_cost: 0, min_order: 0 }, flavors: [], formats: [], slots: [] };

// Lazy-load di script pesanti che NON servono per mostrare il menù (Leaflet=mappa, Stripe=pagamento):
// caricarli on-demand toglie ~2 download bloccanti dal percorso critico iniziale.
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error("script load: " + src));
    document.head.appendChild(s);
  });
}
let _leafletP = null, _stripeP = null;
function ensureLeaflet() { if (window.L) return Promise.resolve(); if (!_leafletP) _leafletP = loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"); return _leafletP; }
function ensureStripe()  { if (window.Stripe) return Promise.resolve(); if (!_stripeP) _stripeP = loadScript("https://js.stripe.com/v3/"); return _stripeP; }
let CART = [];
let modalFormat = null;        // formato attualmente in selezione nel modale
let modalChosen = [];          // gusti scelti nel modale
let modalEditIndex = null;     // indice CART in modifica (null = aggiunta di una nuova vaschetta)

// ---------- giorni di consegna (prossimi 7, oggi incluso) ----------
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function maxAdvanceDays() { const n = Number(DATA && DATA.settings && DATA.settings.max_advance_days); return n >= 1 && n <= 15 ? n : 6; }
function next7() {   // oggi + max_advance_days (default 6 → 7 giorni con oggi)
  const out = [], t = new Date(); t.setHours(0, 0, 0, 0);
  const days = 1 + maxAdvanceDays();
  for (let i = 0; i < days; i++) { const d = new Date(t); d.setDate(t.getDate() + i); out.push(d); }
  return out;
}
const dayName = (d, i) => {
  if (i === 0) return t("common.day.today");
  if (i === 1) return t("common.day.tomorrow");
  const w = d.toLocaleDateString((window.I18N && I18N.lang() === "en") ? "en-GB" : "it-IT", { weekday: "short" });
  return w.charAt(0).toUpperCase() + w.slice(1).replace(".", "");
};
const dateLabel = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" }) : "-");
let DAYS = next7();
let SELECTED_DAY = ymd(DAYS[0]);
let DAY_OVERRIDES = new Map();   // slot_id -> active per il giorno scelto
let DAY_COUNTS = {};             // slot_label -> n. ordini in lavorazione nel giorno scelto
// fascia piena: ha un tetto e gli ordini in lavorazione del giorno lo raggiungono (filtro stato ora lato RPC)
const slotFull = (s) => {
  const max = Number(s.max_deliveries);
  if (!max || max <= 0) return false;            // null / 0 = illimitato
  return (DAY_COUNTS[s.label] || 0) >= max;
};
// tempo di anticipo da inizio fascia (ore): globale, default 2
const slotLeadHours = () => { const h = Number(DATA.settings && DATA.settings.slot_lead_hours); return h > 0 ? h : 2; };
// fascia ancora ordinabile rispetto al tempo di anticipo. Solo per OGGI: una
// fascia sparisce quando mancano meno di N ore al suo inizio. Giorni futuri: sempre ok.
function slotWithinLead(s) {
  if (SELECTED_DAY !== ymd(DAYS[0])) return true;
  const startMin = hmToMin(s.label);               // inizio fascia (es. "18:00 - 18:30" -> 1080)
  const n = new Date();
  const nowMin = n.getHours() * 60 + n.getMinutes();
  return nowMin < startMin - slotLeadHours() * 60; // visibile fino a N ore prima dell'inizio
}
// fasce effettivamente offribili nel giorno scelto: accese (override/catalogo), non piene, entro l'anticipo
const effectiveSlots = () => DATA.slots.filter((s) => {
  const on = DAY_OVERRIDES.has(s.id) ? DAY_OVERRIDES.get(s.id) : s.active;
  return on && !slotFull(s) && slotWithinLead(s);
});

// ---------- modalità: consegna a domicilio / ritiro in negozio ----------
let MODE = "delivery";
const isPickup = () => MODE === "pickup";
const deliveryCost = () => (isPickup() ? 0 : Number(DATA.settings.delivery_cost || 0));
const WD_KEY = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];   // index = Date.getDay()
const OPENING_DEFAULTS = { lun: { open: "16:00", close: "24:00" }, mar: { open: "16:00", close: "24:00" }, mer: { open: "16:00", close: "24:00" }, gio: { open: "16:00", close: "24:00" }, ven: { open: "16:00", close: "24:00" }, sab: { open: "16:00", close: "24:00" }, dom: { open: "16:00", close: "24:00" } };
const openingHours = () => (DATA.settings && DATA.settings.opening_hours) || OPENING_DEFAULTS;
const openingFor = (ymdStr) => openingHours()[WD_KEY[new Date(ymdStr + "T00:00:00").getDay()]] || null;
const hmToMin = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 0; };

function renderPickupTimes() {
  const sel = $("pickup-time"); if (!sel) return;
  sel.innerHTML = "";
  const oh = openingFor(SELECTED_DAY);
  if (!oh || oh.closed) { sel.innerHTML = `<option value="">${t("order.slot.closedDay")}</option>`; updateTotal(); return; }
  let start = hmToMin(oh.open), end = hmToMin(oh.close);
  if (SELECTED_DAY === ymd(DAYS[0])) {   // oggi: da ora + 30 min
    const n = new Date(); start = Math.max(start, Math.ceil((n.getHours() * 60 + n.getMinutes() + 30) / 30) * 30);
  }
  const opts = [];
  for (let m = start; m <= end; m += 30) opts.push(String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  if (!opts.length) { sel.innerHTML = `<option value="">${t("order.slot.noPickupTimesToday")}</option>`; updateTotal(); return; }
  opts.forEach((t) => sel.appendChild(new Option(t, t)));
  updateTotal();
}
function renderOpeningHours() {
  const el = $("opening-hours"); if (!el) return;
  const oh = openingHours();
  const days = [["lun", "Lun"], ["mar", "Mar"], ["mer", "Mer"], ["gio", "Gio"], ["ven", "Ven"], ["sab", "Sab"], ["dom", "Dom"]];
  el.innerHTML = days.map(([k, lbl]) => { const h = oh[k] || {}; return `<div class="oh-row"><span>${lbl}</span><span>${h.closed ? t("common.closed") : esc((h.open || "-") + "–" + (h.close || "-"))}</span></div>`; }).join("");
}
function setMode(mode) {
  MODE = mode;
  $("mode-delivery").classList.toggle("sel", mode === "delivery");
  $("mode-pickup").classList.toggle("sel", mode === "pickup");
  const del = mode === "delivery";
  $("slot-field").style.display = del ? "" : "none";
  $("pickup-field").style.display = del ? "none" : "";
  const af = $("address-field"); if (af) af.style.display = del ? "" : "none";
  const later = $("submit-later"); if (later) later.style.display = del ? "none" : "";   // "Paga dopo" solo per ritiro
  const dl = $("day-label"); if (dl) dl.textContent = del ? t("order.form.deliveryDay") : t("order.form.pickupDay");
  if (del) renderSlotSelect(); else { renderPickupTimes(); renderOpeningHours(); }
  renderCart();
}

// ---------- mappa consegna + geofence San Teodoro ----------
const GELATERIA = { lat: 40.8410901, lng: 9.6538693, name: "Gelateria Bm&V Montepetrosu" };
const ST_BBOX = [[40.6967, 9.5776], [40.8649, 9.7287]];   // [S,W],[N,E] comune San Teodoro
let map = null, delivMarker = null, delIcon = null;
let DELIV_LAT = null, DELIV_LNG = null, IN_ZONE = false;
let COUPON = null;   // codice sconto applicato (riga di discount_codes), o null

// zona consegna: custom (settings.delivery_area, anello singolo) o confine comune (più anelli)
function deliveryRings() {
  const a = DATA.settings && DATA.settings.delivery_area;
  if (Array.isArray(a) && a.length >= 3) return [a];
  return window.SAN_TEODORO_POLY || [];
}
// point-in-polygon (ray casting) sulla zona di consegna
function inDeliveryZone(lat, lng) {
  let c = false;
  for (const r of deliveryRings()) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const yi = r[i][0], xi = r[i][1], yj = r[j][0], xj = r[j][1];
    if (((xi > lng) !== (xj > lng)) && (lat < (yj - yi) * (lng - xi) / (xj - xi) + yi)) c = !c;
  }
  return c;
}
// contorno della zona disegnato sulla mappa cliente
let zoneLayer = null;
function drawDeliveryZone() {
  if (!map || typeof L === "undefined") return;
  if (zoneLayer) { map.removeLayer(zoneLayer); zoneLayer = null; }
  const rings = deliveryRings();
  if (rings.length) zoneLayer = L.polygon(rings, { color: "#a8552f", weight: 2, fillColor: "#a8552f", fillOpacity: .06, interactive: false }).addTo(map);
}
function pinIcon(color) {
  return L.divIcon({ className: "", iconSize: [28, 38], iconAnchor: [14, 37], popupAnchor: [0, -32],
    html: `<svg width="28" height="38" viewBox="0 0 24 34"><path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 22 12 22s12-13.5 12-22C24 5.4 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="12" r="4.6" fill="#fff"/></svg>` });
}
async function initMap() {
  if (!$("map")) return;
  try { await ensureLeaflet(); } catch (e) { console.error("Leaflet load:", e); return; }
  if (typeof L === "undefined") return;
  map = L.map("map", { center: [GELATERIA.lat, GELATERIA.lng], zoom: 12, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  delIcon = pinIcon("#a8552f");   // terracotta = punto consegna
  L.marker([GELATERIA.lat, GELATERIA.lng], { icon: pinIcon("#2b2620") }).addTo(map)
    .bindPopup("<b>" + esc(GELATERIA.name) + "</b><br>" + t("order.map.departurePoint"));
  map.fitBounds(ST_BBOX, { padding: [12, 12] });
  map.on("click", (e) => setDelivery(e.latlng.lat, e.latlng.lng, false, true));
  // pulsante "crocino" → posizione GPS dell'utente
  const Locate = L.Control.extend({ options: { position: "topleft" }, onAdd() {
    const a = L.DomUtil.create("a", "leaflet-bar locate-btn");
    a.href = "#"; a.title = t("order.map.myLocationTitle"); a.setAttribute("role", "button"); a.setAttribute("aria-label", t("order.map.findMyLocation"));
    a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><line x1="12" y1="1.5" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22.5" y2="12"/></svg>';
    L.DomEvent.on(a, "click", L.DomEvent.stop).on(a, "click", locateMe);
    return a;
  } });
  map.addControl(new Locate());
  // pulsante reset → torna alla vista iniziale (tutta la zona coperta)
  const Reset = L.Control.extend({ options: { position: "topleft" }, onAdd() {
    const a = L.DomUtil.create("a", "leaflet-bar locate-btn reset-btn");
    a.href = "#"; a.title = t("order.map.resetViewTitle"); a.setAttribute("role", "button"); a.setAttribute("aria-label", t("order.map.resetViewAria"));
    a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 3 3 8 3"/><polyline points="21 8 21 3 16 3"/><polyline points="3 16 3 21 8 21"/><polyline points="21 16 21 21 16 21"/></svg>';
    L.DomEvent.on(a, "click", L.DomEvent.stop).on(a, "click", resetView);
    return a;
  } });
  map.addControl(new Reset());
  setTimeout(() => map.invalidateSize(), 250);
  drawDeliveryZone();   // mappa+Leaflet pronti: disegna la zona (initMap ora è async)
}
function resetView() { if (map) map.fitBounds(ST_BBOX, { padding: [12, 12] }); }
function locateMe() {
  if (!navigator.geolocation) { toast(t("order.toast.geolocationUnavailable")); return; }
  toast(t("order.toast.locating"));
  navigator.geolocation.getCurrentPosition(
    (pos) => setDelivery(pos.coords.latitude, pos.coords.longitude, true, true),
    (err) => toast(err && err.code === 1 ? t("order.toast.locationDenied") : t("order.toast.locationUnavailable")),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
function setDelivery(lat, lng, recenter, fillAddr) {
  DELIV_LAT = lat; DELIV_LNG = lng;
  if (!delivMarker) {
    delivMarker = L.marker([lat, lng], { icon: delIcon, draggable: true }).addTo(map);
    delivMarker.on("dragend", () => { const p = delivMarker.getLatLng(); setDelivery(p.lat, p.lng, false, true); });
  } else delivMarker.setLatLng([lat, lng]);
  checkZone();
  if (recenter && map) map.fitBounds(L.latLngBounds([[lat, lng], [GELATERIA.lat, GELATERIA.lng]]), { padding: [40, 40], maxZoom: 15 });
  if (fillAddr && !$("address").value.trim()) reverseFill(lat, lng);
}
function checkZone() {
  IN_ZONE = (DELIV_LAT != null) && inDeliveryZone(DELIV_LAT, DELIV_LNG);
  const el = $("zone-status");
  if (el) {
    if (DELIV_LAT == null) { el.textContent = ""; el.className = "zone-status"; }
    else if (IN_ZONE) { el.textContent = t("order.zone.inZone"); el.className = "zone-status ok"; }
    else { el.textContent = t("order.zone.outOfZone"); el.className = "zone-status ko"; }
  }
  updateTotal();
}
async function geocodeAddress() {
  const q = $("address").value.trim();
  if (!q) { toast(t("order.toast.enterAddressThenFind")); return; }
  const query = q + (/teodoro/i.test(q) ? "" : ", San Teodoro") + ", Sardegna, Italia";
  const vb = "9.5776,40.8649,9.7287,40.6967";
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&viewbox=${vb}&q=${encodeURIComponent(query)}`);
    const d = await r.json();
    if (!d.length) { toast(t("order.toast.addressNotFound")); return; }
    setDelivery(+d[0].lat, +d[0].lon, true, false);
  } catch (e) { console.error(e); toast(t("order.toast.mapSearchUnavailable")); }
}
async function reverseFill(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`);
    const d = await r.json();
    if (d && d.display_name) $("address").value = d.display_name.replace(/,\s*Italia$/, "");
  } catch (e) { /* reverse opzionale */ }
}

// ---------- autocomplete indirizzo (Photon/komoot, gratis, no key) ----------
let _addrSeq = 0, _addrTimer = null;
function closeAddrSuggest() { const b = $("addr-suggest"); if (b) { b.innerHTML = ""; b.style.display = "none"; } }
function onAddrInput() {
  const q = $("address").value.trim();
  clearTimeout(_addrTimer);
  if (q.length < 3) { closeAddrSuggest(); return; }
  _addrTimer = setTimeout(() => fetchAddrSuggest(q), 300);   // debounce
}
async function fetchAddrSuggest(q) {
  const seq = ++_addrSeq;
  try {
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${GELATERIA.lat}&lon=${GELATERIA.lng}&limit=5`;
    const d = await (await fetch(u)).json();
    if (seq !== _addrSeq) return;   // risposta superata da una più recente
    renderAddrSuggest(d.features || []);
  } catch (e) { /* suggerimenti opzionali: restano "Trova" + pin */ }
}
function addrLabel(p) {
  const primary = [p.street || p.name, p.housenumber].filter(Boolean).join(" ") || p.name || "";
  const secondary = [p.postcode, p.city || p.town || p.village || p.county, p.state].filter(Boolean).join(" ");
  return { primary, secondary };
}
function renderAddrSuggest(feats) {
  const box = $("addr-suggest"); if (!box) return;
  box.innerHTML = "";
  feats.forEach((f) => {
    const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
    if (!c) return;
    const { primary, secondary } = addrLabel(p);
    if (!primary) return;
    const item = document.createElement("div");
    item.className = "addr-item"; item.setAttribute("role", "option");
    item.innerHTML = `<span class="ai-1">${esc(primary)}</span>${secondary ? `<span class="ai-2">${esc(secondary)}</span>` : ""}`;
    item.onmousedown = (e) => {   // mousedown: scatta prima del blur dell'input
      e.preventDefault();
      $("address").value = [primary, secondary].filter(Boolean).join(", ");
      closeAddrSuggest();
      setDelivery(c[1], c[0], true, false);   // Photon dà [lng,lat] → piazza pin + ricentra
    };
    box.appendChild(item);
  });
  box.style.display = box.children.length ? "block" : "none";
}

// ---------- caricamento dati ----------
async function loadData() {
  const pSettings = sb.from("settings").select("*").eq("id", 1).single();
  const pFlavors  = sb.from("flavors").select("*").eq("available", true).order("sort_order");
  const pFormats  = sb.from("formats").select("*").eq("available", true).order("sort_order");
  const pSlots    = sb.from("time_slots").select("*").order("sort_order");
  // prodotti ordinabili: render appena risolve la query formati, senza aspettare le altre tre
  pFormats.then((r) => { if (!r.error && r.data) { DATA.formats = r.data; renderFormats(); } });
  const [settings, flavors, formats, slots] = await Promise.all([pSettings, pFlavors, pFormats, pSlots]);
  if (settings.error || flavors.error || formats.error || slots.error) {
    toast(t("order.toast.loadError"));
    console.error(settings.error || flavors.error || formats.error || slots.error);
    const fw = $("formats"); if (fw) fw.innerHTML = `<p class="hint">${t("order.error.menuLoadFailed")}</p>`;
    return;
  }
  DATA = {
    settings: settings.data || { delivery_cost: 0, min_order: 0 },
    flavors: flavors.data, formats: formats.data, slots: slots.data,
  };
  const slotMin = (l) => { const m = String(l).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; };
  DATA.slots = (DATA.slots || []).slice().sort((a, b) => slotMin(a.label) - slotMin(b.label));   // fasce sempre in ordine orario
  DAYS = next7(); SELECTED_DAY = ymd(DAYS[0]);   // applica max_advance_days dalle impostazioni
  drawDeliveryZone();
  renderFormats();
  renderDayPick();
  await loadDaySlots();
  renderCart();
}

// ---------- prodotti (raggruppati per categoria: Vaschette / Altri prodotti) ----------
const PRODUCT_CATS = [
  { key: "vaschetta", label: "product.category.tubs" },
  { key: "altro", label: "product.category.other" },
];
// category null -> vaschetta; valori inattesi -> altro (niente prodotti nascosti)
const normCat = (f) => ((f.category || "vaschetta") === "vaschetta" ? "vaschetta" : "altro");
function renderFormats() {
  const wrap = $("formats");
  wrap.innerHTML = "";
  if (!DATA.formats.length) { wrap.innerHTML = `<p class="hint">${t("order.products.none")}</p>`; return; }
  PRODUCT_CATS.forEach((c) => {
    const rows = DATA.formats.filter((f) => normCat(f) === c.key);
    if (!rows.length) return;
    const head = document.createElement("p");
    head.className = "fmt-group-head"; head.textContent = t(c.label);
    wrap.appendChild(head);
    rows.forEach((f) => {
      const n = f.max_flavors;
      const el = document.createElement("div");
      el.className = "fmt";
      const desc = n > 0 ? (n === 1 ? t("product.flavorCount.singular", { n: n }) : t("product.flavorCount.plural", { n: n })) : t("product.noFlavorChoice");
      el.innerHTML =
        `<div class="meta"><div class="name">${esc(f.name)}</div>` +
        `<div class="desc">${desc}</div></div>` +
        `<div class="price">${euro(f.price)}</div>` +
        `<button class="btn sm">${n > 0 ? t("product.btn.choose") : t("product.btn.add")}</button>`;
      el.querySelector("button").onclick = () => openModal(f);
      wrap.appendChild(el);
    });
  });
}

// ---------- modale gusti ----------
function openModal(format) {
  modalFormat = format; modalChosen = []; modalEditIndex = null;   // default: aggiunta nuova
  $("m-add").textContent = t("order.modal.addToCart");
  const n = format.max_flavors;
  const flavWrap = $("m-flavors"), hint = $("m-hint");
  $("m-eyebrow").textContent =
    (n > 0 ? (n === 1 ? t("product.flavorCount.singular", { n: n }) : t("product.flavorCount.plural", { n: n })) : t("order.modal.productEyebrow")) + ` · ${euro(format.price)}`;
  $("m-title").textContent = format.name;
  if (n > 0) {
    hint.style.display = "";
    hint.textContent = n === 1 ? t("order.modal.flavorHint", { n: n }) : t("order.modal.flavorHintPlural", { n: n });
    flavWrap.style.display = "";
    renderModalFlavors();
  } else {
    hint.style.display = "none";
    flavWrap.style.display = "none";
    flavWrap.innerHTML = "";
  }
  $("m-qty").value = 1;
  $("modal").classList.add("show");
}
function closeModal() {
  $("modal").classList.remove("show");
  modalEditIndex = null;   // chiudere senza salvare annulla la modalità modifica
  $("m-add").textContent = t("order.modal.addToCart");
}

// Apre il modale precompilato per modificare una vaschetta già nel carrello:
// stessi gusti, stessa quantità. Salvando si sovrascrive lo stesso slot del carrello.
function openCartEdit(i) {
  const item = CART[i];
  if (!item) return;
  // formato "vivo" (prezzo/max gusti aggiornati dal catalogo) o ricostruito dall'item se non più disponibile
  const fmt = DATA.formats.find((f) => f.id === item.format_id) || {
    id: item.format_id, name: item.format, price: item.prezzo_unit,
    max_flavors: (item.max_flavors != null ? item.max_flavors : (item.gusti ? item.gusti.length : 0)),
    weight_kg: item.peso_kg, category: item.category,
  };
  openModal(fmt);                                            // imposta add-mode + UI, poi passo in edit
  modalEditIndex = i;
  modalChosen = (item.gusti || []).slice(0, fmt.max_flavors);   // gusti correnti (tagliati se max ridotto)
  if (Number(fmt.max_flavors) > 0) renderModalFlavors();
  $("m-qty").value = Math.max(1, parseInt(item.qty, 10) || 1);
  $("m-add").textContent = t("order.modal.saveEdit");
}

function renderModalFlavors() {
  const wrap = $("m-flavors");
  wrap.innerHTML = "";
  if (!DATA.flavors.length) { wrap.innerHTML = `<p class="hint">${t("order.modal.noFlavors")}</p>`; return; }
  let anyDaily = false;
  DATA.flavors.forEach((g) => {
    const sel = modalChosen.includes(g.name);
    const full = modalChosen.length >= modalFormat.max_flavors;
    const b = document.createElement("button");
    b.className = "chip" + (g.daily ? " daily" : "") + (sel ? " sel" : (full ? " off" : ""));
    b.textContent = (g.daily ? "☀ " : "") + g.name;
    b.disabled = !sel && full;
    b.onclick = () => {
      if (sel) modalChosen = modalChosen.filter((n) => n !== g.name);
      else if (modalChosen.length < modalFormat.max_flavors) modalChosen.push(g.name);
      renderModalFlavors();
    };
    wrap.appendChild(b);
    if (g.daily) anyDaily = true;
  });
  if (anyDaily) {   // nota: i gusti del giorno valgono solo per oggi
    const note = document.createElement("p");
    note.className = "daily-note"; note.style.flexBasis = "100%";
    note.textContent = t("order.modal.dailyNote");
    wrap.appendChild(note);
  }
}

function addToCart() {
  if (modalFormat.max_flavors > 0 && modalChosen.length === 0) { toast(t("order.toast.chooseFlavor")); return; }
  const qty = Math.max(1, parseInt($("m-qty").value || "1", 10));
  const entry = {
    format_id: modalFormat.id,
    format: modalFormat.name,
    category: modalFormat.category || "vaschetta",
    peso_kg: modalFormat.weight_kg != null ? Number(modalFormat.weight_kg) : null,
    max_flavors: Number(modalFormat.max_flavors) || 0,   // serve a riaprire l'editor anche se il formato sparisce
    gusti: [...modalChosen],
    qty,
    prezzo_unit: Number(modalFormat.price),
  };
  const editing = modalEditIndex != null && CART[modalEditIndex];
  if (editing) CART[modalEditIndex] = entry; else CART.push(entry);
  closeModal();
  renderCart();
  toast(editing ? t("order.toast.cartUpdated") : t("order.toast.addedToCart"));
}

// ---------- carrello ----------
function renderCart() {
  const lines = $("cart-lines");
  $("cart-empty").style.display = CART.length ? "none" : "block";
  if (!CART.length) { lines.innerHTML = ""; updateTotal(); return; }
  const rows = CART.map((item, i) =>
    `<div class="cart-line editable" data-i="${i}" role="button" tabindex="0" aria-label="${t("order.cart.editItem")}"><div class="q">${item.qty}×</div>` +
    `<div class="body"><div class="t">${esc(item.format)} <span class="ed" aria-hidden="true">✏</span></div>${item.gusti.length ? `<div class="g">${esc(item.gusti.join(", "))}</div>` : ""}</div>` +
    `<div class="lp">${euro(item.prezzo_unit * item.qty)}</div>` +
    `<button class="btn icon rm" data-i="${i}" aria-label="${t("order.cart.removeItem")}">✕</button></div>`
  ).join("");
  const sub = subtotal();
  const delivery = deliveryCost();
  lines.innerHTML =
    `<div class="cart">${rows}` +
    `<div class="cart-foot">` +
    `<div class="r"><span>${t("order.cart.subtotal")}</span><span>${euro(sub)}</span></div>` +
    `<div class="r"><span>${isPickup() ? t("common.pickup") : t("common.delivery")}</span><span>${euro(delivery)}</span></div>` +
    `<div class="r tot"><b>${t("common.total")}</b><span class="v">${euro(sub + delivery)}</span></div>` +
    `</div></div>`;
  lines.querySelectorAll(".rm").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); CART.splice(parseInt(btn.dataset.i, 10), 1); renderCart(); };
  });
  lines.querySelectorAll(".cart-line.editable").forEach((line) => {
    const open = () => openCartEdit(parseInt(line.dataset.i, 10));
    line.onclick = open;
    line.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
  });
  updateTotal();
}

function subtotal() { return CART.reduce((s, i) => s + i.prezzo_unit * i.qty, 0); }

// ---------- codice sconto ----------
function couponDiscount(base) {
  if (!COUPON || base <= 0) return 0;
  let d = COUPON.discount_type === "percent" ? base * Number(COUPON.value) / 100 : Number(COUPON.value);
  return Math.round(Math.min(d, base) * 100) / 100;
}
function renderCouponMsg(disc) {
  const m = $("coupon-msg"); if (!m) return;
  if (COUPON) {
    m.style.display = "block"; m.className = "coupon-msg ok";
    m.textContent = t("order.coupon.applied", { code: COUPON.code }) + (disc > 0 ? `: −${euro(disc)}` : "");
  } else if (!$("coupon").value.trim()) {
    m.style.display = "none";   // campo vuoto: nascondi (gli errori restano finché c'è testo)
  }
}
async function applyCoupon() {
  const code = $("coupon").value.trim().toUpperCase();
  const m = $("coupon-msg");
  const fail = (txt) => { COUPON = null; if (m) { m.style.display = "block"; m.className = "coupon-msg ko"; m.textContent = "✕ " + txt; } updateTotal(); };
  if (!code) { COUPON = null; if (m) m.style.display = "none"; updateTotal(); return; }
  const phone = $("phone").value.trim();
  const email = $("email").value.trim();
  const { data: cp, error } = await sb.rpc("rpc_coupon_precheck", { p_code: code, p_phone: phone, p_email: email });
  if (error) return fail(t("order.coupon.checkFailed"));
  if (!cp || !cp.valid) {
    if (cp && cp.reason === "already_used") return fail(t("order.coupon.alreadyUsed"));
    if (cp && cp.reason === "exhausted") return fail(t("order.coupon.alreadyUsed"));
    if (cp && cp.reason === "not_found") return fail(t("order.coupon.invalid"));
    return fail(t("order.coupon.invalid"));
  }
  // Store just what we need to compute the discount client-side (authoritative calc is server-side)
  COUPON = { code, discount_type: cp.type, value: cp.value };
  updateTotal();   // mostra il successo + aggiorna il totale
}

// Campo sconto abilitato solo con nome + telefono + email compilati.
function syncCouponGate() {
  const ready = !!($("name").value.trim() && $("phone").value.trim() && $("email").value.trim());
  const inp = $("coupon"), btn = $("coupon-apply"), gate = $("coupon-gate");
  if (inp) inp.disabled = !ready;
  if (btn) btn.disabled = !ready;
  if (gate) gate.style.display = ready ? "none" : "block";
  if (!ready && COUPON) { COUPON = null; const m = $("coupon-msg"); if (m) m.style.display = "none"; updateTotal(); }
}

// gusti del giorno: ordinabili SOLO per oggi (consegna o ritiro in giornata)
const isToday = () => SELECTED_DAY === ymd(DAYS[0]);
function dailyNameSet() { const s = new Set(); (DATA.flavors || []).forEach((f) => { if (f.daily) s.add(f.name); }); return s; }
function cartHasDaily() { const dn = dailyNameSet(); return CART.some((it) => (it.gusti || []).some((n) => dn.has(n))); }

function updateTotal() {
  const sub = subtotal();
  const delivery = CART.length ? deliveryCost() : 0;
  const disc = couponDiscount(sub + delivery);
  $("total").textContent = euro(sub + delivery - disc);
  renderCouponMsg(disc);
  const min = Number(DATA.settings.min_order);
  const okMin = sub >= min;
  const pickup = isPickup();
  const hasSlot = effectiveSlots().length > 0;
  const pickupOk = !!($("pickup-time") && $("pickup-time").value);
  const dayConflict = cartHasDaily() && !isToday();   // gusto del giorno + giorno futuro = blocco
  const banner = $("min-banner");
  if (CART.length && dayConflict) {
    banner.style.display = "block";
    banner.textContent = t("order.minBanner.dailyTodayOnly");
  } else if (CART.length && !okMin) {
    banner.style.display = "block";
    banner.textContent = t("order.minBanner.belowMinimum", { min: euro(min), diff: euro(min - sub) });
  } else if (CART.length && pickup && !pickupOk) {
    banner.style.display = "block";
    banner.textContent = t("order.minBanner.choosePickupTime");
  } else if (CART.length && !pickup && !hasSlot) {
    banner.style.display = "block";
    banner.textContent = t("order.minBanner.noSlotForDay");
  } else if (CART.length && !pickup && !IN_ZONE) {
    banner.style.display = "block";
    banner.textContent = t("order.minBanner.pinInZone");
  } else { banner.style.display = "none"; }
  const ready = (pickup ? pickupOk : (hasSlot && IN_ZONE)) && !dayConflict;
  $("submit").disabled = !(CART.length && okMin && ready);
  const later = $("submit-later"); if (later) later.disabled = $("submit").disabled;   // "Paga dopo" segue lo stesso gate
}

// ---------- giorno + fasce ----------
function renderDayPick() {
  const cal = $("day-pick");
  cal.innerHTML = "";
  DAYS.forEach((d, i) => {
    const key = ymd(d);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day" + (key === SELECTED_DAY ? " sel" : "") + (i === 0 ? " today" : "");
    b.innerHTML = `<div class="dwd">${dayName(d, i)}</div><div class="dnum">${d.getDate()}</div>`;
    b.onclick = () => { SELECTED_DAY = key; renderDayPick(); if (isPickup()) renderPickupTimes(); else loadDaySlots(); };
    cal.appendChild(b);
  });
}

async function loadDaySlots() {
  const [ov, avail] = await Promise.all([
    sb.from("slot_day_state").select("slot_id, active").eq("day", SELECTED_DAY),
    sb.rpc("rpc_slot_availability", { p_date: SELECTED_DAY }),
  ]);
  if (ov.error) console.error(ov.error);
  if (avail.error) console.error(avail.error);
  DAY_OVERRIDES = new Map((ov.data || []).map((r) => [r.slot_id, r.active]));
  DAY_COUNTS = Object.fromEntries((avail.data || []).map((r) => [r.slot_label, r.taken]));
  renderSlotSelect();
}

function renderSlotSelect() {
  const s = $("slot");
  s.innerHTML = "";
  const slots = effectiveSlots();
  if (!slots.length) {
    s.innerHTML = `<option value="">${t("order.slot.noneAvailable")}</option>`;
  } else {
    slots.forEach((sl) => {
      const o = document.createElement("option");
      o.value = sl.label; o.textContent = sl.label;
      s.appendChild(o);
    });
  }
  updateTotal();
}

// ---------- invio ----------
async function submitOrder() {
  if (cartHasDaily() && !isToday()) { toast(t("order.toast.dailyTodayOnly")); updateTotal(); return; }   // gusto del giorno solo per oggi
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  if (!name || !phone) { toast(t("order.toast.fillNamePhone")); return; }
  const pickup = isPickup();
  let address, slotLabel, lat = null, lng = null;
  if (pickup) {
    const tval = $("pickup-time").value;
    if (!tval) { toast(t("order.toast.choosePickupTime")); return; }
    address = t("order.pickup.atShop"); slotLabel = "Ritiro " + tval;
  } else {
    address = $("address").value.trim();
    if (!address) { toast(t("order.toast.enterDeliveryAddress")); return; }
    if (!(IN_ZONE && DELIV_LAT != null)) { toast(t("order.toast.pinInZone")); return; }
    if (!effectiveSlots().length) { toast(t("order.toast.noSlotForDay")); return; }
    // re-check capienza fascia prima dell'invio (best-effort anti-race)
    const chosen = $("slot").value;
    if (!effectiveSlots().some((s) => s.label === chosen)) {   // cutoff/anticipo superato o fascia spenta nel frattempo
      toast(t("order.toast.slotNoLongerAvailable"));
      await loadDaySlots(); return;
    }
    const slotObj = DATA.slots.find((s) => s.label === chosen);
    if (slotObj && Number(slotObj.max_deliveries) > 0) {
      const { data: capAvail, error: capErr } = await sb.rpc("rpc_slot_availability", { p_date: SELECTED_DAY });
      if (!capErr && capAvail) {
        const takenRow = capAvail.find((r) => r.slot_label === chosen);
        if (takenRow && takenRow.taken >= Number(slotObj.max_deliveries)) {
          toast(t("order.toast.slotJustFilled"));
          await loadDaySlots();
          return;
        }
      }
    }
    slotLabel = chosen; lat = DELIV_LAT; lng = DELIV_LNG;
  }

  const sub = subtotal();
  const delivery = deliveryCost();
  const payload = {
    customer_name: name,
    customer_phone: phone,
    email: $("email").value.trim() || null,
    address,
    delivery_lat: lat,
    delivery_lng: lng,
    delivery_date: SELECTED_DAY,
    slot_label: slotLabel,
    fulfillment: pickup ? "pickup" : "delivery",
    items: CART,
    subtotal: sub,
    delivery_cost: delivery,
    total: sub + delivery,
    coupon_code: COUPON ? COUPON.code : null,
    notes: $("notes").value.trim() || null,
    status: "ricevuto",
    lang: (window.I18N ? I18N.lang() : "it"),   // locale per Stripe Checkout
  };

  // L'ordine NON viene inserito qui: prima si paga. La funzione ricalcola gli importi
  // lato server, crea la sessione Stripe e ritorna il client_secret. La riga in `orders`
  // nasce nel webhook, solo a pagamento riuscito.
  $("submit").disabled = true; $("submit").textContent = t("order.submit.waiting");
  let data;
  try {
    const res = await fetch("/.netlify/functions/create-checkout", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) { toast(data.error || t("order.toast.paymentStartError")); resetSubmit(); return; }
  } catch (e) {
    console.error(e); toast(t("order.toast.networkUnavailable")); resetSubmit(); return;
  }
  await openPayment(data.client_secret);
  resetSubmit();
}
function resetSubmit() { $("submit").disabled = false; $("submit").textContent = t("order.submit.goToPayment"); }

// "Paga dopo": ordine PICKUP con pagamento alla cassa al ritiro (nessuno Stripe).
// L'ordine nasce subito lato server (create-order-unpaid), poi vai alla thank-you.
async function submitOrderUnpaid() {
  if (cartHasDaily() && !isToday()) { toast(t("order.toast.dailyTodayOnly")); updateTotal(); return; }
  if (!isPickup()) return;
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  if (!name || !phone) { toast(t("order.toast.fillNamePhone")); return; }
  const tval = $("pickup-time").value;
  if (!tval) { toast(t("order.toast.choosePickupTime")); return; }
  const sub = subtotal();
  const payload = {
    customer_name: name, customer_phone: phone,
    email: $("email").value.trim() || null,
    address: t("order.pickup.atShop"),
    delivery_date: SELECTED_DAY, slot_label: "Ritiro " + tval,
    fulfillment: "pickup",
    items: CART, subtotal: sub, delivery_cost: 0, total: sub,
    coupon_code: COUPON ? COUPON.code : null,
    notes: $("notes").value.trim() || null,
    lang: (window.I18N ? I18N.lang() : "it"),
  };
  const btn = $("submit-later");
  btn.disabled = true; btn.textContent = t("order.submit.waiting");
  try {
    const res = await fetch("/.netlify/functions/create-order-unpaid", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { toast(data.error || t("order.toast.paymentStartError")); btn.disabled = false; btn.textContent = t("order.submit.btnLater"); return; }
    location.href = "grazie.html?pay=later";
  } catch (e) {
    console.error(e); toast(t("order.toast.networkUnavailable")); btn.disabled = false; btn.textContent = t("order.submit.btnLater");
  }
}

// ---------- pagamento (Stripe Embedded Checkout) ----------
let stripeObj = null, embeddedCheckout = null;
async function openPayment(clientSecret) {
  if (!window.STRIPE_PUBLISHABLE_KEY) { toast(t("order.toast.paymentsNotConfigured")); return; }
  try { await ensureStripe(); } catch (e) { console.error("Stripe load:", e); toast(t("order.toast.paymentsNotConfigured")); return; }
  if (!window.Stripe) { toast(t("order.toast.paymentsNotConfigured")); return; }
  if (!stripeObj) stripeObj = window.Stripe(window.STRIPE_PUBLISHABLE_KEY);
  if (embeddedCheckout) { try { embeddedCheckout.destroy(); } catch (e) {} embeddedCheckout = null; }
  $("pay-modal").classList.add("show");
  try {
    // a pagamento riuscito Stripe fa redirect a return_url (grazie.html); l'ordine lo crea il webhook.
    embeddedCheckout = await stripeObj.initEmbeddedCheckout({ fetchClientSecret: async () => clientSecret });
    embeddedCheckout.mount("#checkout");
  } catch (e) {
    console.error(e); closePayment(); toast(t("order.toast.paymentOpenError"));
  }
}
function closePayment() {
  $("pay-modal").classList.remove("show");
  if (embeddedCheckout) { try { embeddedCheckout.destroy(); } catch (e) {} embeddedCheckout = null; }
}

function showConfirmation(o) {
  $("shop").classList.add("hidden");
  $("bar").style.display = "none";
  $("done").classList.remove("hidden");
  const isP = o.fulfillment === "pickup";
  $("done-text").textContent = isP
    ? t("order.confirm.pickup", { date: dateLabel(o.delivery_date), time: String(o.slot_label || "").replace("Ritiro ", "") })
    : t("order.confirm.delivery", { date: dateLabel(o.delivery_date), slot: o.slot_label || "-" });
  const rows = o.items.map((i) =>
    `<div class="cart-line"><div class="q">${i.qty}×</div>` +
    `<div class="body"><div class="t">${esc(i.format)}</div>${(i.gusti && i.gusti.length) ? `<div class="g">${esc(i.gusti.join(", "))}</div>` : ""}</div>` +
    `<div class="lp">${euro(i.prezzo_unit * i.qty)}</div></div>`
  ).join("");
  $("done-summary").innerHTML =
    rows +
    `<div class="cart-foot">` +
    `<div class="r"><span>${isP ? t("common.pickup") : t("common.delivery")}</span><span>${euro(o.delivery_cost)}</span></div>` +
    `<div class="r tot"><b>${t("common.total")}</b><span class="v">${euro(o.total)}</span></div>` +
    `</div>`;
  window.scrollTo(0, 0);
}

// ---------- util ----------
let toastTimer = null;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- wiring ----------
$("m-close").onclick = closeModal;
$("modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
$("m-add").onclick = addToCart;
$("m-qty-dec").onclick = () => { $("m-qty").value = Math.max(1, (parseInt($("m-qty").value || "1", 10) || 1) - 1); };
$("m-qty-inc").onclick = () => { $("m-qty").value = (parseInt($("m-qty").value || "1", 10) || 1) + 1; };
$("submit").onclick = submitOrder;
$("submit-later").onclick = submitOrderUnpaid;
$("pay-close").onclick = closePayment;
$("coupon-apply").onclick = applyCoupon;
$("coupon").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } });
$("coupon").addEventListener("input", () => { if (!$("coupon").value.trim()) { COUPON = null; updateTotal(); } });
["name", "phone", "email"].forEach((id) => $(id).addEventListener("input", syncCouponGate));
$("addr-find").onclick = () => { closeAddrSuggest(); geocodeAddress(); };
function toggleAddrClear() { $("addr-clear").hidden = !$("address").value; }
$("addr-clear").onclick = () => { $("address").value = ""; closeAddrSuggest(); toggleAddrClear(); $("address").focus(); };
$("address").addEventListener("input", toggleAddrClear);
$("address").addEventListener("input", onAddrInput);
$("address").addEventListener("blur", () => setTimeout(closeAddrSuggest, 150));   // ritardo: lascia scattare il click sul suggerimento
$("address").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); closeAddrSuggest(); geocodeAddress(); }
  else if (e.key === "Escape") closeAddrSuggest();
});
$("mode-delivery").onclick = () => setMode("delivery");
$("mode-pickup").onclick = () => setMode("pickup");
$("pickup-time").onchange = () => updateTotal();

// ⚠️ PROTOTIPO: precompila i dati cliente con valori di fantasia per non
// reinserirli a ogni test. Rimuovere in produzione.
$("name").value = "Mario Rossi";
$("phone").value = "333 1234567";
$("email").value = "mario.rossi@email.it";
syncCouponGate();   // stato iniziale del campo sconto
$("address").value = "Via Lu Pitrali, San Teodoro";   // default di prova (fase test)
toggleAddrClear();   // stato iniziale della X di reset

initMap();

// barra logo: bordino grigio solo quando si è scrollati (in cima niente bordo)
(function () {
  const bar = document.querySelector(".appbar");
  if (!bar) return;
  const onScroll = () => bar.classList.toggle("scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
loadData();
if ($("address").value.trim()) setTimeout(geocodeAddress, 700);   // prototipo: pin iniziale

// ricablaggio testi dinamici al cambio lingua (i testi statici li gestisce i18n.js)
if (window.I18N) I18N.onLangChange(function () {
  try {
    renderFormats();
    renderCart();
    renderDayPick();   // aggiorna i nomi dei giorni (Oggi/Domani/Lun…)
    if (isPickup()) { renderPickupTimes(); renderOpeningHours(); } else { renderSlotSelect(); }
    const dl = $("day-label"); if (dl) dl.textContent = isPickup() ? t("order.form.pickupDay") : t("order.form.deliveryDay");
    updateTotal();
  } catch (e) { console.error(e); }
});
