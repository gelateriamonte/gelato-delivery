// ============ Back office — Anagrafica clienti ============
// Tab "Clienti": elenco unico dei clienti (gelato + torte), ricerca per nome o
// telefono, modifica in linea. Solo uso interno, tutto in italiano.
// Si aggancia da solo ad admin.html: js/admin.js non va toccato.
/* global $, esc, euro, toast, mkBtn, withAuthRetry, cakeFmtKg, cakePayAndRefresh */
/* exported CUSTOMERS_ALL, cliNormPhone, findCustomerByPhone, loadCustomers, renderCustomers, customersReady, cliDay */

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
  const counts = new Map();          // k → { gelato, torte }: TUTTI gli ordini, per le pillole
  const details = new Map();
  const bucket = (k) => {
    if (!details.has(k)) details.set(k, { gelato: [], torte: [] });
    return details.get(k);
  };
  const tally = (rows, tipo) => (rows || []).forEach((r) => {
    const k = cliNormPhone(r.customer_phone);
    if (!k) return;
    if (!counts.has(k)) counts.set(k, { gelato: 0, torte: 0 });
    counts.get(k)[tipo]++;
    if (r.status === CLI_DONE) bucket(k)[tipo].push(r);
  });
  const [gelato, torte] = await Promise.all([
    sb.from("orders").select("id,customer_phone,delivery_date,slot_label,fulfillment,total,status,created_at"),
    sb.from("cake_orders").select("id,customer_phone,item_name,variant,weight_kg,price,pickup_at,delivered_at,status," +
      "paid_at,payment_due_date"),
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
  CUSTOMERS_ALL.forEach((c) => {
    const n = ord.counts.get(c.phone_norm || cliNormPhone(c.phone));
    c.gelato_count = n ? n.gelato : 0;
    c.torte_count = n ? n.torte : 0;
  });
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

// una riga = data · cosa era · (eventuale coda, es. "da pagare") · quanto.
// Il totale del gruppo sta nell'intestazione.
function cliOrderLine(quando, cosa, importo, coda) {
  return `<div class="cli-ord">` +
      `<span class="cli-ord-d">${esc(quando)}</span>` +
      `<span class="cli-ord-x">${esc(cosa)}</span>` +
      (coda || "") +
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

function cliVuoto(msg) {
  return '<p class="muted small" style="margin:0">' + esc(msg) + "</p>";
}

// Contenuto del pannello sotto la card, per vista: "gelato", "torte" o "sospesi".
// Si ridisegna a ogni apertura: i sospesi cambiano quando si incassa.
function cliPanelHtml(c, view) {
  const { gelato, torte } = cliOrdersOf(c);
  const somma = (rows, campo) => rows.reduce((t, r) => t + Number(r[campo] || 0), 0);

  if (view === "gelato") {
    const righe = gelato.map((o) => {
      const tipo = o.fulfillment === "pickup" ? "ritiro" : "consegna";
      const fascia = o.slot_label || "";
      // le fasce dei ritiri sono gia' scritte "Ritiro 13:00": senza questo controllo
      // la riga diventa "ritiro · Ritiro 13:00"
      const cosa = fascia.toLowerCase().startsWith(tipo) ? fascia : [tipo, fascia].filter(Boolean).join(" · ");
      return cliOrderLine(cliDay(o.delivery_date || o.created_at), cosa, o.total);
    });
    return cliGroupHtml("Gelato", righe, somma(gelato, "total")) || cliVuoto("Nessun ordine gelato concluso.");
  }

  if (view === "torte") {
    // il peso c'e' dagli ordini a kg in poi; prima al suo posto c'era il formato.
    // Sui non incassati resta il segno "da pagare": si vede anche da questa vista.
    const righe = torte.map((o) => cliOrderLine(
      cliDay(o.delivered_at || o.pickup_at),
      [o.item_name, o.weight_kg != null ? cakeFmtKg(o.weight_kg) : o.variant].filter(Boolean).join(" · "),
      o.price,
      o.paid_at ? "" : '<span class="cli-ord-due">da pagare</span>'));
    return cliGroupHtml("Torte", righe, somma(torte, "price")) || cliVuoto("Nessun ordine torta concluso.");
  }

  // sospesi: scadenza e chiusura singola per riga, chiusura di tutto in fondo
  const sospesi = torte.filter((o) => !o.paid_at);
  if (!sospesi.length) return cliVuoto("Nessun pagamento in sospeso.");
  const righe = sospesi.map((o) =>
    `<div class="cli-ord">` +
      `<span class="cli-ord-d">${esc(cliDay(o.delivered_at || o.pickup_at))}</span>` +
      `<span class="cli-ord-x">${esc([o.item_name, o.weight_kg != null ? cakeFmtKg(o.weight_kg) : o.variant].filter(Boolean).join(" · "))}</span>` +
      (o.payment_due_date ? `<span class="cli-ord-due">entro ${esc(cliDay(o.payment_due_date))}</span>` : "") +
      `<span class="cli-ord-e">${esc(euro(o.price))}</span>` +
      `<button type="button" class="btn ok sm cli-pay" data-id="${esc(o.id)}">Pagato</button>` +
    `</div>`).join("");
  return `<div class="cli-grp">` +
      `<div class="cli-grp-h"><b>Da pagare</b>` +
        `<span>${sospesi.length === 1 ? "1 ordine" : sospesi.length + " ordini"}</span>` +
        `<span class="cli-grp-tot">${esc(euro(somma(sospesi, "price")))}</span></div>` +
      righe +
    `</div>` +
    (sospesi.length > 1
      ? `<button type="button" class="btn sm cli-payall" style="margin-top:10px">Segna tutti pagati (${sospesi.length})</button>`
      : "");
}

// Bottoni "Pagato" del pannello sospesi. La scrittura sta in admin-torte.js
// (cakePayAndRefresh), che a fine incasso ricarica anche questa anagrafica:
// la card si ridisegna e il sospeso sparisce da solo.
function cliWirePay(panel) {
  const singoli = panel.querySelectorAll(".cli-pay");
  singoli.forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await cakePayAndRefresh([b.dataset.id], "Ordine incassato."); }
      finally { b.disabled = false; }
    };
  });
  const tutti = panel.querySelector(".cli-payall");
  if (tutti) tutti.onclick = async () => {
    tutti.disabled = true;
    try { await cakePayAndRefresh(Array.from(singoli).map((b) => b.dataset.id), "Ordini incassati."); }
    finally { tutti.disabled = false; }
  };
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

