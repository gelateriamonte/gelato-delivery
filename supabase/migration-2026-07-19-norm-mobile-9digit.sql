-- Migration 2026-07-19 — norm_mobile: supporto numeri storici a 9 cifre.
-- I cellulari italiani anni '90 (330/335/337/360…) hanno 9 cifre totali
-- (prefisso 3xx + 6). Con "+39" davanti fanno 11 cifre: il vecchio strip
-- del prefisso scattava solo a 12 → "39335256919" restava non normalizzato
-- e il match coupon per-cliente falliva tra formati diversi dello stesso
-- numero. Allineata a isMobileIT (js/order.js). Idempotente.

create or replace function public.norm_mobile(p text)
returns text language sql immutable as $$
  select case
    when left(d, 4) = '0039' then substr(d, 5)
    when length(d) in (11, 12) and left(d, 2) = '39' then substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;
