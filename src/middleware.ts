import { NextResponse, type NextRequest } from 'next/server'
import { isBlockedCrawler } from '@/lib/blocked-crawlers'

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
