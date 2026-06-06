// ============ Mobile app — composizione e invio ordine ============
const $ = (id) => document.getElementById(id);
const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");

let DATA = { settings: { delivery_cost: 0, min_order: 0 }, flavors: [], formats: [], slots: [] };
let CART = [];
let modalFormat = null;        // formato attualmente in selezione nel modale
let modalChosen = [];          // gusti scelti nel modale

// ---------- giorni di consegna (prossimi 7, oggi incluso) ----------
const WD = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function next7() {
  const out = [], t = new Date(); t.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) { const d = new Date(t); d.setDate(t.getDate() + i); out.push(d); }
  return out;
}
const dayName = (d, i) => (i === 0 ? "Oggi" : i === 1 ? "Domani" : WD[d.getDay()]);
const dateLabel = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" }) : "-");
let DAYS = next7();
let SELECTED_DAY = ymd(DAYS[0]);
let DAY_OVERRIDES = new Map();   // slot_id -> active per il giorno scelto
let DAY_COUNTS = {};             // slot_label -> n. ordini in lavorazione nel giorno scelto
// ordini "in lavorazione" che occupano capienza (esclusi consegnato/rifiutato/annullato)
const LAVORAZIONE = ["ricevuto", "accettato", "in preparazione", "in consegna"];
// fascia piena: ha un tetto e gli ordini in lavorazione del giorno lo raggiungono
const slotFull = (s) => {
  const max = Number(s.max_deliveries);
  if (!max || max <= 0) return false;            // null / 0 = illimitato
  return (DAY_COUNTS[s.label] || 0) >= max;
};
// fasce effettivamente offribili nel giorno scelto: accese (override/catalogo) e non piene
const effectiveSlots = () => DATA.slots.filter((s) => {
  const on = DAY_OVERRIDES.has(s.id) ? DAY_OVERRIDES.get(s.id) : s.active;
  return on && !slotFull(s);
});

// ---------- mappa consegna + geofence San Teodoro ----------
const GELATERIA = { lat: 40.8410901, lng: 9.6538693, name: "Gelateria Bm&V Montepetrosu" };
const ST_BBOX = [[40.6967, 9.5776], [40.8649, 9.7287]];   // [S,W],[N,E] comune San Teodoro
let map = null, delivMarker = null, delIcon = null;
let DELIV_LAT = null, DELIV_LNG = null, IN_ZONE = false;

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
function initMap() {
  if (typeof L === "undefined" || !$("map")) return;
  map = L.map("map", { center: [GELATERIA.lat, GELATERIA.lng], zoom: 12, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  delIcon = pinIcon("#a8552f");   // terracotta = punto consegna
  L.marker([GELATERIA.lat, GELATERIA.lng], { icon: pinIcon("#2b2620") }).addTo(map)
    .bindPopup("<b>" + esc(GELATERIA.name) + "</b><br>Partenza consegne");
  map.fitBounds(ST_BBOX, { padding: [12, 12] });
  map.on("click", (e) => setDelivery(e.latlng.lat, e.latlng.lng, false, true));
  // pulsante "crocino" → posizione GPS dell'utente
  const Locate = L.Control.extend({ options: { position: "topleft" }, onAdd() {
    const a = L.DomUtil.create("a", "leaflet-bar locate-btn");
    a.href = "#"; a.title = "La mia posizione"; a.setAttribute("role", "button"); a.setAttribute("aria-label", "Trova la mia posizione");
    a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><line x1="12" y1="1.5" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22.5" y2="12"/></svg>';
    L.DomEvent.on(a, "click", L.DomEvent.stop).on(a, "click", locateMe);
    return a;
  } });
  map.addControl(new Locate());
  setTimeout(() => map.invalidateSize(), 250);
}
function locateMe() {
  if (!navigator.geolocation) { toast("Geolocalizzazione non disponibile sul dispositivo."); return; }
  toast("Cerco la tua posizione…");
  navigator.geolocation.getCurrentPosition(
    (pos) => setDelivery(pos.coords.latitude, pos.coords.longitude, true, true),
    (err) => toast(err && err.code === 1 ? "Permesso posizione negato." : "Posizione non disponibile."),
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
    else if (IN_ZONE) { el.textContent = "✓ Punto di consegna dentro la zona"; el.className = "zone-status ok"; }
    else { el.textContent = "✕ Fuori dalla zona di consegna"; el.className = "zone-status ko"; }
  }
  updateTotal();
}
async function geocodeAddress() {
  const q = $("address").value.trim();
  if (!q) { toast("Scrivi l'indirizzo, poi premi Trova."); return; }
  const query = q + (/teodoro/i.test(q) ? "" : ", San Teodoro") + ", Sardegna, Italia";
  const vb = "9.5776,40.8649,9.7287,40.6967";
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&viewbox=${vb}&q=${encodeURIComponent(query)}`);
    const d = await r.json();
    if (!d.length) { toast("Indirizzo non trovato. Trascina il pin sulla mappa."); return; }
    setDelivery(+d[0].lat, +d[0].lon, true, false);
  } catch (e) { console.error(e); toast("Ricerca mappa non disponibile. Trascina il pin."); }
}
async function reverseFill(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`);
    const d = await r.json();
    if (d && d.display_name) $("address").value = d.display_name.replace(/,\s*Italia$/, "");
  } catch (e) { /* reverse opzionale */ }
}

