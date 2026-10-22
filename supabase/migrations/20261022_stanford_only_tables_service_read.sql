-- Close the anon read path on the Stanford-only tables.
--
-- evaluations, course_class_years and comment_sentiment were readable by the anon
-- role (SELECT ... USING (true)), on the theory that the API route in front of
-- them enforced the Stanford login. But the anon key ships in the browser bundle,
-- so anyone could call the Supabase REST API directly and skip the route. The
-- server now reads these tables with the service role, which bypasses RLS, after
-- its own Stanford check (see getServiceClient in src/lib/supabase-admin.ts).
--
-- Deploy the application change before applying this migration: until the
-- service-role reads are live, dropping these policies would make the routes
-- return no rows.

-- The evaluations table's policies were created outside this repo, so drop
-- whatever SELECT policies exist rather than guessing a name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'evaluations' AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.evaluations', r.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "course_class_years anon read" ON public.course_class_years;
DROP POLICY IF EXISTS comment_sentiment_read ON public.comment_sentiment;

-- RLS on with no policy denies every row, but the table privileges are the second
-- lock: without them PostgREST answers 401/403 instead of an empty list.
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_class_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_sentiment ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.evaluations, public.course_class_years, public.comment_sentiment FROM anon, authenticated;

-- The scrapers and the server read and write these as service_role, which keeps
-- its grants and bypasses RLS.
