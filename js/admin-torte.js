/* global $, esc, euro, toast, updateRow, delRow, withAuthRetry, mkBtn,
           enableDragSort, persistOrder, nextSortOrder, availRadios, wireAvailRadios,
           cliNormPhone, cliPhoneError, findCustomerByPhone, loadCustomers, customersReady,
           CUSTOMERS_LOADED, cliDay */

// ========== TORTE — catalogo, ordini, storico, modale, stampa ==========
// Si aggancia da solo ad admin.html: nessuna modifica a js/admin.js.
// Back office = solo italiano: stringhe letterali, niente data-i18n.
// Ogni accesso al DOM e' difensivo (`if (!el) return`): il markup puo' mancare
// finche' la tab non e' in pagina, e un errore qui bloccherebbe il resto dello script.

let CAKES_ALL = [];
let CAKE_ORDERS = [];

const CAKE_MAX_PHOTO = 4 * 1024 * 1024;                        // limite upload foto
// Stessa lista accettata dal bucket storage "cakes": un tipo fuori da qui il server
// lo respinge comunque, meglio dirlo subito che con un generico "Caricamento fallito".
const CAKE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const CAKE_WD = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
// prezzo: due decimali con la virgola, come si scrivono i numeri qui
const cakeFmtPrice = (n) => (n == null || n === "" ? "" : Number(n).toFixed(2).replace(".", ","));

// Legge un prezzo scritto a mano. Tre esiti distinti, e la distinzione conta:
//   null      = campo vuoto → "prezzo da decidere" (NON 0: gratis e' un'altra cosa)
//   undefined = testo non interpretabile → il chiamante tiene il valore precedente
//   numero    = valore valido, arrotondato a numeric(6,2)
// Il campo e' type="text" apposta: un type="number" scarta la virgola prima che il codice la veda.
// I numeri qui si scrivono all'italiana: il punto separa le migliaia, la virgola i decimali.
// Casi attesi (verificati):
//   ""         → null        "40"        → 40         "40,00"  → 40
//   "40.50"    → 40.5        "1.234,50"  → 1234.5     "1.200"  → 1200
//   "-5"       → undefined   "abc"       → undefined  "1,234.50" → undefined (due separatori: non si indovina)
function cakeParsePrice(v, max = 9999.99) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  if (s.includes("-")) return undefined;                 // il segno si guarda ORA: la pulizia sotto lo toglie
  // via tutto cio' che non e' cifra o separatore, poi i punti delle migliaia ("1.234,50" → "1234,50")
  const cleaned = s.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}\b)/g, "");
  if ((cleaned.match(/[.,]/g) || []).length > 1) return undefined;   // piu' di un separatore decimale: ambiguo
  const n = parseFloat(cleaned.replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(max, n) * 100) / 100;
}

// Peso: stesso lettore, col tetto di numeric(5,2) e lo zero trattato come errore
// (una torta di 0 kg non esiste, e a quel peso il totale calcolato sarebbe 0).
function cakeParseWeight(v) {
  const n = cakeParsePrice(v, 999.99);
  if (n == null) return n;                               // null = vuoto · undefined = non interpretabile
  return n > 0 ? n : undefined;
}

// "1,20 kg" — i chili tondi si scrivono senza decimali ("1 kg"), come si dicono a voce
const cakeFmtKg = (n) =>
  (n == null || n === "" ? "" : Number(n).toFixed(2).replace(".", ",").replace(/,00$/, "") + " kg");

function cakeIsToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return !isNaN(d) && d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
// Valore per <input type="datetime-local">: ora LOCALE senza fuso, cioe' quella che
// l'operatore ha digitato. toISOString() darebbe UTC e sposterebbe il ritiro di due ore.
function cakeLocalInput(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}
function cakeDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear() +
    " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// ---------- pagamenti ----------
// Ultimo giorno del mese corrente in formato <input type="date"> (YYYY-MM-DD):
// il default del pagamento differito. Giorno 0 del mese dopo = ultimo di questo.
function cakeLastOfMonth(now) {
  const n = now || new Date();
  const d = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// "Da pagare" non e' uno stato scritto a database: e' consegnato senza incasso.
// (Gli ordini pre-feature sono stati marcati pagati dalla migration 2026-08-09.)
function cakeUnpaid(o) {
  return o.status === "consegnato" && !o.paid_at;
}

// Scadenza piu' vicina in cima; chi non ha data va in fondo (non c'e' urgenza nota).
function cakeByDue(a, b) {
  const ta = a.payment_due_date ? new Date(a.payment_due_date).getTime() : Infinity;
  const tb = b.payment_due_date ? new Date(b.payment_due_date).getTime() : Infinity;
  return ta - tb || new Date(b.delivered_at || 0) - new Date(a.delivered_at || 0);
}

// Tutti i sospesi di un numero di telefono, per la scheda cliente.
function cakeUnpaidByPhone(phone) {
  const k = cliNormPhone(phone);
  if (!k) return [];
  return CAKE_ORDERS.filter((o) => cakeUnpaid(o) && cliNormPhone(o.customer_phone) === k)
    .sort(cakeByDue);
}

// ---------- viste (Catalogo / Ordini / Storico) ----------
const CAKE_VIEWS = [["catalogo", "torte-catalogo"], ["ordini", "torte-ordini"], ["storico", "torte-storico"]];
function setCakeView(v) {
  const bar = $("torte-views");
  if (bar) bar.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("sel", b.dataset.view === v));
  CAKE_VIEWS.forEach(([key, id]) => { const el = $(id); if (el) el.classList.toggle("hidden", key !== v); });
}

function renderCakeStats() {
  const attesa = CAKE_ORDERS.filter((o) => o.status === "in attesa").length;
  const el = $("torte-stats");
  if (el) el.textContent = CAKES_ALL.length + " in catalogo · " + attesa + " da consegnare";
  // stesso bollino dei tab Ordini e Take away: si contano TUTTE le torte ancora da
  // consegnare, comprese quelle col ritiro gia' passato — sono proprio quelle da guardare.
  const badge = $("badge-torte");
  if (badge) { badge.textContent = attesa; badge.classList.toggle("show", attesa > 0); }
}

// ========== CATALOGO ==========
async function loadCakeItems() {
  const { data, error } = await sb.from("cake_items")
    .select("id,name,photo_url,price_kg,available,sort_order")
    .order("sort_order");
  if (error) { console.error("loadCakeItems", error); toast("Errore caricamento catalogo torte."); return; }
  CAKES_ALL = data || [];
  renderCakeCatalogo();
  renderCakeStats();
}

