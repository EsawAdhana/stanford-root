-- Label every analytics event as human, bot, or uncertain.
--
-- Why a label and not a delete: the Sep 2026 audit found that 20,383 of the
-- 43,307 all-time visitor ids in this table were crawlers, so every session and
-- unique-visitor figure ever read off it was roughly 2x high. Deleting those
-- rows would make the numbers right and the history unauditable, and it cannot
-- be undone if the classifier turns out to be wrong. A label is reversible.
--
-- Why three values and not a boolean: the bot share of *events* is measurably a
-- range, not a point. Classifying by behaviour gives 4.2%, and Vercel's own
-- request log gives 8.7% over the same window. The gap is two populations that
-- are provably mixtures rather than one thing:
--
--   * single-pageview visits on a course page that real students also open
--   * two pageviews milliseconds apart, which is this app's own cross-list
--     routing firing twice for one visit (/EDUC30N -> /CSRE30N)
--
-- Fitting those against the demand curve of provably-human sessions put them at
-- roughly 46% real. Collapsing a known 46/54 mixture into a boolean would bake
-- in an error of known size and direction, so they are 'uncertain' and the
-- reader picks:
--
--   strict real   traffic_class = 'human'
--   wide real     traffic_class in ('human', 'uncertain')
--
-- Those two bracket the truth. Any number quoted from this table should say
-- which one it used.
--
-- Going forward the ambiguity disappears: /api/track refuses known bots before
-- inserting, so new rows are genuinely 'human' and that is the column default.
-- The backfill for existing rows is scripts/label-traffic-class.mjs, which is
-- re-runnable and prints its distribution before writing anything.

alter table public.analytics_events
  add column if not exists traffic_class text not null default 'human';

alter table public.analytics_events
  drop constraint if exists analytics_events_traffic_class_check;

alter table public.analytics_events
  add constraint analytics_events_traffic_class_check
  check (traffic_class in ('human', 'bot', 'uncertain'));

-- Composite rather than a plain index on traffic_class: every real query is
-- "the human events in this date range", and a lone low-cardinality column
-- would not be used for it.
create index if not exists analytics_events_traffic_class_created_at_idx
  on public.analytics_events (traffic_class, created_at desc);

comment on column public.analytics_events.traffic_class is
  'human | bot | uncertain. Set by scripts/label-traffic-class.mjs for rows predating the /api/track bot filter; new rows default to human because bot events are now dropped before insert. Filter traffic_class = ''human'' for a strict count, or in (''human'',''uncertain'') for a wide one.';
