-- ============================================================
-- 2026-06-07 — Gusto del giorno + microdescrizione
-- Flag "daily" (gusto del giorno) e "description" (microdescrizione)
-- sui gusti. La home mostra SOLO i gusti del giorno (daily=true),
-- con nome + microdescrizione, prelevati da qui via flag.
-- ============================================================

alter table flavors add column if not exists daily boolean not null default false;
alter table flavors add column if not exists description text;

-- Seed iniziale (id espliciti): 6 gusti "del giorno" con microdescrizione.
update flavors set daily=true, description='tostato'            where id='a1a02522-6f51-41a4-beed-cd46f850025b';
update flavors set daily=true, description='fondente'           where id='471a8e07-b814-42a1-b61a-644cddb7827e';
update flavors set daily=true, description='tonda e gentile'    where id='770d6e22-c56a-4b8c-8840-d35044fc78b2';
update flavors set daily=true, description='specialità sarda'   where id='eaebf0eb-3c04-4cd1-871b-27c68e7fba0a';
update flavors set daily=true, description='cremoso e delicato' where id='81570b53-a564-43b1-a73b-b9e69c708322';
update flavors set daily=true, description='frutto intero'      where id='2179b162-5428-4a5a-93f9-7346db321e05';
