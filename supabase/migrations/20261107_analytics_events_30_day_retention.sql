-- Keep 30 days of raw analytics events (product call, 2026-11-07).
--
-- analytics_events was the largest table (169 MB of a 409 MB database, on a
-- Free plan capped at 500 MB) and nothing ever deleted from it: the oldest row
-- was from 2026-06-10. The app only writes to it, through /api/track; nothing
-- the app shows reads it back. Readers are one-off audits and
-- scripts/label-traffic-class.mjs, which now see the last 30 days.
--
-- A pg_cron job deletes rows older than 30 days every day at 10:17 UTC (2:17 AM
-- in California), a few thousand rows a day at current traffic. Autovacuum
-- reuses that space, so the table holds steady at about 30 days of events
-- instead of growing.
--
-- Applied by hand on 2026-11-07 from the SQL editor, with a one-time cleanup
-- that is not a migration:
--   * the 391,747 rows created before 2026-10-09T05:00:36Z were exported to
--     tmp/analytics-backup/analytics_events_before_2026-10-09.jsonl.gz in the
--     main checkout (gzipped JSON lines, every column; count and ids checked
--     against the table), then deleted;
--   * vacuum full public.analytics_events compacted the table from 169 MB to
--     36 MB (104,145 rows left), and the database went from 395 MB to 262 MB.
--
-- Undo: select cron.unschedule('analytics-events-30-day-retention');
-- The deleted rows can be reloaded from the backup file if ever needed.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'analytics-events-30-day-retention',
  '17 10 * * *',
  $$delete from public.analytics_events where created_at < now() - interval '30 days'$$
);