// ---------- caricamento dati ----------
async function loadData() {
  const [settings, flavors, formats, slots] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("flavors").select("*").eq("available", true).order("sort_order"),
    sb.from("formats").select("*").eq("available", true).order("sort_order"),
    sb.from("time_slots").select("*").order("sort_order"),
  ]);
  if (settings.error || flavors.error || formats.error || slots.error) {
    toast("Errore nel caricamento. Controlla la configurazione Supabase.");
    console.error(settings.error || flavors.error || formats.error || slots.error);
    return;
  }
  DATA = {
    settings: settings.data || { delivery_cost: 0, min_order: 0 },
    flavors: flavors.data, formats: formats.data, slots: slots.data,
  };
  const slotMin = (l) => { const m = String(l).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; };
  DATA.slots = (DATA.slots || []).slice().sort((a, b) => slotMin(a.label) - slotMin(b.label));   // fasce sempre in ordine orario
  drawDeliveryZone();
  renderFormats();
  renderDayPick();
  await loadDaySlots();
  renderCart();
}

// ---------- formati ----------
function renderFormats() {
  const wrap = $("formats");
  if (!DATA.formats.length) { wrap.innerHTML = '<p class="hint">Nessun prodotto disponibile al momento.</p>'; return; }
  wrap.innerHTML = "";
  DATA.formats.forEach((f) => {
    const el = document.createElement("div");
    el.className = "fmt";
    el.innerHTML =
      `<div class="meta"><div class="name">${esc(f.name)}</div>` +
      `<div class="desc">${f.max_flavors} gust${f.max_flavors === 1 ? "o" : "i"}</div></div>` +
      `<div class="price">${euro(f.price)}</div>` +
      `<button class="btn sm">Scegli</button>`;
    el.querySelector("button").onclick = () => openModal(f);
    wrap.appendChild(el);
  });
}

// ---------- modale gusti ----------
function openModal(format) {
  modalFormat = format; modalChosen = [];
  $("m-eyebrow").textContent =
    `${format.max_flavors} gust${format.max_flavors === 1 ? "o" : "i"} · ${euro(format.price)}`;
  $("m-title").textContent = format.name;
  $("m-hint").textContent =
    `Scegli fino a ${format.max_flavors} gust${format.max_flavors === 1 ? "o" : "i"} per questo formato.`;
  $("m-qty").value = 1;
  renderModalFlavors();
  $("modal").classList.add("show");
}
function closeModal() { $("modal").classList.remove("show"); }