// Ritorna true solo se ha scritto davvero. Non passa da updateRow: quello inghiotte
// l'esito (toast generico e nient'altro), e "Cliente aggiornato." finirebbe a schermo
// anche a scrittura fallita. updated_at non ha trigger a database: lo aggiorna chi scrive.
async function saveCustomer(id, patch) {
  const { error } = await withAuthRetry(() => sb.from("customers")
    .update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq("id", id));
  if (error) { console.error("saveCustomer", error); toast("Errore salvataggio cliente."); return false; }
  return true;
}

// Scheda cliente. In LETTURA è testo, non caselle: con quattro input identici uno sotto
// l'altro per ogni cliente, l'elenco diventa una griglia di rettangoli tutti uguali in cui
// non si vede dove finisce una scheda e comincia la successiva. Le caselle compaiono solo
// premendo Modifica, che è anche la rete contro la correzione involontaria mentre si scorre.
function buildCustomerRow(c) {
  const frow = document.createElement("div");
  frow.className = "frow clicard"; frow.dataset.id = c.id;

  const done = cliOrdersOf(c);
  const sospesi = done.torte.filter((o) => !o.paid_at);
  // Una pillola per tipo: il conteggio e' su TUTTI gli ordini, la scheda mostra i
  // conclusi. Diventa un bottone solo se c'è qualcosa da aprire: un affordance che
  // non apre niente è peggio di nessun affordance. Il badge rosso dei sospesi compare
  // solo quando ci sono soldi da incassare: è la cosa da vedere a colpo d'occhio.
  const pill = (view, label, apribile, extra) => apribile
    ? `<button type="button" class="count cli-toggle${extra || ""}" data-view="${view}" aria-expanded="false">` +
        `${esc(label)} <span class="cli-caret" aria-hidden="true">▾</span></button>`
    : `<span class="count">${esc(label)}</span>`;
  const pillole = `<div class="cli-pills">` +
    pill("gelato", "Gelato " + (c.gelato_count || 0), done.gelato.length > 0) +
    pill("torte", "Torte " + (c.torte_count || 0), done.torte.length > 0) +
    (sospesi.length
      ? pill("sospesi", sospesi.length === 1 ? "1 da pagare" : sospesi.length + " da pagare", true, " cli-due")
      : "") +
    `</div>`;

  frow.innerHTML =
    `<div class="cli-head"><span class="cli-nome"></span>${pillole}</div>` +
    `<div class="cli-meta"><span class="cli-tel"></span><span class="cli-mail"></span></div>` +
    `<div class="cli-note"></div>` +
    // il telefono ha un max-width esplicito: su WebKit un input dentro un flex tiene la
    // larghezza intrinseca (max-content) e sfonda la riga
    `<div class="cli-form">` +
      `<input class="cli-name grow" placeholder="Nome e cognome" aria-label="Nome e cognome">` +
      `<input class="cli-phone" type="tel" inputmode="tel" placeholder="Telefono" aria-label="Telefono"` +
        ` style="flex:0 0 152px;max-width:152px;min-width:0">` +
      `<input class="cli-mail-in g-desc" type="email" placeholder="Email" aria-label="Email">` +
      `<input class="cli-notes g-desc" placeholder="Note (es. senza glutine, cliente storico)" aria-label="Note">` +
      `<div class="cli-formacts"></div>` +
    `</div>` +
    `<div class="cli-acts"></div>`;

  const q = (s) => frow.querySelector(s);
  const nomeEl = q(".cli-nome"), telEl = q(".cli-tel"), mailEl = q(".cli-mail"), noteEl = q(".cli-note");
  const nameIn = q(".cli-name"), phoneIn = q(".cli-phone"), mailIn = q(".cli-mail-in"), notesIn = q(".cli-notes");

  // email e note mancanti: si nasconde l'elemento invece di lasciarlo vuoto, altrimenti
  // resta lo spazio (e il separatore) di un dato che non c'è
  const dipingi = () => {
    nomeEl.textContent = c.name;
    telEl.textContent = c.phone;
    mailEl.textContent = c.email || "";
    mailEl.classList.toggle("hidden", !c.email);
    noteEl.textContent = c.notes || "";
    noteEl.classList.toggle("hidden", !c.notes);
  };
  dipingi();

  // I campi si ripopolano da `c` a ogni apertura: Annulla non deve ripristinare niente,
  // e quel che si è digitato senza salvare non sopravvive alla chiusura.
  const apriEdit = () => {
    nameIn.value = c.name;
    phoneIn.value = c.phone;
    mailIn.value = c.email || "";
    notesIn.value = c.notes || "";
    frow.classList.add("editing");
    nameIn.focus();
    nameIn.select();
  };
  const chiudiEdit = () => frow.classList.remove("editing");

  const salva = async () => {
    const nome = nameIn.value.trim();
    const tel = phoneIn.value.trim();
    if (!nome) { toast("Il nome non può restare vuoto."); nameIn.focus(); return; }
    const err = cliPhoneError(tel);
    if (err) { toast(err); phoneIn.focus(); return; }
    // stesso confronto della modale ordine torta: il numero si riconosce comunque sia
    // scritto, e phone_norm ha un indice unico — il doppione lo rifiuterebbe il database
    // con un errore illeggibile
    const altro = findCustomerByPhone(tel);
    if (altro && altro.id !== c.id) { toast("Questo numero è già di un altro cliente."); phoneIn.focus(); return; }
    const telCambiato = tel !== c.phone;
    const patch = { name: nome, phone: tel, email: mailIn.value.trim() || null, notes: notesIn.value.trim() || null };
    btnSalva.disabled = true;
    let ok = false;
    try { ok = await saveCustomer(c.id, patch); } finally { btnSalva.disabled = false; }
    if (!ok) return;
    Object.assign(c, patch);
    chiudiEdit();
    toast("Cliente aggiornato.");
    // phone_norm è generata a database: cambiando numero si rilegge tutto, non si indovina
    if (telCambiato) await loadCustomers(); else dipingi();
  };

  // Il cliente si cancella, gli ordini no: `customer_id` è on delete set null e i campi
  // dell'ordine sono congelati, quindi lo storico resta leggibile. La conferma lo dice
  // e riporta quanti ordini sono: dopo non si recupera.
  const elimina = async () => {
    const n = (c.gelato_count || 0) + (c.torte_count || 0);
    const testo = `Eliminare ${c.name} dall'anagrafica?` +
      (n ? `\n\nHa ${n === 1 ? "1 ordine" : n + " ordini"}: restano nello storico col nome e il telefono di allora,` +
           ` ma perdono il collegamento a questa scheda.` : "") +
      `\n\nNon sarà più recuperabile.`;
    if (!confirm(testo)) return;
    const { error } = await withAuthRetry(() => sb.from("customers").delete().eq("id", c.id));
    if (error) { console.error("elimina cliente", error); toast("Errore eliminazione."); return; }
    await loadCustomers();
    toast("Cliente eliminato.");
  };

  const btnSalva = mkBtn("Salva", "btn ok sm", salva);
  q(".cli-formacts").append(btnSalva, mkBtn("Annulla", "btn ghost sm", chiudiEdit));
  q(".cli-acts").append(mkBtn("✏️ Modifica", "btn ghost sm", apriEdit),
    mkBtn("Elimina", "btn danger sm", elimina));

  // Invio salva, Esc annulla: chi corregge un numero non deve staccare le mani dai tasti
  [nameIn, phoneIn, mailIn, notesIn].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); salva(); }
      else if (e.key === "Escape") { e.preventDefault(); chiudiEdit(); }
    });
  });

  // pannello ordini in fondo alla card: una sola area, il contenuto dipende dalla
  // pillola premuta. Ripremendola si chiude; premendone un'altra si cambia vista.
  // Si disegna all'apertura (con l'anagrafica intera a schermo, disegnarli tutti
  // sarebbe lavoro buttato) e si RIdisegna ogni volta: i sospesi cambiano incassando.
  const toggles = frow.querySelectorAll(".cli-toggle");
  if (toggles.length) {
    const panel = document.createElement("div");
    panel.className = "cli-orders hidden";
    frow.appendChild(panel);
    let vista = null;
    toggles.forEach((btn) => {
      btn.onclick = () => {
        const chiude = vista === btn.dataset.view && !panel.classList.contains("hidden");
        panel.classList.toggle("hidden", chiude);
        toggles.forEach((b) => {
          const attivo = !chiude && b === btn;
          b.setAttribute("aria-expanded", String(attivo));
          b.classList.toggle("open", attivo);
        });
        if (chiude) { vista = null; return; }
        vista = btn.dataset.view;
        panel.innerHTML = cliPanelHtml(c, vista);
        cliWirePay(panel);
      };
    });
  }

  return frow;
}

// ---------- aggancio ----------
// js/admin.js assegna .onclick alle tab: qui si aggiunge un listener separato, che
// non lo sovrascrive. Il caricamento avviene alla prima apertura della tab.
const cliTabBtn = document.querySelector('.tab[data-tab="clienti"]');
if (cliTabBtn) cliTabBtn.addEventListener("click", () => { customersReady(); });
if ($("cli-search")) $("cli-search").addEventListener("input", renderCustomers);
