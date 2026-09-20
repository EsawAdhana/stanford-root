-- Sentiment scores for evaluation comments, keyed by the comment text itself.
--
-- `evaluations.comments` is a JSONB array, and the same string recurs across
-- rows: of 289,766 comment instances only 145,500 are distinct ("Take it!"
-- alone appears 736 times). Keying on a hash of the text rather than on
-- (course_id, term, index) means each distinct string is scored once and every
-- row that carries it reads the same answer.
--
-- Four raw scores, no label. Jev is asked four independent yes/no questions --
-- praise and criticism, for the instructor and for the course -- and this table
-- stores the probabilities it returns. Bucketing happens in the query.
--
-- That split is not decoration. On a 1,000-comment sample the instructor and
-- the course got a different verdict 52.9% of the time, and an outright
-- opposite one 3.2% ("Good class - difficult to figure out what to study for"),
-- so a single blended number would print the wrong sign on an instructor page.
--
-- Storing scores instead of a label keeps every product call reversible in a
-- WHERE clause -- the app cuts both praise and blame at 0.6, and moving that
-- line is a query change, not a re-run: where the line sits, whether
-- high-on-both is
-- surfaced as "mixed", whether low-on-both is hidden as advice. Jev is
-- well calibrated at the ends and not in the middle, so that line is a
-- read-time decision and changing your mind should not cost a re-run.
--
-- Validated against `courses.quality`, which is computed from Likert medians
-- and which Jev never sees: bucketing these scores orders course quality
-- monotonically (positive 4.35 > mixed 4.24 > advice 4.17 > negative
-- 4.09, a 0.93 SD spread), and per-course mean lean correlates with quality at
-- r = 0.71 over courses with 5+ comments.

create table if not exists public.comment_sentiment (
  comment_hash      text primary key,
  instructor_praise real not null check (instructor_praise between 0 and 1),
  instructor_blame  real not null check (instructor_blame  between 0 and 1),
  course_praise     real not null check (course_praise     between 0 and 1),
  course_blame      real not null check (course_blame      between 0 and 1),
  model             text        not null,
  scored_at         timestamptz not null default now()
);

-- The overwhelmingly common read is "find the critical comments": everything
-- else is praise or advice, and 70% of the corpus is praise.
create index if not exists comment_sentiment_blame_idx
  on public.comment_sentiment (course_blame desc, instructor_blame desc);

comment on table public.comment_sentiment is
  'Jev sentiment scores per distinct evaluation comment string, keyed by sha256 of the trimmed text. Four raw probabilities; bucket at read time.';

comment on column public.comment_sentiment.comment_hash is
  'sha256 hex of the trimmed comment text, as written by scripts/label-comment-sentiment.mjs.';

comment on column public.comment_sentiment.instructor_praise is
  'P(comment praises the instructor or teaching staff). Low on both praise and blame means the comment is silent on the instructor, not neutral about them.';

comment on column public.comment_sentiment.course_blame is
  'P(comment criticises the course itself -- structure, workload, exams, material).';

comment on column public.comment_sentiment.model is
  'Resolved model string Jev returned (e.g. jev-1.13.0), not the alias that was requested.';

alter table public.comment_sentiment enable row level security;

create policy comment_sentiment_read
  on public.comment_sentiment for select
  using (true);
