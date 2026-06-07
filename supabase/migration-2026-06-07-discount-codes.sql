-- Codici sconto: tabella + colonne ordine. Applicata su Supabase il 2026-06-07.
-- 'always' = riutilizzabile · 'oneoff' = si brucia al primo uso. value = € (fixed) o % (percent).

create table if not exists discount_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  kind          text not null default 'always',          -- 'always' | 'oneoff'
  discount_type text not null default 'fixed',            -- 'fixed' (€) | 'percent' (%)
  value         numeric(8,2) not null default 0,
  active        boolean not null default true,
  used_count    int not null default 0,                   -- quante volte usato
  burned        boolean not null default false,           -- one-off consumato
  created_at    timestamptz not null default now()
);
create unique index if not exists discount_codes_code_uniq on discount_codes (lower(code));

alter table discount_codes enable row level security;
drop policy if exists "proto anon discount_codes" on discount_codes;
create policy "proto anon discount_codes" on discount_codes for all to anon using (true) with check (true);
grant all on discount_codes to anon;

-- traccia del coupon usato sull'ordine
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount numeric(8,2) not null default 0;
