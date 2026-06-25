-- ============================================================
-- FASE A: additiva, retro-compatibile.
-- Aggiunge policy per il ruolo `authenticated` (admin dopo login Supabase Auth)
-- e due RPC SECURITY DEFINER che espongono solo dati minimi (no PII).
-- NON rimuove l'accesso anon esistente (vedi Fase B).
-- Esegui in Supabase: SQL Editor → incolla → Run.
-- ============================================================

-- 1) Policy 'authenticated' — l'admin opera come authenticated dopo il login Supabase Auth.
--    Coprono tutte le tabelle presenti (incluse quelle aggiunte via migration successive).

create policy "auth all flavors"         on public.flavors         for all to authenticated using (true) with check (true);
create policy "auth all formats"         on public.formats         for all to authenticated using (true) with check (true);
create policy "auth all time_slots"      on public.time_slots      for all to authenticated using (true) with check (true);
create policy "auth all slot_day_state"  on public.slot_day_state  for all to authenticated using (true) with check (true);
create policy "auth all settings"        on public.settings        for all to authenticated using (true) with check (true);
create policy "auth all orders"          on public.orders          for all to authenticated using (true) with check (true);
create policy "auth all discount_codes"  on public.discount_codes  for all to authenticated using (true) with check (true);
create policy "auth all print_jobs"      on public.print_jobs      for all to authenticated using (true) with check (true);

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 2) RPC SECURITY DEFINER — espongono SOLO dati minimi (no PII).
--    Chiamabili da anon e authenticated; la logica è identica a create-checkout.js.

-- ---------------------------------------------------------------------------
-- rpc_slot_availability(p_date)
-- Conta gli ordini "attivi" per fascia in un dato giorno.
-- Specchio di create-checkout.js riga 43:
--   .in("status", LAVORAZIONE)
--   dove LAVORAZIONE = ["ricevuto","accettato","in preparazione","in consegna"]
-- Restituisce (slot_label, taken) — niente PII clienti.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_slot_availability(p_date date)
returns table(slot_label text, taken int)
language sql security definer set search_path = public as $$
  select o.slot_label, count(*)::int as taken
  from public.orders o
  where o.delivery_date = p_date
    and o.status in ('ricevuto', 'accettato', 'in preparazione', 'in consegna')
  group by o.slot_label;
$$;
revoke all on function public.rpc_slot_availability(date) from public;
grant execute on function public.rpc_slot_availability(date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- rpc_coupon_precheck(p_code, p_contact)
-- Valida un codice sconto lato server. Specchio di create-checkout.js righe 82-101:
--
--   a) Lookup: ilike(code, p_code) AND active = true
--   b) kind = 'oneoff': burned OR used_count > 0 → exhausted
--   c) kind != 'oneoff' (es. 'always'): cerca ordini precedenti con
--        coupon_code ilike dc.code
--      dove il cliente è riconosciuto se:
--        - phone digits corrispondono (regexp_replace su entrambi, solo cifre)
--        - oppure email corrisponde (trim + lower)
--      Se trovato → already_used.
--
-- Restituisce { valid, reason?, type?, value? } — niente PII clienti.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_coupon_precheck(p_code text, p_contact text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d        record;
  phone_d  text;
  email_n  text;
  already  boolean;
begin
  -- Lookup case-insensitive (ilike), deve essere active
  select * into d
    from public.discount_codes
   where code ilike p_code
     and active = true
   limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  -- Oneoff: si brucia al primo utilizzo globale (burned o used_count > 0)
  if d.kind = 'oneoff' then
    if d.burned or d.used_count > 0 then
      return jsonb_build_object('valid', false, 'reason', 'exhausted');
    end if;
    -- oneoff non ancora bruciato: valido per chiunque
    return jsonb_build_object('valid', true, 'type', d.discount_type, 'value', d.value);
  end if;

  -- Always (riutilizzabile): una sola volta per cliente.
  -- Normalizza il contatto in ingresso: prova sia come telefono (digits) che come email.
  phone_d := regexp_replace(p_contact, '[^0-9]', '', 'g');
  email_n := lower(trim(p_contact));

  select exists (
    select 1
      from public.orders o
     where o.coupon_code ilike d.code
       and (
         -- match telefono (solo cifre, entrambi i lati)
         (phone_d <> '' and regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g') = phone_d)
         or
         -- match email (lower + trim)
         (email_n <> '' and lower(trim(coalesce(o.email, ''))) = email_n)
       )
  ) into already;

  if already then
    return jsonb_build_object('valid', false, 'reason', 'already_used');
  end if;

  return jsonb_build_object('valid', true, 'type', d.discount_type, 'value', d.value);
end;
$$;
revoke all on function public.rpc_coupon_precheck(text, text) from public;
grant execute on function public.rpc_coupon_precheck(text, text) to anon, authenticated;
