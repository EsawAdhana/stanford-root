import { NextResponse, type NextRequest } from 'next/server'
import { isBlockedCrawler } from '@/lib/blocked-crawlers'
import { normalizeCourseId } from '@/lib/cross-list.mjs'

/**
 * Top-level paths that are not course or department codes, so they are never
 * uppercased into one. tests/course-code-redirect.test.ts fails if a route
 * folder in src/app or an entry in public/ is missing from this list.
 */
export const RESERVED_ROOT_SEGMENTS = new Set([
  'brand', 'catalog', 'syllabi', 'whats-new', 'icon.png', 'roots.png', '.well-known',
  'about', 'api', 'auth', 'connect', 'connected-apps', 'departments', 'faq',
  'instructors', 'oauth', 'privacy', 's', 'schedule', 'terms', '_next',
  'opengraph-image', 'twitter-image', 'icon', 'apple-icon', 'manifest.webmanifest',
  'robots.txt', 'sitemap.xml', 'favicon.ico',
])

/**
 * Subject letters (and `&`, as in MS&E), an optional `-` or `.` between subject
 * and number, then the number with its letter suffix. Whitespace is dropped
 * before matching, so `CS 106B` and `cs106b` both fit.
 */
const COURSE_CODE_SHAPE = /^([A-Za-z&]+)[.-]?(\d[A-Za-z0-9]*)$/

/** Subject letters alone, as in `/cs` or `/ms&e`: every catalog subject has this shape. */
const DEPARTMENT_SHAPE = /^[A-Za-z&]+$/

/**
 * Where a loosely typed course or department URL belongs, or null when it is
 * already canonical or is not a code at all.
 *
 * `/cs106b`, `/CS%20106B` and `/ms&e232` used to reach the `[code]` page, which
 * answered with a 200 whose body was a meta-refresh redirect and no title, so a
 * pasted link previewed as a bare URL and loaded twice. On a case-insensitive
 * disk that stub could also overwrite the cached `/CS106B` page. Answering here
 * with a real 308 means the page only ever renders canonical ids.
 *
 * The canonical id is `normalizeCourseId`, the same function the page's
 * `resolveCourseIdFromDump` keys the catalog by, and every catalog id is already
 * its own normal form (tests/course-code-redirect.test.ts checks that against
 * the dump), so the target is exactly the URL the page would have redirected to.
 * A code that is not in the catalog lands on its canonical spelling and gets the
 * usual not-found page there.
 *
 * A department is the same idea: the page used to redirect `/cs` to `/CS` when
 * the uppercase form is a subject. The `[code]` route now only serves the codes
 * it prerendered (`dynamicParams = false`), so that redirect has to happen here.
 * Without the subject list at hand, any letters-only segment that is not a
 * reserved route goes to its uppercase form. For a real subject that is the page
 * the page itself would have sent you to; for anything else, `/foo` to `/FOO`,
 * it is the same not-found page one hop later.
 */
export function canonicalCoursePath(pathname: string): string | null {
  const match = /^\/([^/]+)$/.exec(pathname)
  if (!match) return null

  let segment: string
  try {
    segment = decodeURIComponent(match[1])
  } catch {
    return null
  }
  if (RESERVED_ROOT_SEGMENTS.has(segment.toLowerCase())) return null

  if (DEPARTMENT_SHAPE.test(segment)) {
    const upper = segment.toUpperCase()
    return upper === segment ? null : `/${encodeURIComponent(upper)}`
  }

  const shape = COURSE_CODE_SHAPE.exec(segment.replace(/\s+/g, ''))
  if (!shape) return null

  const canonical = normalizeCourseId(shape[1] + shape[2])
  if (canonical === segment) return null
  return `/${encodeURIComponent(canonical)}`
}

/**
 * Two jobs: deny the scrapers in `lib/blocked-crawlers`, and catch an OAuth code
 * that landed somewhere other than the callback.
 *
 * This used to also call supabase.auth.getUser() on `/` to bounce signed-in
 * users past the marketing landing page. There is no landing page now, `/` is
 * the catalog for everyone, so that Supabase round trip is gone. Route handlers
 * that need auth verify it themselves, and the browser client refreshes its own
 * tokens.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl

  // Before anything else, so a blocked crawler never gets HTML and never loads
  // the analytics SDK. This runs on `/api/` too: the catalog walk lands on page
  // routes today, but /api/courses and /api/evaluations serve the same data, and
  // a scraper that gets a 403 on pages is one step from trying them.
  if (isBlockedCrawler(request.headers.get('user-agent'))) {
    return new NextResponse('Forbidden', {
      status: 403,
      headers: { 'cache-control': 'no-store' },
    })
  }

  // Supabase sometimes redirects to Site URL root (?code=...) instead of
  // /auth/callback when the requested redirect URL isn't whitelisted. Page
  // routes only. An API route is free to take a `code` query param of its own,
  // and rewriting that to the OAuth callback would break it.
  if (
    !url.pathname.startsWith('/api/') &&
    url.pathname !== '/auth/callback' &&
    url.searchParams.has('code')
  ) {
    const code = url.searchParams.get('code')!
    const callbackUrl = new URL('/auth/callback', url.origin)
    callbackUrl.searchParams.set('code', code)

    const nextParams = new URLSearchParams(url.searchParams)
    nextParams.delete('code')
    const nextPath =
      url.pathname + (nextParams.toString() ? `?${nextParams.toString()}` : '')
    callbackUrl.searchParams.set('next', nextPath || '/')

    return NextResponse.redirect(callbackUrl)
  }

  const coursePath = canonicalCoursePath(url.pathname)
  if (coursePath) {
    return NextResponse.redirect(new URL(coursePath + url.search, url.origin), 308)
  }

  return NextResponse.next({ request })
}

export const config = {
  // Stays broad so a `?code=` landing on any path still reaches the callback
  // fallback above, and so the crawler block covers the API routes as well.
  //
  // `robots.txt` and `sitemap.xml` stay out on purpose: a blocked crawler
  // should still be able to read the robots.txt that tells it to stop.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
