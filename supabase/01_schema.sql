-- =====================================================================
-- RWS Kennisbank – databasescript (Supabase)
-- Plakken in: Supabase → SQL Editor → New query → Run
-- Veilig om opnieuw te draaien (gebruikt "if not exists").
-- =====================================================================

-- ---------- Profielen (naam van collega bij "bijgewerkt door") -------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  naam       text not null default '',
  created_at timestamptz not null default now()
);

-- Automatisch profiel aanmaken als een collega zijn uitnodiging accepteert
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, naam)
  values (new.id, coalesce(new.raw_user_meta_data->>'naam', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Objecten (de post-its op het prikbord) -------------------
create table if not exists public.objecten (
  id              uuid primary key default gen_random_uuid(),
  locatiecode     text unique,                 -- bijv. '1096' uit mail/werkbon
  naam            text not null,
  adres           text,
  lat             double precision,
  lng             double precision,
  apparaattypes   text[] not null default '{}',
  hostnames       text[] not null default '{}',
  -- Toegangskaart
  sleutel         text,                         -- WAAR de sleutel ligt (geen codes!)
  noc_toegang     boolean not null default false,
  noc_info        text,                         -- hoe/wanneer aanvragen
  bijzonderheden  text,
  kleur           text not null default 'geel', -- post-it kleur
  bijgewerkt_door uuid references public.profiles(id),
  bijgewerkt_op   timestamptz not null default now(),
  aangemaakt_op   timestamptz not null default now()
);

-- ---------- Storingen (historie per object) --------------------------
create table if not exists public.storingen (
  id            uuid primary key default gen_random_uuid(),
  object_id     uuid not null references public.objecten(id) on delete cascade,
  datum         date not null default current_date,
  omschrijving  text,
  oorzaak       text,
  oplossing     text,
  meetwaarden   text,                           -- bijv. 'Rx -13,2 dBm na herstel'
  trefwoorden   text[] not null default '{}',
  bron          text not null default 'handmatig'
                check (bron in ('handmatig','melding','werkbon')),
  -- Dubbele import voorkomen ZONDER het meldingnummer zelf op te slaan:
  -- de app slaat alleen een SHA-256 hash van het nummer op.
  bron_hash     text unique,
  aangemaakt_door uuid references public.profiles(id),
  aangemaakt_op   timestamptz not null default now()
);
create index if not exists storingen_object_idx on public.storingen(object_id, datum desc);

-- ---------- Foto's ----------------------------------------------------
create table if not exists public.fotos (
  id              uuid primary key default gen_random_uuid(),
  object_id       uuid not null references public.objecten(id) on delete cascade,
  storing_id      uuid references public.storingen(id) on delete set null,
  pad             text not null,                -- pad in storage-bucket 'fotos'
  bijschrift      text,
  aangemaakt_door uuid references public.profiles(id),
  aangemaakt_op   timestamptz not null default now()
);

-- ---------- Beveiliging (Row Level Security) -------------------------
-- Alleen ingelogde collega's (uitgenodigd) zien en bewerken alles.
-- Verwijderen mag alleen degene die het heeft aangemaakt.
alter table public.profiles  enable row level security;
alter table public.objecten  enable row level security;
alter table public.storingen enable row level security;
alter table public.fotos     enable row level security;

drop policy if exists "profiles lezen"    on public.profiles;
drop policy if exists "eigen profiel"     on public.profiles;
drop policy if exists "eigen profiel maken" on public.profiles;
create policy "profiles lezen" on public.profiles for select to authenticated using (true);
create policy "eigen profiel"  on public.profiles for update to authenticated using (id = auth.uid());
create policy "eigen profiel maken" on public.profiles for insert to authenticated with check (id = auth.uid());

-- Gebruikers die al bestonden vóór dit script ook een profiel geven
insert into public.profiles (id, naam)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

drop policy if exists "objecten lezen"     on public.objecten;
drop policy if exists "objecten toevoegen" on public.objecten;
drop policy if exists "objecten bewerken"  on public.objecten;
create policy "objecten lezen"     on public.objecten for select to authenticated using (true);
create policy "objecten toevoegen" on public.objecten for insert to authenticated with check (true);
create policy "objecten bewerken"  on public.objecten for update to authenticated using (true);

drop policy if exists "storingen lezen"       on public.storingen;
drop policy if exists "storingen toevoegen"   on public.storingen;
drop policy if exists "storingen bewerken"    on public.storingen;
drop policy if exists "storingen verwijderen" on public.storingen;
create policy "storingen lezen"       on public.storingen for select to authenticated using (true);
create policy "storingen toevoegen"   on public.storingen for insert to authenticated with check (aangemaakt_door = auth.uid());
create policy "storingen bewerken"    on public.storingen for update to authenticated using (true);
create policy "storingen verwijderen" on public.storingen for delete to authenticated using (aangemaakt_door = auth.uid());

drop policy if exists "fotos lezen"       on public.fotos;
drop policy if exists "fotos toevoegen"   on public.fotos;
drop policy if exists "fotos verwijderen" on public.fotos;
create policy "fotos lezen"       on public.fotos for select to authenticated using (true);
create policy "fotos toevoegen"   on public.fotos for insert to authenticated with check (aangemaakt_door = auth.uid());
create policy "fotos verwijderen" on public.fotos for delete to authenticated using (aangemaakt_door = auth.uid());

-- ---------- Foto-opslag (privé bucket) -------------------------------
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

drop policy if exists "fotos bucket lezen"       on storage.objects;
drop policy if exists "fotos bucket uploaden"    on storage.objects;
drop policy if exists "fotos bucket verwijderen" on storage.objects;
create policy "fotos bucket lezen"       on storage.objects for select to authenticated using (bucket_id = 'fotos');
create policy "fotos bucket uploaden"    on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos bucket verwijderen" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and owner = auth.uid());
