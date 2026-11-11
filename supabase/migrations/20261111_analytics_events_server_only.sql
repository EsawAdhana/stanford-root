-- Only the server writes analytics events.
--
-- /api/track used to insert with the public (anon) key, so this table carried
-- an INSERT policy for anon and authenticated with "with check (true)". Since
-- that key ships in every page, anyone could post rows to Supabase directly and
-- skip the route's rate limit, size cap and event list. From commit d790e9ff the
-- route writes with the service key, which bypasses row-level security, so the
-- policy and the browser roles' privileges are no longer needed.
--
-- Applied to production by hand on 2026-11-11 from the SQL editor.
--
-- Undo:
--   grant insert on public.analytics_events to anon, authenticated;
--   create policy "app inserts events" on public.analytics_events
--     for insert to anon, authenticated with check (true);

drop policy if exists "app inserts events" on public.analytics_events;
revoke all on public.analytics_events from anon, authenticated;
