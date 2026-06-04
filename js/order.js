// ============ Mobile app — composizione e invio ordine ============
const $ = (id) => document.getElementById(id);
const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");

let DATA = { settings: { delivery_cost: 0, min_order: 0 }, flavors: [], formats: [], slots: [] };
let CART = [];
let modalFormat = null;        // formato attualmente in selezione nel modale
let modalChosen = [];          // gusti scelti nel modale

// ---------- caricamento dati ----------
async function loadData() {
  const [settings, flavors, formats, slots] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).single(),
    sb.from("flavors").select("*").eq("available", true).order("sort_order"),
    sb.from("formats").select("*").eq("available", true).order("sort_order"),
    sb.from("time_slots").select("*").eq("active", true).order("sort_order"),
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
  renderFormats();
  renderSlots();
  renderCart();
}

// ---------- formati ----------
function renderFormats() {
  const wrap = $("formats");
  if (!DATA.formats.length) { wrap.innerHTML = '<p class="muted small">Nessun prodotto disponibile al momento.</p>'; return; }
  wrap.innerHTML = "";
  DATA.formats.forEach((f) => {
    const el = document.createElement("div");
    el.className = "card row between";
    el.innerHTML =
      `<div class="grow"><b>${esc(f.name)}</b>` +
      `<div class="muted small">${f.max_flavors} gust${f.max_flavors === 1 ? "o" : "i"}</div></div>` +
      `<div class="price" style="margin-right:10px">${euro(f.price)}</div>` +
      `<button class="btn sm">Scegli</button>`;
    el.querySelector("button").onclick = () => openModal(f);
    wrap.appendChild(el);
  });
}

// ---------- modale gusti ----------
function openModal(format) {
  modalFormat = format; modalChosen = [];
  $("m-title").textContent = format.name;
  $("m-hint").textContent =
    `Scegli fino a ${format.max_flavors} gust${format.max_flavors === 1 ? "o" : "i"} · ${euro(format.price)}`;
  $("m-qty").value = 1;
  renderModalFlavors();
  $("modal").classList.add("show");
}
function closeModal() { $("modal").classList.remove("show"); }

function renderModalFlavors() {
  const wrap = $("m-flavors");
  wrap.innerHTML = "";
  if (!DATA.flavors.length) { wrap.innerHTML = '<p class="muted small">Nessun gusto disponibile.</p>'; return; }
  DATA.flavors.forEach((g) => {
    const sel = modalChosen.includes(g.name);
    const full = modalChosen.length >= modalFormat.max_flavors;
    const b = document.createElement("button");
    b.className = "chip" + (sel ? " sel" : "");
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
  toast("Aggiunto al carrello 🍦");
}

// ---------- carrello ----------
function renderCart() {
  const lines = $("cart-lines");
  $("cart-empty").style.display = CART.length ? "none" : "block";
  lines.innerHTML = "";
  CART.forEach((item, i) => {
    const el = document.createElement("div");
    el.className = "line";
    el.innerHTML =
      `<div class="grow"><b>${item.qty}× ${esc(item.format)}</b>` +
      `<div class="muted small">${esc(item.gusti.join(", "))}</div></div>` +
      `<div class="price">${euro(item.prezzo_unit * item.qty)}</div>` +
      `<button class="btn danger sm" style="margin-left:8px">✕</button>`;
    el.querySelector("button").onclick = () => { CART.splice(i, 1); renderCart(); };
    lines.appendChild(el);
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
  const banner = $("min-banner");
  if (CART.length && !okMin) {
    banner.style.display = "block";
    banner.textContent = `Ordine minimo ${euro(min)}. Mancano ${euro(min - sub)} (consegna ${euro(delivery)}).`;
  } else { banner.style.display = "none"; }
  $("submit").disabled = !(CART.length && okMin);
}

// ---------- slot ----------
function renderSlots() {
  const s = $("slot");
  s.innerHTML = "";
  if (!DATA.slots.length) {
    s.innerHTML = '<option value="">Nessuna fascia disponibile</option>';
    return;
  }
  DATA.slots.forEach((sl) => {
    const o = document.createElement("option");
    o.value = sl.label; o.textContent = sl.label;
    s.appendChild(o);
  });
}

// ---------- invio ----------
async function submitOrder() {
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  const address = $("address").value.trim();
  if (!name || !phone || !address) { toast("Compila nome, telefono e indirizzo."); return; }
  if (!DATA.slots.length) { toast("Nessuna fascia di consegna disponibile."); return; }

  const sub = subtotal();
  const delivery = Number(DATA.settings.delivery_cost);
  const payload = {
    customer_name: name,
    customer_phone: phone,
    address,
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
  const rows = o.items.map((i) =>
    `<div class="line"><div class="grow">${i.qty}× ${esc(i.format)}<div class="muted small">${esc(i.gusti.join(", "))}</div></div><div class="price">${euro(i.prezzo_unit * i.qty)}</div></div>`
  ).join("");
  $("done-summary").innerHTML =
    rows +
    `<div class="row between" style="margin-top:10px"><span class="muted">Consegna</span><span>${euro(o.delivery_cost)}</span></div>` +
    `<div class="row between"><b>Totale</b><b class="price">${euro(o.total)}</b></div>` +
    `<div class="muted small" style="margin-top:8px">Consegna: ${esc(o.slot_label || "-")}</div>`;
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
$("submit").onclick = submitOrder;

loadData();
