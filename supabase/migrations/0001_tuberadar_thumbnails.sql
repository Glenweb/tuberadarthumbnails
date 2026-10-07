-- ═══════════════════════════════════════════════════════════════════════════
-- TubeRadar Thumbnails — module schema
--
-- Designed to be applied INTO the existing TubeRadar Supabase project, not
-- alongside it. Every table is prefixed `trt_` so it cannot collide with core
-- TubeRadar tables, and every tenant row keys off `auth.users.id` so the module
-- inherits TubeRadar's existing auth with no second login.
--
--   supabase db push          (or paste into the SQL editor)
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─────────────────────────────── Accounts ────────────────────────────────

create table if not exists public.trt_users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text        not null,
  display_name       text,
  -- Thumbnails upgrade tier. 'free' means the user is on TubeRadar Core with
  -- no Thumbnails upgrade active.
  plan               text        not null default 'free'
                                 check (plan in ('free','creator','studio','agency')),
  credits_remaining  integer     not null default 25 check (credits_remaining >= 0),
  period_start       timestamptz not null default now(),
  stripe_customer_id text,
  created_at         timestamptz not null default now()
);

-- Append-only spend log: every balance is explainable, which is what makes a
-- metered product defensible when a customer disputes their usage.
create table if not exists public.trt_credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references public.trt_users (id) on delete cascade,
  delta         integer     not null,
  action        text        not null,
  balance_after integer     not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists trt_credit_ledger_user_time
  on public.trt_credit_ledger (user_id, created_at desc);

-- ─────────────────────────────── Channels ────────────────────────────────

create table if not exists public.trt_channels (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid        not null references public.trt_users (id) on delete cascade,
  youtube_channel_id text,
  title              text        not null,
  handle             text,
  subscriber_count   bigint,
  avatar_url         text,
  -- Brand kit: palette, font, overlay treatment, logo.
  brand              jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists trt_channels_user on public.trt_channels (user_id);

-- ────────────────────────────── Source videos ────────────────────────────

create table if not exists public.trt_source_videos (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references public.trt_users (id) on delete cascade,
  channel_id          uuid        references public.trt_channels (id) on delete set null,
  youtube_id          text,
  url                 text,
  title               text,
  description         text,
  keyword             text,
  thumbnail_url       text,
  thumbnail_asset_id  uuid,
  channel_title       text,
  view_count          bigint,
  like_count          bigint,
  comment_count       bigint,
  duration_seconds    integer,
  published_at        timestamptz,
  tags                text[],
  transcript          text,
  transcript_source   text        not null default 'none'
                                  check (transcript_source in ('timedtext','none')),
  -- Pixel analysis of the ORIGINAL thumbnail: the baseline a variant must beat.
  baseline_analysis   jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists trt_source_videos_user_time
  on public.trt_source_videos (user_id, created_at desc);
create index if not exists trt_source_videos_keyword
  on public.trt_source_videos (user_id, keyword);

-- ──────────────────────────── Competitor shelves ─────────────────────────

create table if not exists public.trt_competitor_shelves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.trt_users (id) on delete cascade,
  keyword     text        not null,
  region      text        not null default 'GB',
  source      text        not null check (source in ('youtube_api','modelled')),
  -- Each competitor carries its thumbnail analysis and its score under the
  -- identical engine, which is what makes shelf ranking like-for-like.
  videos      jsonb       not null default '[]'::jsonb,
  fingerprint jsonb       not null,
  created_at  timestamptz not null default now()
);
create index if not exists trt_shelves_lookup
  on public.trt_competitor_shelves (user_id, keyword, region, created_at desc);

-- ───────────────────────────────── Assets ────────────────────────────────

create table if not exists public.trt_assets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.trt_users (id) on delete cascade,
  kind       text        not null check (kind in ('base','render','source','competitor')),
  mime       text        not null,
  width      integer     not null,
  height     integer     not null,
  bytes      integer     not null,
  -- Object key inside the storage bucket.
  path       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists trt_assets_user on public.trt_assets (user_id, created_at desc);

-- ──────────────────────────────── Variants ───────────────────────────────

create table if not exists public.trt_thumbnail_variants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references public.trt_users (id) on delete cascade,
  source_video_id uuid        references public.trt_source_videos (id) on delete set null,
  run_id          uuid        not null,
  label           text        not null,
  concept         jsonb,
  origin          text        not null
                              check (origin in ('generated','uploaded','youtube','synthesized')),
  base_asset_id   uuid        not null,
  render_asset_id uuid,
  overlays        jsonb       not null default '[]'::jsonb,
  analysis        jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists trt_variants_user_time
  on public.trt_thumbnail_variants (user_id, created_at desc);
create index if not exists trt_variants_run on public.trt_thumbnail_variants (run_id);
create index if not exists trt_variants_source
  on public.trt_thumbnail_variants (source_video_id);

create table if not exists public.trt_title_variants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references public.trt_users (id) on delete cascade,
  source_video_id uuid        references public.trt_source_videos (id) on delete set null,
  run_id          uuid        not null,
  text            text        not null,
  archetype       text        not null,
  rationale       text,
  origin          text        not null check (origin in ('claude','heuristic','user')),
  created_at      timestamptz not null default now()
);
create index if not exists trt_titles_user_time
  on public.trt_title_variants (user_id, created_at desc);

