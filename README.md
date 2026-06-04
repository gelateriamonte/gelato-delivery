# 🍦 Gelato Delivery — prototipo

Web app mobile per ordinare il gelato + back office per gestire parametri e ordini.
Stack: **HTML/CSS/JS vanilla** + **Supabase** (Postgres + Realtime) + deploy **Netlify**.

> ⚠️ **Prototipo.** Nessun pagamento (l'ordine viene solo inviato). RLS permissiva e
> password back office lato client: **non sicuro per produzione**. Tieni il repo privato.

## Struttura
```
index.html        → web app cliente (mobile-first)
admin.html        → back office
css/styles.css    → stile
js/order.js       → logica ordine
js/admin.js       → logica gestione + ordini live
js/supabase-client.js → init client
config.js         → URL + anon key Supabase + password admin (DA COMPILARE)
supabase/schema.sql → tabelle + seed + RLS + realtime
netlify.toml      → config deploy statico
```

## Setup (5 passi)

1. **Crea progetto Supabase** → [dashboard](https://supabase.com/dashboard) → *New project*.
2. **Schema**: Supabase → *SQL Editor* → incolla `supabase/schema.sql` → **Run**.
   Crea tabelle, dati di esempio, RLS e realtime ordini.
3. **Chiavi**: Supabase → *Project Settings → API* → copia **Project URL** e **anon public key**.
   Incollale in `config.js`. Cambia anche `ADMIN_PASSWORD`.
4. **Avvia in locale**:
   ```bash
   npx serve .        # oppure: python3 -m http.server 8080
   ```
   Apri `http://localhost:3000` (cliente) e `http://localhost:3000/admin.html` (back office).
5. **Test**: manda un ordine dalla home → compare live nel back office.

## Deploy su Netlify
- Collega il repo GitHub `gelato-delivery` a Netlify (publish dir = root, nessun build).
- Oppure drag-and-drop della cartella su Netlify Drop.
- `config.js` è incluso nel deploy: l'anon key è pubblica per design (sicurezza via RLS).

## Da fare per la produzione (fuori scope prototipo)
- Auth reale (Supabase Auth) per il back office + RLS ristrette.
- Pagamento (Satispay / Stripe / PayPal).
- Zone di consegna multiple, slot con capacità, notifiche WhatsApp/email.
