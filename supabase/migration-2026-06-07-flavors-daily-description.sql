-- ============================================================
-- 2026-06-07 — Gusto del giorno + microdescrizione
-- Flag "daily" (gusto del giorno) e "description" (microdescrizione)
-- sui gusti. La home mostra SOLO i gusti del giorno (daily=true),
-- con nome + microdescrizione, prelevati da qui via flag.
-- ============================================================

alter table flavors add column if not exists daily boolean not null default false;
alter table flavors add column if not exists description text;

-- Seed iniziale: 6 gusti "del giorno" con microdescrizione (per nome, portabile/idempotente).
update flavors set daily=true, description='tostato'            where name ilike 'Pistacchio%';
update flavors set daily=true, description='fondente'           where name ilike 'Cioccolato%';
update flavors set daily=true, description='tonda e gentile'    where name ilike 'Nocciola%';
update flavors set daily=true, description='specialità sarda'   where name ilike 'Aranzada%';
update flavors set daily=true, description='cremoso e delicato' where name ilike 'Ricotta e fichi%';
update flavors set daily=true, description='frutto intero'      where name ilike 'Fragola%';
