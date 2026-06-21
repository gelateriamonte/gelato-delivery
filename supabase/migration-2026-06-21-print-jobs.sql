-- ============================================================
-- Coda di stampa per Epson TM-m30III (Server Direct Print).
-- La stampante polla /.netlify/functions/epson-sdp; la function serve i job
-- da questa coda e ne registra l'esito. Vedi docs/superpowers/specs/2026-06-21-...
-- Esegui in Supabase: SQL Editor → incolla → Run (oppure via MCP apply_migration).
-- ============================================================

create table if not exists print_jobs (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  status      text not null default 'pending',   -- pending | printing | done | error
  printjobid  text,                               -- id correlazione SDP (≤30 char), set al claim
  attempts    int  not null default 0,            -- incrementato su SetResponse success=false
  reclaims    int  not null default 0,            -- quante volte ri-servito senza ack stampante
  last_error  text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,                        -- quando passa a 'printing' (per reclaim)
  printed_at  timestamptz
);

create index if not exists print_jobs_pending_idx on print_jobs (created_at) where status = 'pending';

-- ---------- RLS ----------
-- anon (anon key è pubblica in config.js) serve SOLO al bottone "Ristampa" → INSERT.
-- La function usa SERVICE_ROLE (bypassa RLS) per select/update/claim. print_jobs NON contiene PII.
alter table print_jobs enable row level security;
drop policy if exists "proto anon print_jobs insert" on print_jobs;
create policy "proto anon print_jobs insert" on print_jobs for insert to anon with check (true);
grant insert on print_jobs to anon;

-- ---------- CLAIM ATOMICO ----------
-- Serve UN job per volta e garantisce che non ci sia mai più di un job in 'printing'
-- (così l'esito SetResponse è correlabile in modo deterministico anche senza printjobid):
--   (1) reclaim degli stallati (printer ha preso il job ma non ha mai confermato l'esito);
--   (2) se resta un 'printing' attivo → non claimare (un solo scontrino in volo);
--   (3) altrimenti claima il 'pending' più vecchio con lock di riga.
create or replace function claim_print_job(reclaim_after interval default interval '5 minutes',
                                           max_reclaims int default 3)
returns setof print_jobs
language plpgsql
as $$
declare job print_jobs;
begin
  update print_jobs
     set status     = case when reclaims + 1 > max_reclaims then 'error' else 'pending' end,
         reclaims   = reclaims + 1,
         last_error = case when reclaims + 1 > max_reclaims then 'reclaim_exhausted' else last_error end
   where status = 'printing' and claimed_at < now() - reclaim_after;

  if exists (select 1 from print_jobs where status = 'printing') then
    return;                                  -- invariante: un solo job in volo
  end if;

  select * into job from print_jobs
   where status = 'pending' order by created_at
   for update skip locked limit 1;
  if not found then return; end if;

  update print_jobs
     set status = 'printing', claimed_at = now(),
         printjobid = left(replace(job.id::text, '-', ''), 30)
   where id = job.id
   returning * into job;
  return next job;
end;
$$;
