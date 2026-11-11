import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { authErrorParam, classifyCallback, redirectOriginFor, safeNextPath } from '@/lib/auth-callback'

function getRedirectOrigin(request: Request): string {
  return redirectOriginFor(request.url, request.headers.get('x-forwarded-host'), {
    nodeEnv: process.env.NODE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = getRedirectOrigin(request)
  const safeNext = safeNextPath(searchParams.get('next'))
  const verdict = classifyCallback(searchParams)

  if (verdict.kind !== 'exchange') {
    if (verdict.kind === 'provider_error') {
      console.error('OAuth provider returned an error:', {
        reason: verdict.reason,
        description: verdict.description,
      })
    }
    const param = authErrorParam(verdict)
    // A cancel is not a failure: send them back to browsing, silently.
    return NextResponse.redirect(param ? `${origin}/?auth_error=${param}` : `${origin}${safeNext}`)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(verdict.code)

  if (error) {
    // Log enough to tell the failure modes apart next time: a missing PKCE
    // verifier cookie, a reused code, and an expired code all surfaced as the
    // same "Could not complete sign-in" before this.
    console.error('OAuth code exchange failed:', {
      code: error.code,
      status: error.status,
      name: error.name,
      message: error.message,
      hasCookieHeader: Boolean(request.headers.get('cookie')),
      userAgent: request.headers.get('user-agent'),
    })
    // Two things exchange this code. `createBrowserClient` from @supabase/ssr has
    // detectSessionInUrl on by default, so the browser consumes any `?code=` it lands
    // on, and the client fallback in auth-provider.tsx also forwards that code here.
    // Whichever loses the race gets a spent code -- which is why production showed
    // "Could not complete sign-in" to users who were, in fact, signed in.
    //
    // A failed exchange plus a live session is not a failure worth a toast. Only report
    // one when the user really has no session.
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      console.warn('Code exchange lost the race but the session is live; redirecting clean.', {
        code: error.code,
      })
      return NextResponse.redirect(`${origin}${safeNext}`)
    }

    const reason = error.code ? `&auth_error_code=${encodeURIComponent(error.code)}` : ''
    return NextResponse.redirect(`${origin}/?auth_error=exchange_failed${reason}`)
  }

  return NextResponse.redirect(`${origin}${safeNext}`)
}
