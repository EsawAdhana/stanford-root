-- Run this in Supabase Dashboard → SQL Editor to create the feedback table.
-- The API inserts { text, type }; anon key needs INSERT.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  type text not null default 'general',
  created_at timestamptz not null default now()
);

-- Allow anonymous inserts (e.g. from your Next.js app with anon key)
alter table public.app_feedback enable row level security;

create policy "Allow anonymous insert"
  on public.app_feedback
  for insert
  to anon
  with check (true);

-- Optional: only service role can read (so users can't list all feedback via API)
create policy "Service role can read all"
  on public.app_feedback
  for select
  to service_role
  using (true);
