-- Keep every overwritten saved schedule so a lost one can be restored.
--
-- user_schedules holds one row per student, and every browser save replaces it
-- whole. On 2026-11-10 a device that had not pulled yet saved an empty cart over
-- a student's 6-course schedule, and there was no earlier copy anywhere: the
-- Supabase Free plan has no backups. From now on, whenever a save changes a row
-- that held at least one course, the database copies the old row here first.
-- scripts/restore-schedule.mjs lists those copies and writes one back.
--
-- No browser can read or write this table. Only the service role (the restore
-- script and the cleanup job) touches it.
--
-- Apply in the Supabase SQL editor. Undo:
--   select cron.unschedule(jobid) from cron.job where jobname = 'user-schedule-history-retention';
--   drop trigger if exists user_schedules_history on public.user_schedules;
--   drop function if exists public.log_user_schedule_history();
--   drop function if exists public.prune_user_schedule_history();
--   drop table if exists public.user_schedule_history;

create table if not exists public.user_schedule_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_at timestamptz not null default now(),
  reason text not null check (reason in ('update', 'delete')),
  schedule jsonb,
  plans jsonb,
  ignored_exam_clashes jsonb
);

create index if not exists user_schedule_history_user_saved_at
  on public.user_schedule_history (user_id, saved_at desc);

-- RLS on with no policies denies every row to anon and authenticated, and the
-- revoke below is the second lock: PostgREST then answers "permission denied".
alter table public.user_schedule_history enable row level security;

revoke all on public.user_schedule_history from anon, authenticated;
grant select, insert, delete on public.user_schedule_history to service_role;

-- Runs after every update or delete of a user_schedules row. It copies the row
-- as it was before the change, but only when that row held at least one course
-- and (for an update) the schedule, plans or ignored exam clashes actually
-- changed. A save that changes nothing but updated_at writes no history.
--
-- SECURITY DEFINER so it can write the history table, which the browser's
-- authenticated role has no access to. It must never make a save fail, so any
-- error while logging is turned into a warning and the save goes through. That
-- also covers deleting an account: the cascade deletes the user_schedules row,
-- the copy cannot reference the deleted auth.users row, and the warning is all
-- that happens (nothing is kept for a deleted account).
create or replace function public.log_user_schedule_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    -- Two steps, not one OR: SQL does not promise to check jsonb_typeof first,
    -- and jsonb_array_length raises an error on anything that is not an array.
    if jsonb_typeof(old.schedule) is distinct from 'array' then
      return null;
    end if;
    if jsonb_array_length(old.schedule) = 0 then
      return null;
    end if;

    if tg_op = 'UPDATE'
       and new.schedule is not distinct from old.schedule
       and new.plans is not distinct from old.plans
       and new.ignored_exam_clashes is not distinct from old.ignored_exam_clashes then
      return null;
    end if;

    insert into public.user_schedule_history
      (user_id, reason, schedule, plans, ignored_exam_clashes)
    values
      (old.user_id, lower(tg_op), old.schedule, old.plans, old.ignored_exam_clashes);
  exception when others then
    raise warning 'user_schedule_history: could not save the previous schedule for %: % (%)',
      old.user_id, sqlerrm, sqlstate;
  end;

  return null;
end;
$$;

-- Supabase grants execute on new public functions to the browser roles. A trigger
-- function cannot be called directly, but there is no reason to expose it.
revoke all on function public.log_user_schedule_history() from public, anon, authenticated;

drop trigger if exists user_schedules_history on public.user_schedules;
create trigger user_schedules_history
  after update or delete on public.user_schedules
  for each row execute function public.log_user_schedule_history();

-- Retention is by age only. Keeping the last N versions instead would fail the
-- case this table exists for: after a wipe the student re-adds classes one at a
-- time, and each of those saves would push the good copy out.
create or replace function public.prune_user_schedule_history()
returns void
language sql
set search_path = public, pg_temp
as $$
  -- RETENTION: how long an overwritten schedule can still be restored (owner decision).
  delete from public.user_schedule_history
  where saved_at < now() - interval '90 days';
$$;

revoke all on function public.prune_user_schedule_history() from public, anon, authenticated;
grant execute on function public.prune_user_schedule_history() to service_role;

-- Daily at 11:41 UTC (3:41 or 4:41 in the morning Pacific), away from the
-- analytics retention job at 10:17 UTC. Unscheduling first makes re-running this
-- file safe. Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'user-schedule-history-retention';
    perform cron.schedule(
      'user-schedule-history-retention',
      '41 11 * * *',
      'select public.prune_user_schedule_history()'
    );
  end if;
end $$;
