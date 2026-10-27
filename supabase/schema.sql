-- ===========================================================================
-- TuttoUno! — Schéma Supabase
-- ===========================================================================
--
-- COMMENT L'EXÉCUTER DEPUIS TON IPHONE
-- ------------------------------------
-- 1. Ouvre Safari sur https://supabase.com/dashboard
-- 2. Choisis ton projet.
-- 3. Menu de gauche → « SQL Editor ».
-- 4. Touche « New query ».
-- 5. Colle TOUT le contenu de ce fichier.
-- 6. Touche « Run ».
-- 7. Tu dois voir « Success. No rows returned ».
--
-- ⚠️  CE FICHIER NE CRÉE AUCUNE DONNÉE PERSONNELLE.
-- ⚠️  IDEMPOTENT : tu peux le relancer sans rien casser.
--
-- APRÈS EXÉCUTION
-- ---------------
-- Authentication → Users : crée TON compte e-mail. Sans compte, tu ne pourras
-- rien écrire — et c'est exactement le but.
-- ===========================================================================


-- ===========================================================================
-- 1. EXTENSIONS
-- ===========================================================================

create extension if not exists pgcrypto;


-- ===========================================================================
-- 2. TABLE `profiles`
-- ===========================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale       text default 'fr-CH',
  compact_mode boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Profil minimal, un par utilisateur. Isolé par RLS sur auth.uid().';


-- ===========================================================================
-- 3. TABLE `applications`
-- ===========================================================================
-- Les neuf statuts sont contraints par un CHECK : une valeur hors liste est
-- refusée par la base, pas seulement par l'interface.

create table if not exists public.applications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,

  company        text not null,
  role           text not null,
  location       text,

  applied_date   date not null default current_date,
  follow_up_date date,
  last_follow_up date,

  status         text not null default 'a_preparer'
                 check (status in (
                   'a_preparer',
                   'a_envoyer',
                   'envoyee',
                   'en_attente',
                   'entretien',
                   'deuxieme_entretien',
                   'offre',
                   'refusee',
                   'cloturee'
                 )),

  url            text,
  notes          text,
  deadline_done  boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.applications is
  'Candidatures. Chaque ligne porte son user_id ; RLS interdit tout accès croisé.';

comment on column public.applications.deadline_done is
  'Marque l''échéance comme traitée dans l''onglet Échéances.';


-- ===========================================================================
-- 4. TABLE `documents`
-- ===========================================================================
-- Métadonnées seules. Le fichier binaire vit dans Storage, et `storage_path`
-- contient le chemin dans le bucket privé — jamais une URL publique.

create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,

  name           text not null,
  category       text not null default 'autre'
                 check (category in (
                   'cv',
                   'lettre',
                   'certificat',
                   'diplome',
                   'attestation',
                   'autre'
                 )),

  description    text,
  added_at       date not null default current_date,

  storage_path   text,
  file_name      text,
  file_size      bigint,
  mime_type      text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.documents is
  'Métadonnées de documents. Le fichier binaire est dans Storage, jamais ici.';

comment on column public.documents.storage_path is
  'Chemin dans le bucket privé « documents ». Ne jamais exposer d''URL publique.';


-- ===========================================================================
-- 5. TABLE `deadlines`
-- ===========================================================================
-- ⚠️  IMPORTANT — À LIRE
-- L'application actuelle CALCULE ses échéances sur l'appareil à partir des
-- candidatures. Elle ne lit ni n'écrit cette table.
--
-- Elle existe pour accueillir plus tard des échéances autonomes. Ce n'est PAS
-- une fonctionnalité active : ne crois pas que tes échéances sont stockées ici.

