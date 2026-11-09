-- Plan A / Plan B: several schedules for one term.
--
-- `schedule` keeps meaning what it always has, the schedule on screen: for a
-- term with plans, its active plan. This column holds only the plans that are
-- not on screen, as { "<term>": { "order": ["A","B"], "active": "B",
-- "parked": { "A": [<schedule entries>] } } }. Keeping the active plan in
-- `schedule` is what lets every existing reader stay unchanged: the MCP, the
-- connected-app routes, and a tab still running the previous release all see
-- the plan the student has open, and an upsert that names only `schedule`
-- leaves this column alone.
--
-- Null for every row until its owner makes a second plan, so the 1,300-odd
-- existing schedules need no backfill: each one already is its own Plan A.
--
-- No new grant: this adds a column to a table that already has table-level
-- privileges, which cover new columns, and the row-level policies on
-- user_schedules apply to the whole row.
--
-- The app reads `select('*')` and writes the column only for rows that have
-- or had plans, so deploying before this runs costs plans their sync (they
-- stay on the device) and nothing else. Undo: drop the column.

alter table public.user_schedules add column if not exists plans jsonb;

comment on column public.user_schedules.plans is
  'Plans not on screen, per term: order, active, and parked entries by label. The active plan is in schedule.';

-- Applied to production 2026-11-07 from the SQL editor. Checked after: plans is
-- jsonb and nullable; anon, authenticated and service_role hold select, insert
-- and update on it through the table grants; RLS stays on; 0 of 1,365 rows have
-- plans; PostgREST returns the column.
