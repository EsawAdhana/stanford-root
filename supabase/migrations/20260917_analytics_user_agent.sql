-- Record the user agent on first-party analytics events.
--
-- The Sep 2026 traffic audit could not tell a crawler from a student inside
-- `analytics_events` at all: the table stores no user agent and no IP, so the
-- bot share of sessions had to be inferred from behaviour (single pageview, one
-- path, thousands of distinct course codes hit exactly once) and cross-checked
-- against Vercel's request log. That gave a range, 55-74% of sessions, where an
-- exact number was wanted.
--
-- With the user agent on the row, the same question is a WHERE clause. Bot
-- events are now rejected by /api/track before they are ever inserted, so this
-- column exists to audit what did get counted, not to filter it after the fact.
alter table public.analytics_events
  add column if not exists user_agent text;

comment on column public.analytics_events.user_agent is
  'Client user agent, truncated to 256 chars. Events from known bots are dropped in /api/track and never reach this table; this column is for auditing the events that were counted.';
