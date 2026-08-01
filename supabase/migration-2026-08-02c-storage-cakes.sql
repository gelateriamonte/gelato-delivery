-- 2026-08-02c — Bucket Storage per le foto delle torte.
--
-- Lettura pubblica: sono foto di prodotto, e domani serviranno anche al sito.
-- Scrittura: solo ruolo authenticated, cioe' il back office loggato.
--
-- NON si usa netlify/functions/upload-home-image.js: e' protetto da un token
-- hardcoded in js/admin.js, che e' servito pubblicamente. Qui si usa la sessione
-- autenticata vera, e non serve nessuna function nuova.

insert into storage.buckets (id, name, public)
values ('cakes', 'cakes', true)
on conflict (id) do nothing;

drop policy if exists "cakes lettura pubblica"        on storage.objects;
drop policy if exists "cakes scrittura autenticata"   on storage.objects;
drop policy if exists "cakes aggiornamento autenticato" on storage.objects;
drop policy if exists "cakes cancellazione autenticata" on storage.objects;

create policy "cakes lettura pubblica"
  on storage.objects for select
  using (bucket_id = 'cakes');

create policy "cakes scrittura autenticata"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cakes');

create policy "cakes aggiornamento autenticato"
  on storage.objects for update to authenticated
  using (bucket_id = 'cakes') with check (bucket_id = 'cakes');

create policy "cakes cancellazione autenticata"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cakes');