function renderCakeCatalogo() {
  const list = $("cake-list");
  if (!list) return;
  list.innerHTML = "";
  if (!CAKES_ALL.length) {
    list.innerHTML = '<p class="muted small" style="margin:0;padding:6px 2px">Nessuna torta in catalogo.</p>';
    return;
  }
  CAKES_ALL.forEach((it) => list.appendChild(buildCakeRow(it)));
  enableDragSort(list, ".drag-handle", ".cakerow", (ids) => persistOrder("cake_items", ids));
}

// Un solo prezzo, quello al kg: il formato non c'e' piu', il conto lo fa il peso
// digitato al momento dell'ordine.
// Il campo e' type="text" + inputmode="decimal" apposta: un type="number" scarta la
// virgola prima che il codice la veda. Larghezze: css/styles.css.
function cakePriceKgHtml(price) {
  return `<div class="c-vars">` +
      `<span class="c-varshead">Prezzo al kg</span>` +
      // simbolo e unita' di misura FUORI dal campo: senza, il rettangolo non si legge
      // come un prezzo, e dentro finirebbero nel valore da interpretare
      `<span class="c-money">` +
        `<span class="c-cur" aria-hidden="true">€</span>` +
        `<input class="c-price" type="text" inputmode="decimal" maxlength="7"` +
          ` aria-label="Prezzo al kg" value="${esc(cakeFmtPrice(price))}">` +
        `<span class="c-unit" aria-hidden="true">/kg</span>` +
      `</span>` +
    `</div>`;
}

function buildCakeRow(it) {
  const row = document.createElement("div");
  row.className = "cakerow"; row.dataset.id = it.id;
  // niente stile in linea sul contenitore: enableDragSort fa removeAttribute("style")
  // al rilascio e cancellerebbe tutto quello che ci fosse.
  row.innerHTML =
    `<span class="drag-handle" title="Trascina per ordinare">⠿</span>` +
    `<div class="cakethumb" role="img" aria-label="Foto di ${esc(it.name)}"></div>` +
    `<div class="c-body">` +
      `<input class="c-name" value="${esc(it.name)}" aria-label="Nome torta">` +
      cakePriceKgHtml(it.price_kg) +
      `<input type="file" class="c-file" accept="${CAKE_PHOTO_TYPES.join(",")}" aria-label="Foto della torta">` +
    `</div>` +
    availRadios("ck-" + it.id, it.available) +
    `<button class="btn icon" type="button" title="Elimina">✕</button>`;

  // --- foto: si imposta da JS, cosi' un apice nell'URL non rompe l'attributo style.
  //     Stringa vuota = torna il segnaposto del foglio di stile. ---
  const thumb = row.querySelector(".cakethumb");
  const setThumb = (url) => { thumb.style.backgroundImage = url ? `url("${url}")` : ""; };
  setThumb(it.photo_url);

  // --- nome ---
  const name = row.querySelector(".c-name");
  name.onchange = () => {
    const v = name.value.trim();
    if (!v) { name.value = it.name; return; }          // nome vuoto: e' not null a DB, si annulla
    it.name = v;
    updateRow("cake_items", it.id, { name: v });
  };

  // --- caricamento foto ---
  const file = row.querySelector(".c-file");
  file.onchange = async () => {
    const f = file.files && file.files[0];
    file.value = "";                                    // permette di ricaricare lo stesso file
    if (!f) return;
    file.disabled = true;
    const url = await uploadCakePhoto(f, it.id);
    file.disabled = false;
    if (!url) return;
    await updateRow("cake_items", it.id, { photo_url: url });
    it.photo_url = url;
    setThumb(url);
    toast("Foto aggiornata.");
  };

  // --- disponibile ---
  wireAvailRadios(row, (val) => { it.available = val; updateRow("cake_items", it.id, { available: val }); });

  // --- elimina ---
  row.querySelector(".btn.icon").onclick = async () => {
    if (!confirm(`Eliminare "${it.name}" dal catalogo?\n\nGli ordini gia' presi restano nello storico.`)) return;
    await delRow("cake_items", it.id);
    await loadCakeItems();
  };

  // --- prezzo al kg ---
  const price = row.querySelector(".c-price");
  price.onchange = () => {
    const v = cakeParsePrice(price.value);
    // La colonna e' not null: a differenza dei vecchi prezzi per formato, qui il campo
    // vuoto non e' "prezzo da decidere" ma un ordine non calcolabile → si torna indietro,
    // esattamente come per il testo non interpretabile.
    if (v == null) { price.value = cakeFmtPrice(it.price_kg); return; }
    it.price_kg = v;
    price.value = cakeFmtPrice(v);
    updateRow("cake_items", it.id, { price_kg: v });
  };

  return row;
}

