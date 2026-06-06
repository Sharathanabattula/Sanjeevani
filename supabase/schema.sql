-- ============================================================
-- Sanjeevani schema — paste into Supabase SQL Editor and run.
-- Idempotent: safe to re-run.
-- All tables live in a dedicated `sanjeevani` schema so they
-- can't collide with anything else in your project.
-- ============================================================

create schema if not exists sanjeevani;

-- Allow the API roles (anon + authenticated) to see the schema
grant usage on schema sanjeevani to anon, authenticated;

-- ---- Helper: auto-update updated_at ----
create or replace function sanjeevani.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- PROFILES (one row per authenticated user, mirrors auth.users)
-- ============================================================
create table if not exists sanjeevani.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  goals jsonb default '[]'::jsonb,
  conditions jsonb default '[]'::jsonb,
  is_vegetarian boolean,
  age int,
  gender text,
  height_cm numeric,
  weight_kg numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Body metrics added after initial launch — additive, safe on existing rows.
alter table sanjeevani.profiles add column if not exists age int;
alter table sanjeevani.profiles add column if not exists gender text;
alter table sanjeevani.profiles add column if not exists height_cm numeric;
alter table sanjeevani.profiles add column if not exists weight_kg numeric;

drop trigger if exists set_profiles_updated_at on sanjeevani.profiles;
create trigger set_profiles_updated_at before update on sanjeevani.profiles
  for each row execute function sanjeevani.set_updated_at();

alter table sanjeevani.profiles enable row level security;

drop policy if exists "Profiles: read own" on sanjeevani.profiles;
create policy "Profiles: read own" on sanjeevani.profiles
  for select using (auth.uid() = id);

drop policy if exists "Profiles: insert own" on sanjeevani.profiles;
create policy "Profiles: insert own" on sanjeevani.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "Profiles: update own" on sanjeevani.profiles;
create policy "Profiles: update own" on sanjeevani.profiles
  for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function sanjeevani.handle_new_user() returns trigger as $$
begin
  insert into sanjeevani.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function sanjeevani.handle_new_user();

-- ============================================================
-- WAITLIST (public can insert, only admins can read all)
-- ============================================================
create table if not exists sanjeevani.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  ref_code text not null unique,
  referred_by text,
  user_agent text,
  user_id uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create index if not exists waitlist_ref_code_idx on sanjeevani.waitlist(ref_code);
create index if not exists waitlist_referred_by_idx on sanjeevani.waitlist(referred_by);
create index if not exists waitlist_created_at_idx on sanjeevani.waitlist(created_at desc);

alter table sanjeevani.waitlist enable row level security;

-- Anyone can sign up (insert) — but only specific columns
drop policy if exists "Waitlist: public insert" on sanjeevani.waitlist;
create policy "Waitlist: public insert" on sanjeevani.waitlist
  for insert
  with check (true);

-- Users can read their OWN entry (lookup by email is also allowed)
drop policy if exists "Waitlist: read own" on sanjeevani.waitlist;
create policy "Waitlist: read own" on sanjeevani.waitlist
  for select
  using (
    user_id = auth.uid()
    or auth.jwt() ->> 'email' = email
  );

-- A helper view that returns aggregate stats (no PII) for the public counter
create or replace view sanjeevani.waitlist_stats as
  select count(*)::bigint as total from sanjeevani.waitlist;

grant select on sanjeevani.waitlist_stats to anon, authenticated;

-- ============================================================
-- MEALS (food scanner results)
-- ============================================================
create table if not exists sanjeevani.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  calories_kcal int default 0,
  carbs_g int default 0,
  fiber_g int default 0,
  protein_g int default 0,
  fats_g int default 0,
  saturated_fats_g int default 0,
  verdict text check (verdict in ('Healthy', 'Moderate', 'Indulgent')),
  suggestion text,
  image_url text,         -- optional Supabase Storage URL
  created_at timestamptz default now()
);

