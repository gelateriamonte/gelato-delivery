-- Homepage CMS + giorni max prenotabili. Additive. (Applicate via MCP il 2026-06-08.)
-- settings.home_content: override testi/immagini/ops della homepage (editor in Parametri);
--   se NULL/assente, la homepage usa i default in js/i18n.js (nessuna regressione).
-- settings.max_advance_days: quanti giorni futuri il cliente puo' prenotare (1..15, default 6 = oggi+6).
alter table settings add column if not exists home_content     jsonb;
alter table settings add column if not exists max_advance_days int not null default 6;

-- Bucket Storage pubblico per le immagini della homepage (hero + carosello). Max 5MB, solo immagini.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('home', 'home', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;