// Etichetta leggibile del formato rifiutato: file.type se il browser lo sa dire
// (HEIC spesso no), altrimenti l'estensione del nome file.
function cakePhotoTypeLabel(file) {
  if (file.type) return file.type.replace(/^image\//, "").toUpperCase();
  const m = /\.([A-Za-z0-9]+)$/.exec(file.name || "");
  return m ? m[1].toUpperCase() : "sconosciuto";
}

// Upload con la SESSIONE AUTENTICATA dell'admin, non con l'endpoint a token pubblico.
// Ritorna l'URL pubblico oppure null.
async function uploadCakePhoto(file, itemId) {
  if (!file) return null;
  if (!CAKE_PHOTO_TYPES.includes(file.type)) {
    toast(`Formato non supportato (${cakePhotoTypeLabel(file)}). Usa JPG, PNG, WEBP o AVIF.`);
    return null;
  }
  if (file.size > CAKE_MAX_PHOTO) { toast("Immagine troppo grande: massimo 4 MB."); return null; }
  const m = /\.([A-Za-z0-9]+)$/.exec(file.name || "");
  const ext = (m ? m[1] : "jpg").toLowerCase();
  const path = itemId + "-" + Date.now() + "." + ext;
  const { error } = await sb.storage.from("cakes").upload(path, file, { upsert: true, contentType: file.type });
  if (error) { console.error("uploadCakePhoto", error); toast("Caricamento foto fallito."); return null; }
  const pub = sb.storage.from("cakes").getPublicUrl(path);
  return (pub && pub.data && pub.data.publicUrl) || null;
}

// ========== ORDINI E STORICO ==========
async function loadCakeOrders() {
  const { data, error } = await sb.from("cake_orders")
    .select("id,customer_id,customer_name,customer_phone,cake_item_id,item_name,variant," +
            "weight_kg,price_kg,extras_price,price," +
            "pickup_at,inscription,extras,notes,status,delivered_at,created_at," +
            "paid_at,payment_due_date")
    .order("pickup_at", { ascending: true });
  if (error) { console.error("loadCakeOrders", error); toast("Errore caricamento ordini torte."); return; }
  CAKE_ORDERS = data || [];
  renderCakeOrdini();
  renderCakeStorico();
  renderCakeStats();
}

// Scritta ed extra sono i dati che, se sbagliati, mandano a monte il lavoro:
// si mostrano sempre quando ci sono, non nascosti in un dettaglio.
function cakeOrderNote(o, storico) {
  const bits = [];
  if (o.inscription && o.inscription.trim()) bits.push(`<b>Scritta:</b> ${esc(o.inscription)}`);
  // descrizione e importo sono due cose diverse e possono esserci una senza l'altra:
  // "6 candeline" senza sovrapprezzo, o un extra gia' conteggiato che nessuno ha descritto
  const ex = [];
  if (o.extras && o.extras.trim()) ex.push(esc(o.extras));
  if (o.extras_price != null) ex.push(esc(euro(o.extras_price)));
  if (ex.length) bits.push(`<b>Extra:</b> ${ex.join(" · ")}`);
  if (o.notes && o.notes.trim()) bits.push(`<b>Note:</b> ${esc(o.notes)}`);
  if (storico) bits.push(`<b>Ritiro previsto:</b> ${esc(cakeDateTime(o.pickup_at))}`);
  return bits.length ? `<div class="co-note">${bits.join("<br>")}</div>` : "";
}

// storico=true → riga dello storico: in evidenza la consegna al posto del ritiro,
// niente pulsante "Consegnato".
function buildCakeOrderRow(o, storico) {
  const iso = storico ? (o.delivered_at || o.pickup_at) : o.pickup_at;
  const d = new Date(iso);
  const valid = !!iso && !isNaN(d);
  const day = !valid ? "—"
    : (!storico && cakeIsToday(iso)) ? "oggi"
      : CAKE_WD[d.getDay()] + " " + String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
  const time = valid ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "—";

  const unpaid = storico && cakeUnpaid(o);
  const row = document.createElement("div");
  // .urgent = si ritira oggi · .done = consegnato e pagato · .unpaid = consegnato,
  // incasso ancora da fare (bordo sinistro, colpo d'occhio)
  row.className = "corow" + (storico ? (unpaid ? " unpaid" : " done") : (cakeIsToday(o.pickup_at) ? " urgent" : ""));
  row.dataset.id = o.id;
  // accanto al nome il peso; gli ordini presi prima del prezzo al kg non ce l'hanno
  // e mostrano il formato di allora
  const qta = o.weight_kg != null ? cakeFmtKg(o.weight_kg) : (o.variant || "");
  // sul sospeso il nome e' un bottone: apre la scheda con tutti i sospesi del cliente
  const who = esc(o.customer_name) + " · " + esc(o.customer_phone);
  row.innerHTML =
    `<div class="co-when"><span class="co-day">${esc(day)}</span><span class="co-time">${esc(time)}</span></div>` +
    `<div class="co-main">` +
      `<div class="co-what">${esc(o.item_name)} <span class="co-var">${esc(qta)}</span></div>` +
      (unpaid
        ? `<button type="button" class="co-who co-who-btn" title="Scheda pagamenti del cliente">${who}</button>`
        : `<div class="co-who">${who}</div>`) +
      (unpaid
        ? `<div class="co-due">${o.payment_due_date ? "Da pagare entro " + esc(cliDay(o.payment_due_date)) : "Da pagare"}</div>`
        : "") +
      cakeOrderNote(o, storico) +
    `</div>` +
    `<div class="co-amt">${esc(euro(o.price))}</div>`;

  if (unpaid) {
    const btn = row.querySelector(".co-who-btn");
    if (btn) btn.onclick = () => openCakeCustModal(o.customer_phone);
  }

  const acts = document.createElement("div");
  acts.className = "co-acts";
  // Su telefono i bottoni sono a piena larghezza: un tocco sbagliato su "Consegnato" e'
  // facile, e senza ritorno l'unica azione residua sarebbe cancellare la torta da preparare.
  if (!storico) {
    acts.append(mkBtn("Consegnato", "btn ok sm", () => openCakePayModal(o)));
    // si modifica solo cio' che non e' ancora uscito dal laboratorio: sullo storico
    // cambiare i dati vorrebbe dire riscrivere una vendita gia' fatta
    acts.append(mkBtn("✏️ Modifica", "btn ghost sm", () => openCakeOrderModal(o)));
  } else {
    // "Segna pagato", non "Pagato": verbo d'azione, non stato — un bottone verde con
    // scritto "Pagato" sembrava dire che l'ordine era gia' saldato
    if (unpaid) acts.append(mkBtn("Segna pagato", "btn sm", () =>
      cakePayAndRefresh([o.id], "Ordine incassato.")));
    acts.append(mkBtn("Rimetti in attesa", "btn ghost sm", () => restoreCakeOrder(o)));
  }
  acts.append(mkBtn("🖨️ Stampa", "btn ghost sm", () => printCakeOrder(o)));
  acts.append(mkBtn(storico ? "Elimina" : "Annulla", "btn danger sm", () => deleteCakeOrder(o)));
  row.appendChild(acts);
  return row;
}

function renderCakeOrdini() {
  const list = $("cake-orders-list");
  if (!list) return;
  list.innerHTML = "";
  const rows = CAKE_ORDERS.filter((o) => o.status === "in attesa")
    .sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at));   // il ritiro piu' imminente in cima
  if (!rows.length) {
    list.innerHTML = '<p class="muted small" style="margin:0;padding:6px 2px">Nessun ordine torta in attesa.</p>';
    return;
  }
  rows.forEach((o) => list.appendChild(buildCakeOrderRow(o, false)));
}

