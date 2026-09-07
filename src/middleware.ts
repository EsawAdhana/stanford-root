import { NextResponse, type NextRequest } from 'next/server'

/**
 * One job: catch an OAuth code that landed somewhere other than the callback.
 *
 * This used to also call supabase.auth.getUser() on `/` to bounce signed-in
 * users past the marketing landing page. There is no landing page now, `/` is
 * the catalog for everyone, so that Supabase round trip is gone. Route handlers
 * that need auth verify it themselves, and the browser client refreshes its own
 * tokens.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl

  // Supabase sometimes redirects to Site URL root (?code=...) instead of
  // /auth/callback when the requested redirect URL isn't whitelisted.
  if (url.pathname !== '/auth/callback' && url.searchParams.has('code')) {
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
  // fallback above.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
