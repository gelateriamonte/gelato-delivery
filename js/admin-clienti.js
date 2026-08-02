// ============ Back office — Anagrafica clienti ============
// Tab "Clienti": elenco unico dei clienti (gelato + torte), ricerca per nome o
// telefono, modifica in linea. Solo uso interno, tutto in italiano.
// Si aggancia da solo ad admin.html: js/admin.js non va toccato.
/* global $, esc, euro, toast, updateRow, cakeFmtKg */
/* exported CUSTOMERS_ALL, cliNormPhone, findCustomerByPhone, loadCustomers, renderCustomers, customersReady */

let CUSTOMERS_ALL = [];
let CUSTOMERS_LOADED = false;   // il caricamento avviene alla prima apertura della tab
let CUSTOMERS_LOADING = null;   // promise del caricamento in corso (vedi customersReady)
// telefono normalizzato → { gelato:[], torte:[] } dei soli ordini CONCLUSI, per la
// scheda che si apre dalla riga cliente. Chiave uguale a quella dei conteggi.
let CUSTOMER_ORDERS = new Map();

// Copia lato client di public.norm_mobile() (migration 2026-07-19): stessa identica
// logica, altrimenti la ricerca per numero non ritroverebbe cio' che il database ha
// scritto nella colonna generata phone_norm.
// ⚠️ Si chiama cliNormPhone e NON normPhone: js/admin.js ha gia' una sua normPhone()
// che fa l'opposto (AGGIUNGE il prefisso 39 per i link wa.me). Sono script classici
// nello stesso scope globale e questo file e' caricato dopo: chiamandola normPhone si
// sovrascriverebbe la sua e WhatsApp aprirebbe wa.me/3351234567 (prefisso Francia).
// Casi che deve soddisfare:
//   "+39 335 256919"  -> "335256919"
//   "335256919"       -> "335256919"
//   "0039335256919"   -> "335256919"
//   "347 1234567"     -> "3471234567"   (10 cifre: nessun prefisso da togliere)
//   "39 347 1234567"  -> "3471234567"
//   "(335) 25-69.19"  -> "335256919"
//   "da chiedere"     -> ""             (nessuna cifra: rifiutato da cliPhoneError)
function cliNormPhone(s) {
  const d = String(s == null ? "" : s).replace(/\D/g, "");           // via spazi, punti, trattini, parentesi, +
  if (d.slice(0, 4) === "0039") return d.slice(4);
  // prefisso 39 solo se cio' che resta e' un numero plausibile (9 o 10 cifre)
  if ((d.length === 11 || d.length === 12) && d.slice(0, 2) === "39") return d.slice(2);
  return d;
}

// Un telefono normalizzato piu' corto di cosi' non identifica nessuno: phone_norm = ''
// passa l'indice unico una volta sola, quindi tutti i clienti senza numero finirebbero
// sulla stessa riga, che cambierebbe intestatario a ogni ordine.
const CLI_PHONE_MIN_DIGITS = 9;

// "" se il telefono va bene, altrimenti il messaggio da mostrare.
function cliPhoneError(v) {
  const d = cliNormPhone(v);
  if (!d) return "Serve un numero di telefono: è quello che identifica il cliente.";
  if (d.length < CLI_PHONE_MIN_DIGITS) return "Telefono non valido: servono almeno " + CLI_PHONE_MIN_DIGITS + " cifre.";
  return "";
}

// Cliente con questo numero, in qualunque forma sia scritto. null se non c'e'.
function findCustomerByPhone(p) {
  const d = cliNormPhone(p);
  if (!d) return null;
  return CUSTOMERS_ALL.find((c) => (c.phone_norm || cliNormPhone(c.phone)) === d) || null;
}

// "Concluso" = consegnato, in entrambe le tabelle. Restano fuori gli ordini ancora in
// corso e quelli annullati o rifiutati: la scheda risponde a "quanto ha comprato
// davvero questo cliente", e un ordine annullato non e' mai stato una vendita.
const CLI_DONE = "consegnato";