// Due liste: i sospesi in cima (sono soldi da andare a prendere), sotto le saldate.
function renderCakeStorico() {
  const done = CAKE_ORDERS.filter((o) => o.status === "consegnato");
  const unpaid = done.filter(cakeUnpaid).sort(cakeByDue);
  const paid = done.filter((o) => !cakeUnpaid(o))
    .sort((a, b) => new Date(b.delivered_at || b.pickup_at) - new Date(a.delivered_at || a.pickup_at));

  const vuoto = (msg) => '<p class="muted small" style="margin:0;padding:6px 2px">' + msg + "</p>";
  const ul = $("cake-unpaid-list");
  if (ul) {
    ul.innerHTML = "";
    if (!unpaid.length) ul.innerHTML = vuoto("Nessun pagamento in sospeso.");
    else unpaid.forEach((o) => ul.appendChild(buildCakeOrderRow(o, true)));
  }
  const stats = $("cake-unpaid-stats");
  if (stats) {
    const tot = unpaid.reduce((t, o) => t + Number(o.price || 0), 0);
    stats.textContent = unpaid.length
      ? (unpaid.length === 1 ? "1 in sospeso" : unpaid.length + " in sospeso") + " · " + euro(tot)
      : "0 in sospeso";
  }
  const list = $("cake-history-list");
  if (list) {
    list.innerHTML = "";
    if (!paid.length) list.innerHTML = vuoto("Nessuna torta consegnata.");
    else paid.forEach((o) => list.appendChild(buildCakeOrderRow(o, true)));
  }
}

// Le tre scritture sotto NON passano da updateRow/delRow: quelli inghiottono l'errore
// (toast generico e nient'altro da leggere), e il messaggio di successo finirebbe a schermo
// anche a scrittura fallita — con la sessione scaduta si leggeva "Ordine consegnato."
// mentre a database non era cambiato niente. Qui si guarda l'esito, come fa printCakeOrder.
// La consegna passa dalla modale pagamento (openCakePayModal): la scrittura vera
// sta qui. paid=true → incassato ora; paid=false → differito con la sua scadenza.
async function cakeDeliver(o, paid, dueDate) {
  const { error } = await withAuthRetry(() => sb.from("cake_orders")
    .update({
      status: "consegnato", delivered_at: new Date().toISOString(),
      paid_at: paid ? new Date().toISOString() : null,
      payment_due_date: paid ? null : dueDate,
    }).eq("id", o.id));
  if (error) { console.error("cakeDeliver", error); toast("Errore salvataggio."); return false; }
  await loadCakeOrders();
  toast(paid ? "Consegnato e incassato." : "Consegnato — da pagare entro " + cliDay(dueDate) + ".");
  return true;
}

// Incassa uno o piu' ordini. Ritorna true solo se ha scritto davvero.
async function markCakeOrdersPaid(ids) {
  const { error } = await withAuthRetry(() => sb.from("cake_orders")
    .update({ paid_at: new Date().toISOString() }).in("id", ids));
  if (error) { console.error("markCakeOrdersPaid", error); toast("Errore salvataggio."); return false; }
  return true;
}

// Incasso + riallineamento delle viste che lo mostrano: storico torte e, se gia'
// caricata, l'anagrafica clienti. Chiamata anche da admin-clienti.js (a quel punto
// dell'esecuzione entrambi gli script sono definiti).
async function cakePayAndRefresh(ids, msg) {
  if (!await markCakeOrdersPaid(ids)) return false;
  await loadCakeOrders();
  if (typeof CUSTOMERS_LOADED !== "undefined" && CUSTOMERS_LOADED) loadCustomers();
  toast(msg);
  return true;
}

// Ritorno indietro dallo storico: lo stato torna quello di partenza e la torta ricompare
// fra quelle da preparare. Il CHECK su status ammette gia' "in attesa": nessuna migration.
// Si azzera anche il pagamento: e' figlio della consegna che si sta annullando.
async function restoreCakeOrder(o) {
  const { error } = await withAuthRetry(() => sb.from("cake_orders")
    .update({ status: "in attesa", delivered_at: null, paid_at: null, payment_due_date: null }).eq("id", o.id));
  if (error) { console.error("restoreCakeOrder", error); toast("Errore salvataggio."); return; }
  await loadCakeOrders();
  toast("Ordine rimesso in attesa.");
}

// Non esiste lo stato "annullato": annullare ELIMINA la riga (scelta del titolare).
// La conferma nominale e' l'unica rete: dopo non si recupera.
async function deleteCakeOrder(o) {
  const q = `Eliminare definitivamente l'ordine di ${o.customer_name} — ${o.item_name} ` +
    `${o.weight_kg != null ? cakeFmtKg(o.weight_kg) : (o.variant || "")}` +
    ` del ${cakeDateTime(o.pickup_at)}?\n\nNon sara' piu' recuperabile.`;
  if (!confirm(q)) return;
  const { error } = await withAuthRetry(() => sb.from("cake_orders").delete().eq("id", o.id));
  if (error) { console.error("deleteCakeOrder", error); toast("Errore eliminazione."); return; }
  await loadCakeOrders();
  toast("Ordine eliminato.");
}

// Quarto kind della coda print_jobs, accanto a order / production / note.
// Niente order_id: quella chiave esterna punta a `orders`, che e' un'altra tabella.
// Il payload e' la fotografia completa dell'ordine: lo scontrino li stampa tutti.
async function printCakeOrder(o) {
  const payload = {
    id: o.id,
    created_at: o.created_at,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    item_name: o.item_name,
    // `variant` resta nel payload: una ristampa dallo storico deve poter mostrare il
    // formato degli ordini presi prima del passaggio al prezzo al kg
    variant: o.variant,
    weight_kg: o.weight_kg,
    price_kg: o.price_kg,
    extras_price: o.extras_price,
    price: o.price,
    pickup_at: o.pickup_at,
    inscription: o.inscription,
    extras: o.extras,
    notes: o.notes,
  };
  const { error } = await withAuthRetry(() => sb.from("print_jobs").insert({ kind: "cake_order", payload }));
  if (error) console.error("stampa torta print_jobs", error);
  toast(error ? "Errore stampa." : "Inviato in stampa…");
}

// ========== MODALE CONSEGNA/PAGAMENTO ==========
// "Consegnato" non scrive piu' subito: prima si dice come paga. Annulla (o il
// fondale, o Esc) non scrive niente e l'ordine resta in attesa.
let cpOrder = null;    // ordine in consegna, null a modale chiusa

