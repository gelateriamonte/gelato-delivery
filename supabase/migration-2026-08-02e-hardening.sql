-- 2026-08-02e — Tre correzioni emerse dalla review.

-- 1) Una torta deve avere almeno un formato.
-- Senza questo vincolo si puo' togliere sia has_small sia has_large, e la modale
-- ordine mostra un menu Formato VUOTO: l'articolo e' selezionabile ma l'ordine non
-- e' completabile, e il messaggio d'errore indica un campo che non si puo' compilare.
alter table public.cake_items drop constraint if exists cake_items_almeno_un_formato;
alter table public.cake_items add constraint cake_items_almeno_un_formato
  check (has_small or has_large);

-- 2) Limiti sul bucket delle foto, allineati a quelli gia' decisi per il bucket `home`.
-- Senza allowed_mime_types passa anche image/svg+xml, che e' uno script eseguibile
-- servito dal dominio del progetto. Il `do update` e' necessario: il bucket esiste
-- gia', quindi un semplice `do nothing` non applicherebbe nulla.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cakes', 'cakes', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
  set file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3) Niente enumerazione del bucket da parte di anon.
-- Le foto vengono servite dal percorso /object/public/, che NON consulta la RLS:
-- la policy di lettura pubblica non serve a mostrarle, ma abilita l'API di listing,
-- con cui chiunque abbia la chiave pubblica elenca ogni file del bucket (comprese
-- le foto di torte tolte dal catalogo, che l'upload non cancella mai).
-- Il bucket `home` infatti non ha alcuna policy e non e' enumerabile.
drop policy if exists "cakes lettura pubblica" on storage.objects;

create policy "cakes lettura autenticata"
  on storage.objects for select to authenticated
  using (bucket_id = 'cakes');