create table if not exists public.deadlines (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,

  title          text not null,
  kind           text not null default 'relance'
                 check (kind in ('relance', 'entretien', 'limite', 'autre')),

  due_date       date not null,
  done           boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.deadlines is
  'Échéances autonomes. Préparée pour la suite ; non utilisée par la V1.';


-- ===========================================================================
-- 6. INDEX
-- ===========================================================================
-- Sans index sur user_id, chaque politique RLS forcerait un balayage complet.
-- Ces index sont donc aussi des index de sécurité.

create index if not exists applications_user_id_idx     on public.applications(user_id);
create index if not exists applications_status_idx      on public.applications(user_id, status);
create index if not exists applications_follow_up_idx   on public.applications(user_id, follow_up_date);
create index if not exists documents_user_id_idx        on public.documents(user_id);
create index if not exists documents_application_idx    on public.documents(application_id);
create index if not exists deadlines_user_id_idx        on public.deadlines(user_id);
create index if not exists deadlines_due_date_idx       on public.deadlines(user_id, due_date);


-- ===========================================================================
-- 7. DÉCLENCHEUR `updated_at`
-- ===========================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists applications_touch_updated_at on public.applications;
create trigger applications_touch_updated_at
  before update on public.applications
  for each row execute function public.touch_updated_at();

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

drop trigger if exists deadlines_touch_updated_at on public.deadlines;
create trigger deadlines_touch_updated_at
  before update on public.deadlines
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ===========================================================================
-- 8. CRÉATION AUTOMATIQUE DU PROFIL
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ===========================================================================
-- 9. ROW LEVEL SECURITY
-- ===========================================================================
--
-- C'EST LA PARTIE LA PLUS IMPORTANTE DE CE FICHIER.
--
-- Sans RLS, la clé publique « anon » donnerait à n'importe qui — muni de
-- l'URL de ton projet, qui est visible dans le code de la page — accès à
-- TOUTES les lignes de TOUS les utilisateurs.

alter table public.profiles     enable row level security;
alter table public.applications enable row level security;
alter table public.documents    enable row level security;
alter table public.deadlines    enable row level security;

alter table public.profiles     force row level security;
alter table public.applications force row level security;
alter table public.documents    force row level security;
alter table public.deadlines    force row level security;

-- ---------------------------------------------------------------------------
-- 9.1 profiles
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 9.2 applications
-- ---------------------------------------------------------------------------

drop policy if exists "applications_select_own" on public.applications;
create policy "applications_select_own"
  on public.applications for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "applications_insert_own" on public.applications;
create policy "applications_insert_own"
  on public.applications for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "applications_update_own" on public.applications;
create policy "applications_update_own"
  on public.applications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "applications_delete_own" on public.applications;
create policy "applications_delete_own"
  on public.applications for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 9.3 documents
-- ---------------------------------------------------------------------------
-- La politique d'insertion vérifie DEUX choses : que la ligne appartient bien
-- à l'utilisateur connecté, ET que la candidature référencée lui appartient
-- aussi. Sans cette seconde vérification, on pourrait rattacher un document à
-- la candidature de quelqu'un d'autre.

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
  on public.documents for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      application_id is null
      or exists (
        select 1 from public.applications a
        where a.id = application_id and a.user_id = auth.uid()
      )
    )
  );

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
  on public.documents for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      application_id is null
      or exists (
        select 1 from public.applications a
        where a.id = application_id and a.user_id = auth.uid()
      )
    )
  );

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
  on public.documents for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 9.4 deadlines
-- ---------------------------------------------------------------------------

drop policy if exists "deadlines_select_own" on public.deadlines;
create policy "deadlines_select_own"
  on public.deadlines for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "deadlines_insert_own" on public.deadlines;
create policy "deadlines_insert_own"
  on public.deadlines for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "deadlines_update_own" on public.deadlines;
create policy "deadlines_update_own"
  on public.deadlines for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "deadlines_delete_own" on public.deadlines;
create policy "deadlines_delete_own"
  on public.deadlines for delete
  to authenticated
  using (auth.uid() = user_id);


-- ===========================================================================
-- 10. STOCKAGE PRIVÉ DES DOCUMENTS
-- ===========================================================================
--
-- Le bucket s'appelle « documents », créé avec public = false : AUCUNE URL
-- directe ne fonctionne.
--
-- Convention de chemin OBLIGATOIRE :
--     <user_id>/<nom-de-fichier>
--
-- Le premier segment est l'identifiant de l'utilisateur : c'est ce qui permet
-- à la politique d'autoriser l'accès au bon propriétaire et à lui seul.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents_bucket_select_own" on storage.objects;
create policy "documents_bucket_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_bucket_insert_own" on storage.objects;
create policy "documents_bucket_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_bucket_update_own" on storage.objects;
create policy "documents_bucket_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_bucket_delete_own" on storage.objects;
create policy "documents_bucket_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ===========================================================================
-- 11. VÉRIFICATION — À LIRE APRÈS L'EXÉCUTION
-- ===========================================================================
-- Décommente et exécute séparément. Résultat attendu :

-- select
--   c.relname                        as table_name,
--   c.relrowsecurity                 as rls_actif,
--   c.relforcerowsecurity            as rls_force,
--   (select count(*) from pg_policies p
--     where p.schemaname = 'public' and p.tablename = c.relname) as nb_politiques
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('profiles', 'applications', 'documents', 'deadlines')
-- order by c.relname;

--   applications | true | true | 4
--   deadlines    | true | true | 4
--   documents    | true | true | 4
--   profiles     | true | true | 3
--
-- Si une ligne affiche `false` en première position, ARRÊTE-TOI : n'écris
-- aucune donnée personnelle avant d'avoir compris pourquoi.
--
-- Vérifie ensuite que le bucket est privé :

-- select id, name, public from storage.buckets where id = 'documents';
--   documents | documents | false
--
-- Si `public` vaut `true` :
--   update storage.buckets set public = false where id = 'documents';
--
-- ===========================================================================