function renderModalFlavors() {
  const wrap = $("m-flavors");
  wrap.innerHTML = "";
  if (!DATA.flavors.length) { wrap.innerHTML = '<p class="hint">Nessun gusto disponibile.</p>'; return; }
  DATA.flavors.forEach((g) => {
    const sel = modalChosen.includes(g.name);
    const full = modalChosen.length >= modalFormat.max_flavors;
    const b = document.createElement("button");
    b.className = "chip" + (sel ? " sel" : (full ? " off" : ""));
    b.textContent = g.name;
    b.disabled = !sel && full;
    b.onclick = () => {
      if (sel) modalChosen = modalChosen.filter((n) => n !== g.name);
      else if (modalChosen.length < modalFormat.max_flavors) modalChosen.push(g.name);
      renderModalFlavors();
    };
    wrap.appendChild(b);
  });
}

function addToCart() {
  if (modalChosen.length === 0) { toast("Scegli almeno un gusto."); return; }
  const qty = Math.max(1, parseInt($("m-qty").value || "1", 10));
  CART.push({
    format_id: modalFormat.id,
    format: modalFormat.name,
    gusti: [...modalChosen],
    qty,
    prezzo_unit: Number(modalFormat.price),
  });
  closeModal();
  renderCart();
  toast("Aggiunto al carrello.");
}

// ---------- carrello ----------
function renderCart() {
  const lines = $("cart-lines");
  $("cart-empty").style.display = CART.length ? "none" : "block";
  if (!CART.length) { lines.innerHTML = ""; updateTotal(); return; }
  const rows = CART.map((item, i) =>
    `<div class="cart-line"><div class="q">${item.qty}×</div>` +
    `<div class="body"><div class="t">${esc(item.format)}</div><div class="g">${esc(item.gusti.join(", "))}</div></div>` +
    `<div class="lp">${euro(item.prezzo_unit * item.qty)}</div>` +
    `<button class="btn icon rm" data-i="${i}" aria-label="Rimuovi">✕</button></div>`
  ).join("");
  const sub = subtotal();
  const delivery = Number(DATA.settings.delivery_cost);
  lines.innerHTML =
    `<div class="cart">${rows}` +
    `<div class="cart-foot">` +
    `<div class="r"><span>Subtotale</span><span>${euro(sub)}</span></div>` +
    `<div class="r"><span>Consegna</span><span>${euro(delivery)}</span></div>` +
    `<div class="r tot"><b>Totale</b><span class="v">${euro(sub + delivery)}</span></div>` +
    `</div></div>`;
  lines.querySelectorAll(".rm").forEach((btn) => {
    btn.onclick = () => { CART.splice(parseInt(btn.dataset.i, 10), 1); renderCart(); };
  });
  updateTotal();
}

function subtotal() { return CART.reduce((s, i) => s + i.prezzo_unit * i.qty, 0); }

function updateTotal() {
  const sub = subtotal();
  const delivery = CART.length ? Number(DATA.settings.delivery_cost) : 0;
  const total = sub + delivery;
  $("total").textContent = euro(total);
  const min = Number(DATA.settings.min_order);
  const okMin = sub >= min;
  const hasSlot = effectiveSlots().length > 0;
  const banner = $("min-banner");
  if (CART.length && !okMin) {
    banner.style.display = "block";
    banner.textContent = `Ordine minimo ${euro(min)}. Mancano ${euro(min - sub)} (consegna ${euro(delivery)}).`;
  } else if (CART.length && !hasSlot) {
    banner.style.display = "block";
    banner.textContent = "Nessuna fascia disponibile per il giorno scelto. Scegli un altro giorno.";
  } else if (CART.length && !IN_ZONE) {
    banner.style.display = "block";
    banner.textContent = "Indica sulla mappa un punto di consegna dentro la zona.";
  } else { banner.style.display = "none"; }
  $("submit").disabled = !(CART.length && okMin && hasSlot && IN_ZONE);
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
    b.onclick = () => { SELECTED_DAY = key; renderDayPick(); loadDaySlots(); };
    cal.appendChild(b);
  });
}

