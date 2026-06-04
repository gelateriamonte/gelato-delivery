// ============ Back office — gestione parametri + ordini live ============
const $ = (id) => document.getElementById(id);
const euro = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STATUSES = ["ricevuto", "accettato", "in preparazione", "in consegna", "consegnato", "rifiutato", "annullato"];
let ORDERS = [];

// ---------- LOGIN GATE ----------
function tryLogin() {
  const ok = $("pw").value === window.ADMIN_PASSWORD;
  if (!ok) { toast("Password errata."); return; }
  sessionStorage.setItem("gelato_admin", "1");
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
  };
});

// ---------- INIT ----------
async function initApp() {
  await Promise.all([loadOrders(), loadFlavors(), loadFormats(), loadSlots(), loadSettings()]);
  subscribeOrders();
}

// ========== ORDINI ==========
async function loadOrders() {
  const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); toast("Errore caricamento ordini."); return; }
  ORDERS = data;
  renderOrders();
}

function renderOrders() {
  $("orders-count").textContent = ORDERS.length;
  const list = $("orders-list");
  if (!ORDERS.length) { list.innerHTML = '<p class="muted small">Nessun ordine.</p>'; return; }
  list.innerHTML = "";
  ORDERS.forEach((o) => list.appendChild(orderCard(o)));
}

function orderCard(o) {
  const el = document.createElement("div");
  el.className = "card";
  el.id = "order-" + o.id;
  const items = (o.items || []).map((i) =>
    `<div class="line"><div class="grow">${i.qty}× ${esc(i.format)}<div class="muted small">${esc((i.gusti || []).join(", "))}</div></div><div class="price">${euro(i.prezzo_unit * i.qty)}</div></div>`
  ).join("");
  const when = new Date(o.created_at).toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const opts = STATUSES.map((s) => `<option value="${s}"${s === o.status ? " selected" : ""}>${s}</option>`).join("");
  el.innerHTML =
    `<div class="row between"><b>${esc(o.customer_name)}</b><span class="muted small">${when}</span></div>` +
    `<div class="muted small">${esc(o.customer_phone)} · ${esc(o.address)}</div>` +
    `<div class="muted small">🕒 ${esc(o.slot_label || "-")}</div>` +
    (o.notes ? `<div class="muted small">📝 ${esc(o.notes)}</div>` : "") +
    `<div style="margin:8px 0">${items}</div>` +
    `<div class="row between"><span class="muted small">Consegna ${euro(o.delivery_cost)}</span><b class="price">${euro(o.total)}</b></div>` +
    `<div class="row" style="margin-top:10px"><span class="muted small grow">Stato</span><select class="status"></select></div>`;
  const sel = el.querySelector("select");
  sel.innerHTML = opts;
  sel.onchange = () => updateStatus(o.id, sel.value);
  return el;
}

async function updateStatus(id, status) {
  const { error } = await sb.from("orders").update({ status }).eq("id", id);
  if (error) { console.error(error); toast("Errore aggiornamento stato."); return; }
  toast("Stato aggiornato.");
}

function subscribeOrders() {
  sb.channel("orders-rt")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (p) => {
      ORDERS.unshift(p.new); renderOrders();
      toast("🔔 Nuovo ordine!"); beep();
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
    el.className = "card row between";
    el.innerHTML =
      `<input class="grow" value="${esc(f.name)}">` +
      `<button class="btn sm ${f.available ? "mint" : "ghost"}" style="margin:0 8px">${f.available ? "Disponibile" : "Nascosto"}</button>` +
      `<button class="btn danger sm">✕</button>`;
    const [input, toggle, del] = [el.querySelector("input"), el.querySelectorAll("button")[0], el.querySelectorAll("button")[1]];
    input.onchange = () => updateRow("flavors", f.id, { name: input.value.trim() });
    toggle.onclick = async () => { await updateRow("flavors", f.id, { available: !f.available }); loadFlavors(); };
    del.onclick = async () => { await delRow("flavors", f.id); loadFlavors(); };
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
    el.className = "card stack";
    el.innerHTML =
      `<input class="f-name" value="${esc(f.name)}">` +
      `<div class="row" style="gap:8px">` +
      `<div class="grow"><label>Gusti max</label><input class="f-max" type="number" min="1" value="${f.max_flavors}"></div>` +
      `<div class="grow"><label>Prezzo €</label><input class="f-price" type="number" min="0" step="0.50" value="${f.price}"></div>` +
      `</div>` +
      `<div class="row between">` +
      `<button class="btn sm ${f.available ? "mint" : "ghost"}">${f.available ? "Disponibile" : "Nascosto"}</button>` +
      `<button class="btn danger sm">Elimina</button></div>`;
    const name = el.querySelector(".f-name"), max = el.querySelector(".f-max"), price = el.querySelector(".f-price");
    const [toggle, del] = el.querySelectorAll(".between button");
    name.onchange = () => updateRow("formats", f.id, { name: name.value.trim() });
    max.onchange = () => updateRow("formats", f.id, { max_flavors: parseInt(max.value || "1", 10) });
    price.onchange = () => updateRow("formats", f.id, { price: parseFloat(price.value || "0") });
    toggle.onclick = async () => { await updateRow("formats", f.id, { available: !f.available }); loadFormats(); };
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

// ========== FASCE ==========
async function loadSlots() {
  const { data, error } = await sb.from("time_slots").select("*").order("sort_order");
  if (error) { console.error(error); return; }
  const list = $("slots-list");
  list.innerHTML = "";
  data.forEach((s) => {
    const el = document.createElement("div");
    el.className = "card row between";
    el.innerHTML =
      `<input class="grow" value="${esc(s.label)}">` +
      `<button class="btn sm ${s.active ? "mint" : "ghost"}" style="margin:0 8px">${s.active ? "Attiva" : "Spenta"}</button>` +
      `<button class="btn danger sm">✕</button>`;
    const input = el.querySelector("input");
    const [toggle, del] = el.querySelectorAll("button");
    input.onchange = () => updateRow("time_slots", s.id, { label: input.value.trim() });
    toggle.onclick = async () => { await updateRow("time_slots", s.id, { active: !s.active }); loadSlots(); };
    del.onclick = async () => { await delRow("time_slots", s.id); loadSlots(); };
    list.appendChild(el);
  });
}
$("ns-add").onclick = async () => {
  const label = $("ns-label").value.trim(); if (!label) return;
  await sb.from("time_slots").insert({ label, sort_order: Date.now() % 100000 });
  $("ns-label").value = ""; loadSlots();
};

// ========== PARAMETRI ==========
async function loadSettings() {
  const { data, error } = await sb.from("settings").select("*").eq("id", 1).single();
  if (error) { console.error(error); return; }
  $("set-delivery").value = data.delivery_cost;
  $("set-min").value = data.min_order;
}
$("set-save").onclick = async () => {
  const { error } = await sb.from("settings").update({
    delivery_cost: parseFloat($("set-delivery").value || "0"),
    min_order: parseFloat($("set-min").value || "0"),
  }).eq("id", 1);
  if (error) { console.error(error); toast("Errore salvataggio."); return; }
  toast("Parametri salvati.");
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
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (e) { /* audio non disponibile */ }
}
