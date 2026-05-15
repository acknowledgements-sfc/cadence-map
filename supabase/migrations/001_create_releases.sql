-- Migration: Create releases table
-- Run this in your Supabase project:
-- Dashboard → SQL Editor → paste and run

create table if not exists public.releases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  title         text not null,
  artist        text,
  release_type  text not null default 'Album',
  release_date  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Row Level Security: users can only see/edit their own releases
alter table public.releases enable row level security;

create policy "Users can read own releases"
  on public.releases for select
  using (auth.uid() = user_id);

create policy "Users can insert own releases"
  on public.releases for insert
  with check (auth.uid() = user_id);

create policy "Users can update own releases"
  on public.releases for update
  using (auth.uid() = user_id);

create policy "Users can delete own releases"
  on public.releases for delete
  using (auth.uid() = user_id);

-- Auto-update updated_at on row changes
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger releases_updated_at
  before update on public.releases
  for each row execute function public.handle_updated_at();