// Un passaggio solo sulle due tabelle: da li' escono sia il conteggio di TUTTI gli
// ordini (l'etichetta sulla riga, come prima) sia l'elenco dei soli conclusi che si
// apre sotto. PostgREST non raggruppa: si raggruppa qui, sono poche righe.
async function customerOrders() {
  const counts = new Map();
  const details = new Map();
  const bucket = (k) => {
    if (!details.has(k)) details.set(k, { gelato: [], torte: [] });
    return details.get(k);
  };
  const tally = (rows, tipo) => (rows || []).forEach((r) => {
    const k = cliNormPhone(r.customer_phone);
    if (!k) return;
    counts.set(k, (counts.get(k) || 0) + 1);
    if (r.status === CLI_DONE) bucket(k)[tipo].push(r);
  });
  const [gelato, torte] = await Promise.all([
    sb.from("orders").select("id,customer_phone,delivery_date,slot_label,fulfillment,total,status,created_at"),
    sb.from("cake_orders").select("id,customer_phone,item_name,variant,weight_kg,price,pickup_at,delivered_at,status"),
  ]);
  if (gelato.error) console.error("ordini gelato del cliente", gelato.error); else tally(gelato.data, "gelato");
  if (torte.error) console.error("ordini torta del cliente", torte.error); else tally(torte.data, "torte");
  // il piu' recente in cima, in entrambi gli elenchi
  details.forEach((d) => {
    d.gelato.sort((a, b) => cliTime(b.delivery_date || b.created_at) - cliTime(a.delivery_date || a.created_at));
    d.torte.sort((a, b) => cliTime(b.delivered_at || b.pickup_at) - cliTime(a.delivered_at || a.pickup_at));
  });
  return { counts, details };
}

async function loadCustomers() {
  const [res, ord] = await Promise.all([
    sb.from("customers").select("id,name,phone,phone_norm,email,notes").order("name"),
    customerOrders(),
  ]);
  if (res.error) { console.error(res.error); toast("Errore caricamento clienti."); return; }
  CUSTOMERS_ALL = res.data || [];
  CUSTOMER_ORDERS = ord.details;
  CUSTOMERS_ALL.forEach((c) => { c.orders_count = ord.counts.get(c.phone_norm || cliNormPhone(c.phone)) || 0; });
  CUSTOMERS_LOADED = true;
  renderCustomers();
}

// L'anagrafica serve anche fuori dalla tab Clienti (la modale ordine torta riconosce il
// cliente dal numero): chi lavora solo nella tab Torte non l'ha mai caricata.
// Idempotente: carica la prima volta, non fa nulla se e' gia' in memoria, e se due
// chiamate arrivano insieme condividono la stessa promise invece di fare due query.
// In caso di errore loadCustomers non alza CUSTOMERS_LOADED: il tentativo dopo riprova.
function customersReady() {
  if (CUSTOMERS_LOADED) return Promise.resolve();
  if (!CUSTOMERS_LOADING) {
    CUSTOMERS_LOADING = loadCustomers().finally(() => { CUSTOMERS_LOADING = null; });
  }
  return CUSTOMERS_LOADING;
}

function filterCustomers(q) {
  if (!q) return CUSTOMERS_ALL;
  const t = q.toLowerCase();
  const d = cliNormPhone(q);
  return CUSTOMERS_ALL.filter((c) =>
    String(c.name || "").toLowerCase().includes(t) ||
    (!!d && String(c.phone_norm || cliNormPhone(c.phone)).includes(d))
  );
}

function ordersLabel(n) {
  if (!n) return "nessun ordine";
  return n === 1 ? "1 ordine" : n + " ordini";
}

// ---------- ordini conclusi del cliente (scheda che si apre dalla riga) ----------
// Data non valida = 0: finisce in fondo all'ordinamento invece di far saltare il confronto.
function cliTime(v) {
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}
function cliDay(v) {
  const d = new Date(v);
  if (!v || isNaN(d)) return "—";
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") +
    "/" + d.getFullYear();
}