-- ───────────────────────────────── Scores ────────────────────────────────

create table if not exists public.trt_pair_scores (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid        not null references public.trt_users (id) on delete cascade,
  variant_id        uuid        references public.trt_thumbnail_variants (id) on delete set null,
  title_variant_id  uuid        references public.trt_title_variants (id) on delete set null,
  source_video_id   uuid        references public.trt_source_videos (id) on delete set null,
  shelf_id          uuid        references public.trt_competitor_shelves (id) on delete set null,
  trc               numeric(5,2) not null check (trc >= 0 and trc <= 100),
  grade             text        not null check (grade in ('S','A','B','C','D')),
  pillars           jsonb       not null,
  fixes             jsonb       not null default '[]'::jsonb,
  shelf             jsonb,
  "ctrEstimate"     jsonb       not null,
  axes              jsonb       not null,
  critique          jsonb,
  -- Pin the engine version so historical scores stay interpretable after the
  -- weights change. Never silently re-score old rows under new weights.
  engine_version    text        not null,
  created_at        timestamptz not null default now()
);
create index if not exists trt_scores_user_time
  on public.trt_pair_scores (user_id, created_at desc);

-- ────────────────────────────── Saved winners ────────────────────────────

create table if not exists public.trt_saved_winners (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null references public.trt_users (id) on delete cascade,
  variant_id       uuid        not null references public.trt_thumbnail_variants (id) on delete cascade,
  title_variant_id uuid        references public.trt_title_variants (id) on delete set null,
  score_id         uuid        references public.trt_pair_scores (id) on delete set null,
  source_video_id  uuid        references public.trt_source_videos (id) on delete set null,
  title_text       text        not null,
  trc              numeric(5,2) not null,
  keyword          text,
  notes            text,
  -- Real-world result recorded after publishing. Predicted-vs-actual is the
  -- only honest way to earn trust in a modelled CTR number.
  actual           jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists trt_winners_user_time
  on public.trt_saved_winners (user_id, created_at desc);

-- ══════════════════════════════════════════════════════════════════════════
-- Row level security
--
-- The server uses the service-role key and enforces tenancy in application
-- code, but these policies are the backstop: a leaked anon key still cannot
-- read another tenant's work.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.trt_users             enable row level security;
alter table public.trt_credit_ledger     enable row level security;
alter table public.trt_channels          enable row level security;
alter table public.trt_source_videos     enable row level security;
alter table public.trt_competitor_shelves enable row level security;
alter table public.trt_assets            enable row level security;
alter table public.trt_thumbnail_variants enable row level security;
alter table public.trt_title_variants    enable row level security;
alter table public.trt_pair_scores       enable row level security;
alter table public.trt_saved_winners     enable row level security;

do $$
declare t text;
begin
  -- Own-row access for every tenant table.
  foreach t in array array[
    'trt_channels','trt_source_videos','trt_competitor_shelves','trt_assets',
    'trt_thumbnail_variants','trt_title_variants','trt_pair_scores','trt_saved_winners'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner', t);
  end loop;
end $$;

drop policy if exists trt_users_self on public.trt_users;
create policy trt_users_self on public.trt_users
  for select to authenticated using (id = auth.uid());

-- Credits are written server-side only: a client that could write its own
-- balance is not a metered product.
drop policy if exists trt_ledger_read on public.trt_credit_ledger;
create policy trt_ledger_read on public.trt_credit_ledger
  for select to authenticated using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- Storage
-- ══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('tuberadar-thumbnails', 'tuberadar-thumbnails', false)
on conflict (id) do nothing;

drop policy if exists trt_storage_owner on storage.objects;
create policy trt_storage_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'tuberadar-thumbnails' and owner = auth.uid())
  with check (bucket_id = 'tuberadar-thumbnails' and owner = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- Provisioning: a TubeRadar signup gets a Thumbnails row automatically, so the
-- upgrade tier is one plan change away rather than a separate onboarding.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.trt_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trt_users (id, email, display_name, plan, credits_remaining)
  values (
    new.id,
    coalesce(new.email, 'unknown@tuberadar.app'),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'free',
    25
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trt_on_auth_user_created on auth.users;
create trigger trt_on_auth_user_created
  after insert on auth.users
  for each row execute function public.trt_handle_new_user();

-- Backfill anyone who signed up before this migration ran.
insert into public.trt_users (id, email, display_name, plan, credits_remaining)
select u.id,
       coalesce(u.email, 'unknown@tuberadar.app'),
       coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1)),
       'free',
       25
from auth.users u
on conflict (id) do nothing;
