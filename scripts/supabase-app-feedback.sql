-- Run this in Supabase SQL Editor to create the app feedback table.
-- Table: app_feedback — for comments, requests, and general feedback.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) <= 2000),
  type text not null default 'general' check (type in ('comment', 'request', 'general')),
  created_at timestamptz not null default now()
);

alter table public.app_feedback enable row level security;

-- Allow anyone to insert (anonymous feedback). Restrict read/update/delete to service role.
create policy "Allow anonymous insert"
  on public.app_feedback
  for insert
  to anon, authenticated
  with check (true);

-- Optional: allow authenticated users to read their own (if we add user_id later).
-- For now, view feedback in Supabase Dashboard > Table Editor.
