-- The Free-plan database was at 0.495 of its 0.5 GB quota, and Supabase puts a
-- Free project into read-only mode past that, which would stop sign-ins and
-- schedule saves. These two indexes were the cheapest space to give back:
--
--   analytics_events_traffic_class_created_at_idx  23 MB, 14 scans since 20260917.
--     Nothing in the app filters analytics by traffic_class; only one-off audits do.
--   comment_sentiment_blame_idx                     6 MB, 2 scans since 20260920.
--     The app looks sentiment up by comment_hash (the primary key) and applies the
--     0.6 cutoff in code, so this index never serves it.
--
-- Recreate either from its original migration if a query starts needing it.
--
-- Applied by hand on 2026-10-02 alongside a data cleanup that is not a migration:
-- 264,133 duplicate login_completed rows from before a22d04d (the multi-tab
-- listener bug) were deleted, keeping the first per session per day, then
-- analytics_events was compacted with vacuum full. Database size went from
-- 458 MB to 321 MB.

drop index if exists public.analytics_events_traffic_class_created_at_idx;
drop index if exists public.comment_sentiment_blame_idx;