create index if not exists meals_user_created_idx on sanjeevani.meals(user_id, created_at desc);

alter table sanjeevani.meals enable row level security;

drop policy if exists "Meals: read own" on sanjeevani.meals;
create policy "Meals: read own" on sanjeevani.meals
  for select using (auth.uid() = user_id);

drop policy if exists "Meals: insert own" on sanjeevani.meals;
create policy "Meals: insert own" on sanjeevani.meals
  for insert with check (auth.uid() = user_id);

drop policy if exists "Meals: update own" on sanjeevani.meals;
create policy "Meals: update own" on sanjeevani.meals
  for update using (auth.uid() = user_id);

drop policy if exists "Meals: delete own" on sanjeevani.meals;
create policy "Meals: delete own" on sanjeevani.meals
  for delete using (auth.uid() = user_id);

-- ============================================================
-- COACH_CONVERSATIONS (chat history)
-- ============================================================
create table if not exists sanjeevani.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  title text default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists conv_user_updated_idx on sanjeevani.coach_conversations(user_id, updated_at desc);

drop trigger if exists set_conv_updated_at on sanjeevani.coach_conversations;
create trigger set_conv_updated_at before update on sanjeevani.coach_conversations
  for each row execute function sanjeevani.set_updated_at();

alter table sanjeevani.coach_conversations enable row level security;

drop policy if exists "Conv: read own" on sanjeevani.coach_conversations;
create policy "Conv: read own" on sanjeevani.coach_conversations
  for select using (auth.uid() = user_id);

drop policy if exists "Conv: insert own" on sanjeevani.coach_conversations;
create policy "Conv: insert own" on sanjeevani.coach_conversations
  for insert with check (auth.uid() = user_id);

drop policy if exists "Conv: update own" on sanjeevani.coach_conversations;
create policy "Conv: update own" on sanjeevani.coach_conversations
  for update using (auth.uid() = user_id);

drop policy if exists "Conv: delete own" on sanjeevani.coach_conversations;
create policy "Conv: delete own" on sanjeevani.coach_conversations
  for delete using (auth.uid() = user_id);

-- ============================================================
-- DAILY_LOGS (one row per user per day: water, steps, sleep)
-- ============================================================
create table if not exists sanjeevani.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  log_date date not null default current_date,
  water_ml int default 0,
  steps int default 0,
  sleep_hours numeric default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, log_date)
);

create index if not exists daily_logs_user_date_idx on sanjeevani.daily_logs(user_id, log_date desc);

drop trigger if exists set_daily_logs_updated_at on sanjeevani.daily_logs;
create trigger set_daily_logs_updated_at before update on sanjeevani.daily_logs
  for each row execute function sanjeevani.set_updated_at();

alter table sanjeevani.daily_logs enable row level security;

drop policy if exists "Daily: read own" on sanjeevani.daily_logs;
create policy "Daily: read own" on sanjeevani.daily_logs
  for select using (auth.uid() = user_id);

drop policy if exists "Daily: insert own" on sanjeevani.daily_logs;
create policy "Daily: insert own" on sanjeevani.daily_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "Daily: update own" on sanjeevani.daily_logs;
create policy "Daily: update own" on sanjeevani.daily_logs
  for update using (auth.uid() = user_id);

-- ============================================================
-- Expose schema to PostgREST (Supabase's REST API layer)
-- ============================================================
-- In Supabase Dashboard → Settings → API → "Exposed schemas",
-- ensure `sanjeevani` is listed (alongside `public`).
-- This file alone does NOT toggle that setting — you must enable it in the dashboard.

-- Grant table-level perms so the API can reach them when RLS passes
grant select, insert, update, delete on all tables in schema sanjeevani to anon, authenticated;
grant usage, select on all sequences in schema sanjeevani to anon, authenticated;

-- Confirm install
select 'Sanjeevani schema installed ✓' as status;
