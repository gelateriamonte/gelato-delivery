-- ============================================================
-- Pagamenti online (Stripe) — l'ordine entra in `orders` SOLO a pagamento riuscito.
-- Esegui in Supabase: SQL Editor → incolla → Run. (Additiva, non rompe il flusso esistente.)
-- ============================================================

-- Bozze ordine in attesa di pagamento (fuori dal flusso del back office).
-- Vi accede SOLO il backend (service-role): contengono PII pre-pagamento.
create table if not exists pending_orders (
  id          uuid primary key default gen_random_uuid(),
  session_id  text unique,
  payload     jsonb not null,           -- dati ordine (importi ricalcolati lato server)
  amount      int   not null,           -- totale in centesimi (controllo)
  created_at  timestamptz not null default now()
);
alter table pending_orders enable row level security;
-- nessuna policy = nessun accesso con anon key; la service-role bypassa la RLS.

-- Colonne pagamento su orders (l'ordine nasce solo se pagato).
alter table orders add column if not exists payment_provider text;
alter table orders add column if not exists payment_id       text;
alter table orders add column if not exists paid_at          timestamptz;

-- Riconciliazione/idempotenza webhook: un id pagamento = un ordine.
create unique index if not exists orders_payment_id_key on orders (payment_id) where payment_id is not null;
