# Codebase bug audit (correctness sweep)

Verified pass over `src/` looking for obvious correctness bugs: race conditions,
double-execution, stuck state, missing cleanup/await, fragile assumptions. Each
item is `path:line — severity — what's wrong / fix`.

Legend: **[FIXED]** done in this pass · **[FLAG]** needs a product/infra decision before touching.

---

## High severity

- **[FIXED]** `src/lib/auth-store.ts:151` (`signOut`) — Signing out **wipes your
  saved server schedule**. `clearCart()` fires the cart subscription in
  `useSyncSchedule` while the user is still authed → `debouncedPush` sees an
  empty cart → immediate `pushSchedule([])` overwrites `user_schedules`.
  Fix: suspend pushes around the local clear and sign out of Supabase first.

- **[FIXED]** `src/hooks/use-sync-schedule.ts:28` — Effect cleanup unsubscribes
  the cart listener but never calls `cancelDebouncedPush()`, so a pending
  debounced push can fire after logout / user switch and write to a stale
  `userId`. Fix: cancel the debounce in cleanup.

- **[FIXED]** `src/middleware.ts:55` — The `/` → `/browse` redirect returns a
  fresh `NextResponse.redirect()` and drops the `Set-Cookie` headers that
  `getUser()` may have written to refresh the session, causing intermittent
  logouts. Fix: copy `supabaseResponse` cookies onto the redirect.

- **[FIXED 2026-10-22]** `src/app/api/evaluations/route.ts` — Route checked for a
  Stanford user, then queried with the **anon** client, and RLS did allow `anon`
  SELECT on `evaluations` (and later `course_class_years` and `comment_sentiment`),
  so anyone with the public anon key could read the tables directly. Reported
  privately by an outside reader of the repo. Fix: the Stanford-gated routes and
  the MCP data layer now read through `getServiceClient()` (service role, server
  only), and `supabase/migrations/20261022_stanford_only_tables_service_read.sql`
  drops the anon/authenticated SELECT policies and grants on those three tables.

- **[FLAG]** `src/app/api/test-lab/simulate-customer/route.ts:32` — `POST` has no
  auth / env guard / rate limit but creates **real Stripe** customers,
  subscriptions, prices and paid invoices. FINDINGS.md calls test-lab "demo
  scaffolding"; if so, gate it behind `NODE_ENV !== 'production'` or an admin
  secret. Confirm intent.

- **[FLAG]** `src/hooks/use-syllabus-validity.ts:49` — Validity check uses
  `fetch(..., { mode: 'no-cors' })`, which resolves opaque for almost any
  reachable URL (including 404s), so nearly every syllabus URL is marked "valid".
  The green check is effectively meaningless. Proper fix needs a same-origin API
  route (or a pattern heuristic) to read real status.

- **[FLAG]** `src/lib/syllabus-store.ts:126` — `fetchSyllabusData` has no
  request-generation / abort guard; a slow response can finish after a newer
  fetch and overwrite fresh `officialVotes`/`submissions` with stale data.

## Medium severity

- **[FIXED]** `src/lib/utils.ts:168` — `AFRICAAM` (African & African American
  Studies, a Humanities & Sciences subject) is in the **engineering** set, so it
  buckets into the wrong school facet. Fix: remove it from the engineering set.

- **[FIXED]** `src/lib/ics-parser.ts:111` — Export escapes `SUMMARY`/`LOCATION`
  (`\;`, `\,`, `\\`, `\n`) but the parser never unescapes, so a location/title
  with a comma round-trips with literal backslashes. Fix: unescape on import.

- **[FIXED]** `src/app/api/evaluations/route.ts:66` — After filtering, `ids` can
  be empty while `courseIds` passed validation; `.in('course_id', [])` can 500.
  Fix: return `{}` early when `ids.length === 0`.

- **[FLAG]** `src/lib/auth-store.ts:55` — `onAuthStateChange` has no `SIGNED_OUT`
  / session-expiry handler, so `_lastPulledUserId` survives; a re-login on the
  same page (without a full reload) skips the server pull. (Explicit `signOut`
  resets it, so only expiry/implicit logout hits this.)

- **[FLAG]** `src/lib/cart-hydration.ts:14` — The 3s hydration timeout resolves
  `cartHydrated` even if Zustand persist hasn't finished, so `pullSchedule` can
  read `items: []` and mis-merge. Verify persist timing before changing.

- **[FLAG]** `src/lib/evaluation-store.ts:129` — A successful retry after a failed
  fetch never clears `errorCourses[id]`, so `hasErrorForCourse` stays true and
  the UI shows a permanent error after data loaded.

- **[FLAG]** `src/lib/syllabus-store.ts:212,245` — Optimistic `voteOnSubmission` /
  `deleteSubmission` map over a captured `subs` instead of current
  `s.submissions[key]`, so interleaved vote+delete can clobber each other.

- **[FLAG]** `src/app/courses/[courseId]/course-page-client.tsx:197` —
  `CourseDetailContent` lacks `key={course.id}`; navigating course→course reuses
  the instance and several effects (term carousel, `selectedUnits`,
  `previewSection`) don't resync on `course.id` change → stale UI.

- **[FLAG]** `src/lib/course-filter.ts:170,152,210` — Under an active term filter,
  courses with no sections in that term pass the units/time/hideUnavailable
  filters (`return true`). Confirm intended semantics before flipping to `false`.

- **[FLAG]** `src/app/auth/callback/route.ts:36` — `safeNext` blocks `//` but not
  backslashes; `/\evil.com` can be treated as off-site by some browsers. Fix:
  reject backslashes / validate against origin.

- **[FLAG]** `src/components/feedback-dialog.tsx:58`,
  `src/components/syllabus-voting.tsx:65` — async submit handlers call `setState`
  after `await` with no unmount guard (state-update-after-unmount).

- **[FLAG]** `src/app/schedule/page.tsx:450` — ICS import trigger isn't disabled
  during parsing, so repeated clicks can run overlapping imports.

## Low severity

- **[FLAG]** `src/app/api/track/route.ts:100` — Supabase `insert()` error is not
  checked; the route returns 204 even when the write was rejected (silent drop).
- **[FLAG]** `src/lib/rate-limit.ts:18,27` — unbounded in-memory map (unique-key
  flooding) and a shared `'unknown'` bucket for IP-less requests.
- **[FLAG]** `src/lib/ics-parser.ts:16` — requires `THHMMSS` with seconds and
  ignores `TZID` / `VALUE=DATE`; foreign feeds and cross-timezone imports break
  (round-trips of our own export are fine since users are in PT).
- **[FLAG]** `src/components/syllabus-voting.tsx:86` — vote buttons aren't
  disabled while a vote is in flight (double-click → duplicate votes).

## Checked, NOT a bug
- `src/lib/search-utils.ts:13` — whitespace-only query returning all courses is
  the same as an empty query; intended behavior, not a bug.
