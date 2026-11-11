-- Look up comment sentiment by a list of hashes sent in the request body.
--
-- src/lib/comment-sentiment.ts used to send the hashes as an `in` filter on a
-- GET, 75 per request because PostgREST puts the list in the URL. A big course
-- (CS 106B, 1,591 comments) took 22 requests, and Supabase logs every URL: on
-- 2026-11-08 these lookups were about 69% of the project's log volume. Through
-- this function the app sends up to 1,000 hashes per POST to
-- /rest/v1/rpc/comment_sentiment_for, so the same course is 2 requests and the
-- hashes never reach a URL. 1,000 is the API's default row cap, which also
-- applies to what a set-returning function hands back.
--
-- Read-only (STABLE, a plain SELECT) and SECURITY INVOKER, so it can return no
-- more than the caller could read from the table itself. Only service_role,
-- which the server uses after its own Stanford check, may call it.
--
-- The app falls back to the old GET lookups while this function does not exist,
-- so the code can ship before this is applied.
--
-- Undo:
--   drop function if exists public.comment_sentiment_for(text[]);

create or replace function public.comment_sentiment_for(hashes text[])
returns table (
  comment_hash      text,
  instructor_praise real,
  instructor_blame  real,
  course_praise     real,
  course_blame      real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.comment_hash, s.instructor_praise, s.instructor_blame, s.course_praise, s.course_blame
  from public.comment_sentiment s
  where s.comment_hash = any (hashes)
$$;

comment on function public.comment_sentiment_for(text[]) is
  'Sentiment scores for the given comment hashes (sha256 of the trimmed text). Read-only; service_role only. Called by src/lib/comment-sentiment.ts.';

-- New functions are executable by PUBLIC by default, and Supabase also grants
-- anon and authenticated directly, so take all three away.
revoke all on function public.comment_sentiment_for(text[]) from public, anon, authenticated;
grant execute on function public.comment_sentiment_for(text[]) to service_role;