function cliOrdersOf(c) {
  return CUSTOMER_ORDERS.get(c.phone_norm || cliNormPhone(c.phone)) || { gelato: [], torte: [] };
}

// una riga = data · cosa era · quanto. Il totale del gruppo sta nell'intestazione.
function cliOrderLine(quando, cosa, importo) {
  return `<div class="cli-ord">` +
      `<span class="cli-ord-d">${esc(quando)}</span>` +
      `<span class="cli-ord-x">${esc(cosa)}</span>` +
      `<span class="cli-ord-e">${esc(euro(importo))}</span>` +
    `</div>`;
}

function cliGroupHtml(titolo, righe, totale) {
  if (!righe.length) return "";
  return `<div class="cli-grp">` +
      `<div class="cli-grp-h"><b>${esc(titolo)}</b>` +
        `<span>${righe.length === 1 ? "1 concluso" : righe.length + " conclusi"}</span>` +
        `<span class="cli-grp-tot">${esc(euro(totale))}</span></div>` +
      righe.join("") +
    `</div>`;
}

// La scheda si costruisce una volta sola, alla prima apertura: finche' resta chiusa non
// c'e' motivo di disegnare le righe di chi non le guarda.
function cliOrdersHtml(c) {
  const { gelato, torte } = cliOrdersOf(c);
  if (!gelato.length && !torte.length) return "";
  const somma = (rows, campo) => rows.reduce((t, r) => t + Number(r[campo] || 0), 0);
  const totGelato = somma(gelato, "total");
  const totTorte = somma(torte, "price");

  const rGelato = gelato.map((o) => {
    const tipo = o.fulfillment === "pickup" ? "ritiro" : "consegna";
    const fascia = o.slot_label || "";
    // le fasce dei ritiri sono gia' scritte "Ritiro 13:00": senza questo controllo
    // la riga diventa "ritiro · Ritiro 13:00"
    const cosa = fascia.toLowerCase().startsWith(tipo) ? fascia : [tipo, fascia].filter(Boolean).join(" · ");
    return cliOrderLine(cliDay(o.delivery_date || o.created_at), cosa, o.total);
  });
  // il peso c'e' dagli ordini a kg in poi; prima al suo posto c'era il formato
  const rTorte = torte.map((o) => cliOrderLine(
    cliDay(o.delivered_at || o.pickup_at),
    [o.item_name, o.weight_kg != null ? cakeFmtKg(o.weight_kg) : o.variant].filter(Boolean).join(" · "),
    o.price));

  return cliGroupHtml("Gelato", rGelato, totGelato) +
    cliGroupHtml("Torte", rTorte, totTorte) +
    `<div class="cli-tot">Totale speso <b>${esc(euro(totGelato + totTorte))}</b></div>`;
}

function renderCustomers() {
  const list = $("clienti-list");
  if (!list) return;                                  // tab non presente: niente da disegnare
  const search = $("cli-search");
  const q = search ? search.value.trim() : "";
  const rows = filterCustomers(q);
  const stats = $("cli-stats");
  if (stats) {
    const tot = CUSTOMERS_ALL.length;
    stats.textContent = rows.length === tot
      ? tot + (tot === 1 ? " cliente" : " clienti")
      : rows.length + " di " + tot + " clienti";
  }
  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML = '<p class="muted small" style="margin:0;padding:6px 2px">' +
      (CUSTOMERS_ALL.length ? "Nessun cliente con questa ricerca." : "Anagrafica vuota.") + "</p>";
    return;
  }
  rows.forEach((c) => list.appendChild(buildCustomerRow(c)));
}

// updated_at non ha trigger a database: lo aggiorna chi scrive.
function saveCustomer(id, patch) {
  return updateRow("customers", id, Object.assign({ updated_at: new Date().toISOString() }, patch));
}

