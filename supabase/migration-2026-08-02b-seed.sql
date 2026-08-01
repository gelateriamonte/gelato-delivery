-- 2026-08-02b — Popolamento iniziale.
--
-- 1) Anagrafica dai clienti gia' presenti negli ordini gelato: un cliente per
--    telefono normalizzato, nome ed email dall'ordine PIU' RECENTE del gruppo.
-- 2) Articoli torta forniti dal titolare. Prezzi volutamente NULL: li compila lui
--    dal back office. has_small/has_large dicono quali formati esistono davvero.

insert into public.customers (name, phone, email)
select distinct on (public.norm_mobile(o.customer_phone))
       o.customer_name,
       o.customer_phone,
       nullif(o.email, '')
  from public.orders o
 where o.customer_phone is not null
   and coalesce(public.norm_mobile(o.customer_phone), '') <> ''
 order by public.norm_mobile(o.customer_phone), o.created_at desc
on conflict (phone_norm) do nothing;

insert into public.cake_items (name, has_small, has_large, sort_order)
select v.name, v.hs, v.hl, v.ord
  from (values
    ('Nocciola e cioccolato', true,  true, 1),
    ('Cocco e caffè',         true,  true, 2),
    ('Caramello salato',      true,  true, 3),
    ('Tiramisù',              false, true, 4),
    ('Cheesecake',            true,  true, 5),
    ('Pistacchio',            true,  true, 6),
    ('Cioccolato e lamponi',  true,  true, 7),
    ('Sfera Roche',           true,  true, 8)
  ) as v(name, hs, hl, ord)
 where not exists (select 1 from public.cake_items c where c.name = v.name);
