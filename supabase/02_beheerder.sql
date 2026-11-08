-- =====================================================================
-- RWS Kennisbank – beheerder mag objecten verwijderen
-- Plakken in: Supabase → SQL Editor → New query → Run
-- Veilig om opnieuw te draaien. Draai eerst 01_schema.sql.
-- =====================================================================

-- Beheerder-vlag op het profiel
alter table public.profiles add column if not exists beheerder boolean not null default false;

-- Collega's mogen alleen hun eigen naam aanpassen, niet zichzelf beheerder maken
revoke insert, update on public.profiles from authenticated, anon;
grant insert (id, naam) on public.profiles to authenticated;
grant update (naam) on public.profiles to authenticated;

-- Is de ingelogde gebruiker beheerder?
create or replace function public.is_beheerder()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select beheerder from public.profiles where id = auth.uid()), false)
$$;

-- Alleen de beheerder mag een object verwijderen.
-- Storingen en foto-regels van dat object gaan automatisch mee (on delete cascade).
drop policy if exists "objecten verwijderen" on public.objecten;
create policy "objecten verwijderen" on public.objecten
  for delete to authenticated using (public.is_beheerder());

-- De beheerder mag ook de foto-bestanden van dat object opruimen
drop policy if exists "fotos bucket beheerder verwijderen" on storage.objects;
create policy "fotos bucket beheerder verwijderen" on storage.objects
  for delete to authenticated using (bucket_id = 'fotos' and public.is_beheerder());

-- ---------------------------------------------------------------------
-- Jezelf beheerder maken: haal de -- weg, vul je e-mailadres in en Run.
-- update public.profiles set beheerder = true
--   where id = (select id from auth.users where email = 'JOUW-EMAILADRES');