function openCakePayModal(o) {
  const modal = $("cake-pay-modal");
  if (!modal) return;
  cpOrder = o;
  const who = $("cp-who");
  if (who) who.textContent = o.item_name +
    (o.weight_kg != null ? " " + cakeFmtKg(o.weight_kg) : "") +
    " — " + o.customer_name + " · " + euro(o.price);
  const row = $("cp-defer-row");
  if (row) row.classList.add("hidden");            // la data compare solo scegliendo "differito"
  const due = $("cp-due");
  if (due) { due.value = cakeLastOfMonth(); due.classList.remove("err"); }
  modal.classList.remove("hidden");
}
function closeCakePayModal() {
  cpOrder = null;
  const modal = $("cake-pay-modal");
  if (modal) modal.classList.add("hidden");
}

function wireCakePayModal() {
  const modal = $("cake-pay-modal");
  if (!modal) return;
  const paid = $("cp-paid"), defer = $("cp-defer"), row = $("cp-defer-row"),
    due = $("cp-due"), confirmBtn = $("cp-confirm"), cancel = $("cp-cancel");
  // bottoni spenti durante la scrittura: due tocchi ravvicinati farebbero due update
  const deliver = async (isPaid, dueDate) => {
    const o = cpOrder;
    if (!o) return;
    [paid, defer, confirmBtn].forEach((b) => { if (b) b.disabled = true; });
    let ok = false;
    try { ok = await cakeDeliver(o, isPaid, dueDate); }
    finally { [paid, defer, confirmBtn].forEach((b) => { if (b) b.disabled = false; }); }
    if (ok) closeCakePayModal();
  };
  if (paid) paid.onclick = () => deliver(true, null);
  if (defer) defer.onclick = () => {
    if (row) row.classList.remove("hidden");
    if (due) due.focus();
  };
  if (confirmBtn) confirmBtn.onclick = () => {
    const v = due ? due.value : "";
    if (!v) { if (due) { due.classList.add("err"); due.focus(); } toast("Serve la data prevista di pagamento."); return; }
    deliver(false, v);
  };
  if (cancel) cancel.onclick = closeCakePayModal;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeCakePayModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeCakePayModal();
  });
}

// ========== SCHEDA CLIENTE — SOSPESI ==========
// Si apre dal nome del cliente nella lista "Da pagare": anagrafica + tutti i suoi
// sospesi + chiusura in un colpo solo. Il singolo si chiude dalla lista, qui no.
let cuIds = [];   // ordini elencati nella scheda aperta, per "Segna tutti pagati"

async function openCakeCustModal(phone) {
  const modal = $("cake-cust-modal");
  if (!modal) return;
  const orders = cakeUnpaidByPhone(phone);
  if (!orders.length) { toast("Nessun pagamento in sospeso."); return; }
  cuIds = orders.map((o) => o.id);
  // l'anagrafica puo' mancare (cliente cancellato): si mostra quello che l'ordine ricorda
  if (typeof customersReady === "function") await customersReady();
  const c = typeof findCustomerByPhone === "function" ? findCustomerByPhone(phone) : null;
  const title = $("cu-title");
  if (title) title.textContent = (c && c.name) || orders[0].customer_name || "Cliente";
  const body = $("cu-body");
  if (body) {
    const tot = orders.reduce((t, o) => t + Number(o.price || 0), 0);
    const contatto = [(c && c.phone) || phone, c && c.email, c && c.notes].filter(Boolean);
    const righe = orders.map((o) =>
      `<div class="cli-ord">` +
        `<span class="cli-ord-d">${esc(cliDay(o.delivered_at || o.pickup_at))}</span>` +
        `<span class="cli-ord-x">${esc([o.item_name, o.weight_kg != null ? cakeFmtKg(o.weight_kg) : o.variant].filter(Boolean).join(" · "))}</span>` +
        (o.payment_due_date ? `<span class="cli-ord-due">entro ${esc(cliDay(o.payment_due_date))}</span>` : "") +
        `<span class="cli-ord-e">${esc(euro(o.price))}</span>` +
      `</div>`).join("");
    body.innerHTML =
      `<p class="muted small" style="margin:0 0 10px">${contatto.map(esc).join(" · ")}</p>` +
      `<div class="cli-orders">` +
        `<div class="cli-grp"><div class="cli-grp-h"><b>Da pagare</b>` +
          `<span>${orders.length === 1 ? "1 ordine" : orders.length + " ordini"}</span>` +
          `<span class="cli-grp-tot">${esc(euro(tot))}</span></div>` +
        righe +
      `</div></div>`;
  }
  const payall = $("cu-payall");
  if (payall) payall.textContent = orders.length === 1 ? "Segna pagato" : "Segna tutti pagati (" + orders.length + ")";
  modal.classList.remove("hidden");
}

function wireCakeCustModal() {
  const modal = $("cake-cust-modal");
  if (!modal) return;
  const chiudi = () => modal.classList.add("hidden");
  const close = $("cu-close"), payall = $("cu-payall");
  if (close) close.onclick = chiudi;
  if (payall) payall.onclick = async () => {
    if (!cuIds.length) return;
    payall.disabled = true;
    let ok = false;
    try { ok = await cakePayAndRefresh(cuIds, cuIds.length === 1 ? "Ordine incassato." : "Ordini incassati."); }
    finally { payall.disabled = false; }
    if (ok) chiudi();
  };
  modal.addEventListener("click", (e) => { if (e.target === modal) chiudi(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) chiudi();
  });
}

// ========== MODALE NUOVO ORDINE ==========
let coPriceTouched = false;    // il totale si calcola da solo, ma non sovrascrive l'operatore
let coAutoName = "";           // ultimo nome scritto da noi: se e' ancora quello, si puo' rimpiazzare
let coAutoEmail = "";
let coCustomersReady = false;  // anagrafica in memoria: finche' e' falso non si dice "Nuovo cliente"
let coEditId = null;           // id dell'ordine in modifica, null se e' un ordine nuovo

const CO_FIELDS = ["co-phone", "co-name", "co-email", "co-item", "co-weight", "co-extras",
  "co-extras-price", "co-price", "co-pickup", "co-inscription", "co-notes"];

// il rosso del campo mancante sta su `.co-field .err` (css/styles.css), non in linea
function coClearErrors() {
  CO_FIELDS.forEach((id) => { const el = $(id); if (el) el.classList.remove("err"); });
}
function coMarkMissing(el) {
  if (el) el.classList.add("err");
}

