-- Migration 2026-07-02 — Hardening ancoraggio coupon per-cliente (codici 'always').
-- (1) Normalizza il telefono nel match (toglie prefisso 39/0039) → stesso numero
--     in formati diversi ("333.." vs "+39 333..") non aggira l'anticipo.
-- (2) Esclude gli ordini annullati/rifiutati dal conteggio → un ordine cancellato
--     libera nuovamente il codice per quel cliente.
-- Allineata a applyCoupon (netlify/functions/lib/order-pricing.js). Idempotente.

-- Helper: cifre del numero senza prefisso internazionale IT (39/0039) → cellulare locale.
create or replace function public.norm_mobile(p text)
returns text language sql immutable as $$
  select case
    when left(d, 4) = '0039' then substr(d, 5)
    when length(d) = 12 and left(d, 2) = '39' then substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Pre-check coupon (specchio di applyCoupon). Rigenerata con telefono normalizzato
-- e stati non-terminali.
create or replace function public.rpc_coupon_precheck(p_code text, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d        record;
  phone_d  text;
  email_n  text;
  already  boolean;
begin
  select * into d
    from public.discount_codes
   where code ilike p_code and active = true
   limit 1;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if d.kind = 'oneoff' then
    if d.burned or d.used_count > 0 then
      return jsonb_build_object('valid', false, 'reason', 'exhausted');
    end if;
    return jsonb_build_object('valid', true, 'type', d.discount_type, 'value', d.value);
  end if;

  -- Always: una volta per cliente (telefono normalizzato O email), escludendo
  -- gli ordini annullati/rifiutati.
  phone_d := public.norm_mobile(p_phone);
  email_n := lower(trim(coalesce(p_email, '')));

  select exists (
    select 1
      from public.orders o
     where o.coupon_code ilike d.code
       and o.status not in ('annullato', 'rifiutato')
       and (
         (phone_d <> '' and public.norm_mobile(o.customer_phone) = phone_d)
         or
         (email_n <> '' and lower(trim(coalesce(o.email, ''))) = email_n)
       )
  ) into already;

  if already then
    return jsonb_build_object('valid', false, 'reason', 'already_used');
  end if;

  return jsonb_build_object('valid', true, 'type', d.discount_type, 'value', d.value);
end;
$$;

revoke all on function public.rpc_coupon_precheck(text, text, text) from public;
grant execute on function public.rpc_coupon_precheck(text, text, text) to anon, authenticated;