async function loadDaySlots() {
  const [ov, occ] = await Promise.all([
    sb.from("slot_day_state").select("slot_id, active").eq("day", SELECTED_DAY),
    sb.from("orders").select("slot_label").eq("delivery_date", SELECTED_DAY).in("status", LAVORAZIONE),
  ]);
  if (ov.error) console.error(ov.error);
  if (occ.error) console.error(occ.error);
  DAY_OVERRIDES = new Map((ov.data || []).map((r) => [r.slot_id, r.active]));
  DAY_COUNTS = {};
  (occ.data || []).forEach((r) => { if (r.slot_label) DAY_COUNTS[r.slot_label] = (DAY_COUNTS[r.slot_label] || 0) + 1; });
  renderSlotSelect();
}

function renderSlotSelect() {
  const s = $("slot");
  s.innerHTML = "";
  const slots = effectiveSlots();
  if (!slots.length) {
    s.innerHTML = '<option value="">Nessuna fascia disponibile</option>';
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
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  const address = $("address").value.trim();
  if (!name || !phone || !address) { toast("Compila nome, telefono e indirizzo."); return; }
  if (!(IN_ZONE && DELIV_LAT != null)) { toast("Posiziona il pin di consegna dentro la zona."); return; }
  if (!effectiveSlots().length) { toast("Nessuna fascia disponibile per il giorno scelto."); return; }

  // re-check capienza fascia prima dell'invio (best-effort anti-race)
  const chosen = $("slot").value;
  const slotObj = DATA.slots.find((s) => s.label === chosen);
  if (slotObj && Number(slotObj.max_deliveries) > 0) {
    const { count, error: capErr } = await sb.from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_date", SELECTED_DAY).eq("slot_label", chosen).in("status", LAVORAZIONE);
    if (!capErr && count != null && count >= Number(slotObj.max_deliveries)) {
      toast("Questa fascia si è appena riempita. Scegli un'altra fascia.");
      await loadDaySlots();
      return;
    }
  }

  const sub = subtotal();
  const delivery = Number(DATA.settings.delivery_cost);
  const payload = {
    customer_name: name,
    customer_phone: phone,
    email: $("email").value.trim() || null,
    address,
    delivery_lat: DELIV_LAT,
    delivery_lng: DELIV_LNG,
    delivery_date: SELECTED_DAY,
    slot_label: $("slot").value,
    items: CART,
    subtotal: sub,
    delivery_cost: delivery,
    total: sub + delivery,
    notes: $("notes").value.trim() || null,
    status: "ricevuto",
  };

  $("submit").disabled = true; $("submit").textContent = "Invio…";
  const { error } = await sb.from("orders").insert(payload);
  if (error) {
    console.error(error);
    toast("Errore nell'invio. Riprova.");
    $("submit").disabled = false; $("submit").textContent = "Invia ordine";
    return;
  }
  showConfirmation(payload);
}

function showConfirmation(o) {
  $("shop").classList.add("hidden");
  $("bar").style.display = "none";
  $("done").classList.remove("hidden");
  $("done-text").textContent =
    `Ti contatteremo a breve. Consegna prevista ${dateLabel(o.delivery_date)}, ${o.slot_label || "-"}.`;
  const rows = o.items.map((i) =>
    `<div class="cart-line"><div class="q">${i.qty}×</div>` +
    `<div class="body"><div class="t">${esc(i.format)}</div><div class="g">${esc(i.gusti.join(", "))}</div></div>` +
    `<div class="lp">${euro(i.prezzo_unit * i.qty)}</div></div>`
  ).join("");
  $("done-summary").innerHTML =
    rows +
    `<div class="cart-foot">` +
    `<div class="r"><span>Consegna</span><span>${euro(o.delivery_cost)}</span></div>` +
    `<div class="r tot"><b>Totale</b><span class="v">${euro(o.total)}</span></div>` +
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
$("addr-find").onclick = geocodeAddress;
$("address").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); geocodeAddress(); } });

// ⚠️ PROTOTIPO: precompila i dati cliente con valori di fantasia per non
// reinserirli a ogni test. Rimuovere in produzione.
$("name").value = "Mario Rossi";
$("phone").value = "333 1234567";
$("email").value = "mario.rossi@email.it";
$("address").value = "Via del Tirreno, San Teodoro";

initMap();
loadData();
if ($("address").value.trim()) setTimeout(geocodeAddress, 700);   // prototipo: pin iniziale