// La modale si apre anche dalla tab Torte, dove la tab Clienti puo' non essere mai stata
// aperta: senza attendere l'anagrafica, il primo numero digitato risulterebbe sempre
// "Nuovo cliente" e l'operatore riscriverebbe a mano un cliente che c'e' gia'.
// `o` presente = si modifica quell'ordine; assente = se ne prende uno nuovo.
async function openCakeOrderModal(o) {
  const modal = $("cake-modal");
  if (!modal) return;
  coEditId = o ? o.id : null;
  coPriceTouched = false; coAutoName = ""; coAutoEmail = ""; coCustomersReady = false;
  coClearErrors();
  CO_FIELDS.forEach((id) => { const el = $(id); if (el && el.tagName !== "SELECT") el.value = ""; });
  const found = $("co-found"); if (found) found.textContent = "";
  const rate = $("co-rate"); if (rate) rate.textContent = "";    // il prezzo al kg del giro precedente
  const save = $("co-save");
  if (save) { save.disabled = false; save.textContent = o ? "Salva modifiche" : "Salva ordine"; }
  const title = $("co-title");
  if (title) title.textContent = o ? "Modifica ordine torta" : "Nuovo ordine torta";
  coFillItems(o ? o.cake_item_id : null);
  if (typeof customersReady === "function") await customersReady();
  // customersReady() si risolve anche se loadCustomers e' fallito (non rigetta, non alza
  // CUSTOMERS_LOADED): senza questo controllo il riconoscimento cliente resterebbe cieco
  // dicendo pero' "Nuovo cliente", il caso peggiore.
  coCustomersReady = typeof CUSTOMERS_LOADED !== "undefined" && CUSTOMERS_LOADED;
  if (o) coFillFromOrder(o);
  modal.classList.remove("hidden");
  // in modifica il telefono e' gia' quello giusto: si parte dal primo campo che di
  // solito si viene a cambiare
  const first = o ? $("co-weight") : $("co-phone");
  if (first) first.focus();
}

// Riporta nella modale un ordine gia' preso. I campi dell'ORDINE vincono su quelli
// dell'anagrafica: sono la fotografia del momento in cui e' stato preso.
function coFillFromOrder(o) {
  const set = (id, v) => { const el = $(id); if (el) el.value = v == null ? "" : v; };
  set("co-phone", o.customer_phone);
  coLookupCustomer();                       // "Gia' cliente — …" ed email dall'anagrafica
  set("co-name", o.customer_name);
  coAutoName = "";                          // il nome ora e' dell'ordine: non e' piu' nostro da sovrascrivere
  const sel = $("co-item");
  if (sel) sel.value = o.cake_item_id || "";
  // articolo cancellato dal catalogo: la tendina resta vuota e va riscelto. Meglio dirlo
  // subito che lasciare scoprire il campo rosso al salvataggio.
  if (sel && !sel.value) toast("L'articolo di questo ordine non è più in catalogo: scegline uno.");
  set("co-weight", cakeFmtPrice(o.weight_kg));
  set("co-extras", o.extras);
  set("co-extras-price", cakeFmtPrice(o.extras_price));
  set("co-price", cakeFmtPrice(o.price));
  set("co-pickup", cakeLocalInput(o.pickup_at));
  set("co-inscription", o.inscription);
  set("co-notes", o.notes);
  coFillRate();
  // il totale e' quello concordato col cliente: non si tocca finche' non si tocca un
  // addendo (allora i listener rimettono coPriceTouched a false e si ricalcola)
  coPriceTouched = true;
}
function closeCakeOrderModal() {
  const modal = $("cake-modal");
  if (modal) modal.classList.add("hidden");
}

// Solo gli articoli disponibili: un ordine impossibile non deve essere digitabile.
// `keepId` (modifica) resta in elenco anche se nel frattempo e' stato messo non
// disponibile: l'ordine e' gia' stato preso, togliergli la torta di sotto costringerebbe
// a riscriverlo per cambiare l'orario di ritiro.
function coFillItems(keepId) {
  const sel = $("co-item");
  if (!sel) return;
  const items = CAKES_ALL.filter((it) => it.available || it.id === keepId);
  sel.innerHTML = '<option value="">— scegli la torta —</option>' +
    items.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join("");
}

function coCurrentItem() {
  const sel = $("co-item");
  if (!sel || !sel.value) return null;
  return CAKES_ALL.find((it) => it.id === sel.value) || null;
}

// Il prezzo al kg scritto sotto il campo peso: senza, il totale calcolato e' un numero
// che arriva dal nulla e l'operatore non ha modo di accorgersi di un listino sbagliato.
function coFillRate() {
  const el = $("co-rate");
  if (!el) return;
  const it = coCurrentItem();
  el.textContent = it ? euro(it.price_kg) + " al kg" : "";
}

// Totale = peso × prezzo al kg + extra. L'extra e' COMPRESO nel totale (scelta del
// titolare): a database resta anche da solo, per stamparne il dettaglio.
function coFillPrice() {
  const el = $("co-price");
  if (!el || coPriceTouched) return;                 // gia' toccato a mano: non si sovrascrive
  const it = coCurrentItem();
  const kg = $("co-weight") ? cakeParseWeight($("co-weight").value) : null;
  if (!it || kg == null) { el.value = ""; return; }  // copre vuoto e testo non interpretabile
  const ex = $("co-extras-price") ? cakeParsePrice($("co-extras-price").value) : null;
  const tot = kg * Number(it.price_kg) + (ex == null ? 0 : ex);
  el.value = cakeFmtPrice(Math.min(9999.99, Math.round(tot * 100) / 100));
}

// L'anagrafica sta gia' in memoria: nessuna query per ogni tasto premuto.
function coLookupCustomer() {
  const found = $("co-found");
  const phone = $("co-phone");
  if (!phone) return;
  if (!coCustomersReady) { if (found) found.textContent = ""; return; }   // anagrafica non ancora in memoria: si tace
  const raw = phone.value.trim();
  const digits = raw.replace(/\D/g, "");
  const c = (typeof findCustomerByPhone === "function" && digits.length >= 6) ? findCustomerByPhone(raw) : null;
  if (found) found.textContent = c ? "Gia' cliente — " + c.name : (digits.length >= 6 ? "Nuovo cliente" : "");
  if (!c) {
    // il numero corretto non e' piu' quello di prima: se nome/email erano stati
    // compilati da noi, si svuotano. Cio' che l'operatore ha scritto a mano resta.
    const name = $("co-name");
    if (name && name.value === coAutoName) { name.value = ""; coAutoName = ""; }
    const email = $("co-email");
    if (email && email.value === coAutoEmail) { email.value = ""; coAutoEmail = ""; }
    return;
  }
  const name = $("co-name");
  if (name && (!name.value.trim() || name.value === coAutoName)) { name.value = c.name || ""; coAutoName = name.value; }
  const email = $("co-email");
  if (email && (!email.value.trim() || email.value === coAutoEmail)) { email.value = c.email || ""; coAutoEmail = email.value; }
}