function buildCustomerRow(c) {
  const frow = document.createElement("div");
  frow.className = "frow"; frow.dataset.id = c.id;

  const el = document.createElement("div");
  el.className = "mrow";
  // il telefono ha un max-width esplicito: su WebKit un input dentro un flex tiene
  // la larghezza intrinseca (max-content) e sfonda la riga.
  const done = cliOrdersOf(c);
  const apribile = !!(done.gelato.length || done.torte.length);
  // L'etichetta conta TUTTI gli ordini (come prima); la scheda mostra solo i conclusi.
  // Diventa un bottone solo se c'e' qualcosa da aprire: un affordance che non apre niente
  // e' peggio di nessun affordance.
  el.innerHTML =
    `<input class="cli-name grow" value="${esc(c.name)}" placeholder="Nome e cognome">` +
    `<input class="cli-phone" type="tel" inputmode="tel" value="${esc(c.phone)}" placeholder="Telefono"` +
    ` style="flex:0 0 152px;max-width:152px;min-width:0">` +
    (apribile
      ? `<button type="button" class="count cli-toggle" aria-expanded="false">` +
          `${esc(ordersLabel(c.orders_count))} <span class="cli-caret" aria-hidden="true">▾</span></button>`
      : `<span class="count">${esc(ordersLabel(c.orders_count))}</span>`);
  frow.appendChild(el);

  // email e note su righe proprie: a schermo stretto quattro campi in fila sono illeggibili
  const email = document.createElement("input");
  email.className = "g-desc"; email.type = "email"; email.placeholder = "Email";
  email.value = c.email || "";
  frow.appendChild(email);

  const notes = document.createElement("input");
  notes.className = "g-desc"; notes.placeholder = "Note (es. senza glutine, cliente storico)";
  notes.value = c.notes || "";
  frow.appendChild(notes);

  // scheda ordini: in fondo alla card, sotto i campi modificabili. Si disegna alla prima
  // apertura — con l'anagrafica intera a schermo, disegnarle tutte sarebbe lavoro buttato.
  if (apribile) {
    const panel = document.createElement("div");
    panel.className = "cli-orders hidden";
    frow.appendChild(panel);
    const btn = el.querySelector(".cli-toggle");
    btn.onclick = () => {
      const aperto = !panel.classList.toggle("hidden");
      if (aperto && !panel.dataset.pronto) {
        panel.innerHTML = cliOrdersHtml(c);
        panel.dataset.pronto = "1";
      }
      btn.setAttribute("aria-expanded", String(aperto));
      btn.classList.toggle("open", aperto);
    };
  }

  const name = el.querySelector(".cli-name");
  name.onchange = () => {
    const v = name.value.trim();
    if (!v) { name.value = c.name; toast("Il nome non può restare vuoto."); return; }
    c.name = v;
    saveCustomer(c.id, { name: v });
  };

  const phone = el.querySelector(".cli-phone");
  phone.onchange = async () => {
    const v = phone.value.trim();
    const err = cliPhoneError(v);
    if (err) { phone.value = c.phone; toast(err); return; }
    const d = cliNormPhone(v);
    if (CUSTOMERS_ALL.some((x) => x.id !== c.id && (x.phone_norm || cliNormPhone(x.phone)) === d)) {
      phone.value = c.phone; toast("Questo numero è già di un altro cliente."); return;
    }
    await saveCustomer(c.id, { phone: v });
    await loadCustomers();   // phone_norm è generata a database: si rilegge, non si indovina
  };

  email.onchange = () => {
    const v = email.value.trim() || null;
    c.email = v;
    saveCustomer(c.id, { email: v });
  };
  notes.onchange = () => {
    const v = notes.value.trim() || null;
    c.notes = v;
    saveCustomer(c.id, { notes: v });
  };

  return frow;
}

// ---------- aggancio ----------
// js/admin.js assegna .onclick alle tab: qui si aggiunge un listener separato, che
// non lo sovrascrive. Il caricamento avviene alla prima apertura della tab.
const cliTabBtn = document.querySelector('.tab[data-tab="clienti"]');
if (cliTabBtn) cliTabBtn.addEventListener("click", () => { customersReady(); });
if ($("cli-search")) $("cli-search").addEventListener("input", renderCustomers);
