-- Finals clashes a student chose to ignore, so Ignore holds on every device.
--
-- { "<term>": ["<clash signature>", ...] }, each signature from clashSignature()
-- in src/lib/final-exams.ts, like "2026-12-07@1140:CS145+CS329X". The app only
-- ever adds to it (src/lib/ignored-clashes.ts merges a device's list with this
-- one and writes the union back), so devices that sync in any order agree.
--
-- Null for every row until its owner ignores a clash, so existing rows need no
-- backfill. No new grant: this adds a column to a table that already has
-- table-level privileges, which cover new columns, and the row-level policies
-- on user_schedules apply to the whole row.
--
-- The app reads and writes this column on its own requests, so a deploy before
-- this runs only keeps ignores on the device. Undo: drop the column.

alter table public.user_schedules add column if not exists ignored_exam_clashes jsonb;

comment on column public.user_schedules.ignored_exam_clashes is
  'Finals clashes the student ignored, per term, by clash signature. Only ever added to.';

-- Applied to production 2026-11-10 from the SQL editor. Checked after: the
-- column is jsonb and nullable with the comment above; anon, authenticated and
-- service_role hold select, insert and update on it through the table grants;
-- RLS stays on; 0 of 1,388 rows have a value; PostgREST returns the column,
-- and the anon key still reads no rows.