// Validazione minima: nome, telefono, torta, peso, totale e ritiro.
// E' uno strumento interno, non un modulo pubblico: oltre questo non si va.
function coCollect() {
  coClearErrors();
  const phone = $("co-phone"), name = $("co-name"), item = $("co-item"),
    weight = $("co-weight"), exPrice = $("co-extras-price"),
    price = $("co-price"), pickup = $("co-pickup");
  const miss = [];
  const it = coCurrentItem();
  const kg = weight ? cakeParseWeight(weight.value) : null;
  const exVal = exPrice ? cakeParsePrice(exPrice.value) : null;
  const priceVal = price ? cakeParsePrice(price.value) : null;
  // "da chiedere" o simili non sono un numero: cliPhoneError rifiuta anche le stringhe
  // senza cifre e sotto le 9 cifre, non solo il campo vuoto. Senza questo controllo
  // cliNormPhone lo riduce a "" e il secondo cliente senza numero prende il posto del primo.
  const phoneErr = cliPhoneError(phone ? phone.value : "");

  if (!name || !name.value.trim()) miss.push(name);
  if (phoneErr) miss.push(phone);
  if (!it) miss.push(item);
  if (kg == null) miss.push(weight);        // vuoto, non interpretabile o zero: nessuno dei tre e' un peso
  if (exVal === undefined) miss.push(exPrice);   // l'extra vuoto (null) va bene, il testo non valido no
  if (priceVal == null) miss.push(price);   // copre sia il vuoto (null) sia il testo non valido (undefined)
  if (!pickup || !pickup.value) miss.push(pickup);

  if (miss.length) {
    miss.forEach(coMarkMissing);
    if (miss[0]) miss[0].focus();
    toast(miss.includes(phone) ? phoneErr : "Compila i campi evidenziati.");
    return null;
  }
  const when = new Date(pickup.value);
  if (isNaN(when)) { coMarkMissing(pickup); toast("Data di ritiro non valida."); return null; }

  const emailEl = $("co-email"), inscr = $("co-inscription"), extras = $("co-extras"), notes = $("co-notes");
  const txt = (el) => (el && el.value.trim()) || null;
  return {
    customer_name: name.value.trim(),
    customer_phone: phone.value.trim(),
    email: txt(emailEl),
    cake_item_id: it.id,
    item_name: it.name,
    weight_kg: kg,
    price_kg: it.price_kg,          // congelato: il listino puo' cambiare dopo
    extras_price: exVal,
    price: priceVal,
    pickup_at: when.toISOString(),
    inscription: txt(inscr),
    extras: txt(extras),
    notes: txt(notes),
  };
}

// Aggiorna l'anagrafica del cliente gia' esistente, ma solo su conferma esplicita.
// Ritorna false se la scrittura fallisce (allora l'ordine non si prende: il cliente e'
// il primo passo, come prima). Vedi saveCakeOrder per il perche' di tutto questo.
async function coUpdateExistingCustomer(found, d) {
  const patch = {};
  if (d.email && !found.email) patch.email = d.email;      // buco riempito: non si sovrascrive niente
  const diffName = d.customer_name !== found.name;
  const diffEmail = !!d.email && !!found.email && d.email !== found.email;
  if (diffName || diffEmail) {
    const bits = [];
    if (diffName) bits.push(`nome:  ${found.name}  →  ${d.customer_name}`);
    if (diffEmail) bits.push(`email:  ${found.email}  →  ${d.email}`);
    const q = "Questo numero e' gia' in anagrafica con dati diversi:\n\n" + bits.join("\n") +
      "\n\nAggiornare l'anagrafica?\n\nAnnulla = l'anagrafica resta com'e'." +
      "\nIn ogni caso l'ordine viene intestato a quello che hai digitato.";
    if (confirm(q)) {
      if (diffName) patch.name = d.customer_name;
      if (diffEmail) patch.email = d.email;
    }
  }
  if (!Object.keys(patch).length) return true;
  patch.updated_at = new Date().toISOString();
  const { error } = await withAuthRetry(() => sb.from("customers").update(patch).eq("id", found.id));
  if (error) { console.error("saveCakeOrder aggiorna cliente", error); toast("Errore salvataggio cliente."); return false; }
  return true;
}

// `id` presente = si riscrive quell'ordine invece di crearne uno nuovo. Il cliente si
// risolve comunque: in modifica il telefono puo' essere stato corretto.
async function saveCakeOrder(d, id) {
  // 1) cliente: si CERCA per phone_norm, non si fa un upsert. Un upsert con
  //    onConflict:"phone_norm" e' un ON CONFLICT DO UPDATE su tutte le colonne del
  //    payload: chi ordina dal numero di casa di famiglia riscriverebbe in silenzio il
  //    nome di chi e' gia' in anagrafica, e quello vecchio non si recupera piu'.
  //    Un cliente che c'e' gia' si tocca solo se l'operatore conferma; il nome digitato
  //    finisce comunque nei campi congelati dell'ordine, che e' cio' che serve in laboratorio.
  //    L'email entra nel payload solo se compilata: passarla vuota azzererebbe
  //    l'indirizzo gia' in anagrafica di un cliente che stavolta non l'ha detto.
  const { data: found, error: e0 } = await withAuthRetry(() => sb.from("customers")
    .select("id,name,email").eq("phone_norm", cliNormPhone(d.customer_phone)).maybeSingle());
  if (e0) { console.error("saveCakeOrder ricerca cliente", e0); toast("Errore ricerca cliente."); return false; }

  let customerId = found ? found.id : null;
  if (found) {
    if (!await coUpdateExistingCustomer(found, d)) return false;
  } else {
    const cust = { name: d.customer_name, phone: d.customer_phone, updated_at: new Date().toISOString() };
    if (d.email) cust.email = d.email;
    const { data: cli, error: e1 } = await withAuthRetry(() =>
      sb.from("customers").insert(cust).select("id").single());
    if (e1) { console.error("saveCakeOrder cliente", e1); toast("Errore salvataggio cliente."); return false; }
    customerId = cli ? cli.id : null;
  }

  // 2) ordine, con i campi congelati: lo storico deve reggere a rinomine e cancellazioni
  const riga = {
    customer_id: customerId,
    customer_name: d.customer_name,
    customer_phone: d.customer_phone,
    cake_item_id: d.cake_item_id,
    item_name: d.item_name,
    weight_kg: d.weight_kg,
    price_kg: d.price_kg,
    extras_price: d.extras_price,
    price: d.price,
    pickup_at: d.pickup_at,
    inscription: d.inscription,
    extras: d.extras,
    notes: d.notes,
  };
  // In modifica si riscrivono solo questi campi: status, delivered_at e created_at non
  // sono nel payload e restano quelli di prima.
  const { error: e2 } = await withAuthRetry(() => (id
    ? sb.from("cake_orders").update(riga).eq("id", id)
    : sb.from("cake_orders").insert(riga)));
  if (e2) {
    console.error("saveCakeOrder ordine", e2);
    toast(id ? "Errore salvataggio modifiche." : "Errore salvataggio ordine.");
    return false;
  }
  toast(id ? "Ordine aggiornato." : "Ordine creato.");
  return true;
}

function wireCakeModal() {
  const modal = $("cake-modal");
  if (!modal) return;
  const phone = $("co-phone"), item = $("co-item"), weight = $("co-weight"),
    exPrice = $("co-extras-price"), price = $("co-price");
  if (phone) phone.addEventListener("input", coLookupCustomer);
  // Toccando uno dei tre addendi (torta, peso, extra) il totale torna a calcolarsi: una
  // correzione a mano valeva per il conto di prima e, restando appiccicata, l'ordine si
  // salverebbe al prezzo sbagliato — il caso peggiore, perche' sembra giusto.
  if (item) item.addEventListener("change", () => { coPriceTouched = false; coFillRate(); coFillPrice(); });
  if (weight) weight.addEventListener("input", () => { coPriceTouched = false; coFillPrice(); });
  if (exPrice) exPrice.addEventListener("input", () => { coPriceTouched = false; coFillPrice(); });
  if (price) price.addEventListener("input", () => { coPriceTouched = true; });
  // A campo lasciato, peso ed extra si riscrivono in forma normale ("1.2" → "1,20"): cosi'
  // si vede il numero che e' stato capito davvero. Il testo non valido resta com'e',
  // altrimenti sparirebbe sotto gli occhi di chi l'ha scritto e coCollect non avrebbe
  // piu' niente da segnalare.
  const norm = (el, parse) => { const v = parse(el.value); if (v != null) el.value = cakeFmtPrice(v); };
  if (weight) weight.addEventListener("change", () => norm(weight, cakeParseWeight));
  if (exPrice) exPrice.addEventListener("change", () => norm(exPrice, cakeParsePrice));

  const cancel = $("co-cancel");
  if (cancel) cancel.onclick = closeCakeOrderModal;
  const save = $("co-save");
  if (save) {
    save.onclick = async () => {
      const d = coCollect();
      if (!d) return;
      // finally: se la promise rigetta, senza questo il bottone resta spento per sempre
      save.disabled = true;
      let ok = false;
      try { ok = await saveCakeOrder(d, coEditId); } finally { save.disabled = false; }
      if (!ok) return;
      closeCakeOrderModal();
      if (typeof loadCustomers === "function") loadCustomers();   // il cliente nuovo compare in anagrafica
      await loadCakeOrders();
      setCakeView("ordini");
    };
  }
  // chiusura: clic sul fondale o Esc
  modal.addEventListener("click", (e) => { if (e.target === modal) closeCakeOrderModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeCakeOrderModal();
  });
}

// ========== AGGANCI ==========
(function wireTorte() {
  wireCakeModal();
  wireCakePayModal();
  wireCakeCustModal();

  const bar = $("torte-views");
  if (bar) bar.querySelectorAll("[data-view]").forEach((b) => { b.onclick = () => setCakeView(b.dataset.view); });

  // arrow e non `openCakeOrderModal` diretto: il gestore riceve l'evento come primo
  // argomento, e la modale lo leggerebbe come "ordine da modificare"
  const nuovo = $("cake-new-order");
  if (nuovo) nuovo.onclick = () => openCakeOrderModal();

  const add = $("nc-add"), addName = $("nc-name");
  if (add && addName) {
    // Bottone e campo spenti prima del primo await: due click (o due Invio) ravvicinati
    // creavano due articoli identici, e il secondo va poi cancellato a mano dal catalogo.
    add.onclick = async () => {
      const name = addName.value.trim();
      if (!name) return;
      add.disabled = true; addName.disabled = true;
      try {
        const order = await nextSortOrder("cake_items");
        const { error } = await withAuthRetry(() => sb.from("cake_items").insert({ name, sort_order: order }));
        if (error) { console.error("nuova torta", error); toast("Errore creazione torta."); return; }
        addName.value = "";
        await loadCakeItems();
      } finally { add.disabled = false; addName.disabled = false; }
    };
    // il richiamo diretto di onclick scavalca l'attributo disabled: va guardato qui
    addName.addEventListener("keydown", (e) => { if (e.key === "Enter" && !add.disabled) add.onclick(); });
  }

  // Aggancio proprio alla tab: js/admin.js usa `.onclick`, qui si usa addEventListener
  // cosi' i due gestori convivono senza toccare quel file.
  const tab = document.querySelector('.tab[data-tab="torte"]');
  if (tab) tab.addEventListener("click", () => { loadCakeItems(); loadCakeOrders(); });

  // Il bollino sul tab deve essere giusto PRIMA che qualcuno apra Torte, altrimenti
  // segnala solo quello che si e' gia' andati a guardare. Gli ordini si caricano quindi
  // all'accesso: si passa dalla sessione e non da initApp() di js/admin.js, che questo
  // file non tocca. Sessione gia' aperta → getSession; login appena fatto → SIGNED_IN.
  sb.auth.getSession().then(({ data }) => { if (data && data.session) loadCakeOrders(); });
  sb.auth.onAuthStateChange((e, s) => { if (e === "SIGNED_IN" && s) loadCakeOrders(); });

  setCakeView("catalogo");
})();
