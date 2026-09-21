'use client'

import React, { Suspense, useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/auth-store'
import { useSyncSchedule } from '@/hooks/use-sync-schedule'
import { showAuthError } from '@/lib/auth-errors'
import { track } from '@/lib/analytics'

/**
 * Initializes the auth session and schedule sync once for the whole app, then
 * always renders children. Unlike the old AuthGate, this never blocks the UI —
 * anonymous users browse and build schedules locally; login only enables
 * cross-device sync.
 *
 * Nothing here may call useSearchParams(): this component wraps every page, and
 * a prerender that hits useSearchParams() bails its nearest Suspense boundary
 * out to client rendering, which would strip the whole page out of the static
 * HTML (crawlers and link previews would see an empty shell). The query-string
 * work lives in AuthQueryEffects below, behind its own boundary that renders
 * null, so only that nothing-shaped subtree bails.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore(state => state.initialize)
  useSyncSchedule()

  useEffect(() => {
    const unsubscribe = initialize()
    return () => {
      unsubscribe()
    }
  }, [initialize])

  return (
    <>
      <Suspense fallback={null}>
        <AuthQueryEffects />
      </Suspense>
      {children}
    </>
  )
}

/** Query-string side effects for auth: surfacing callback errors and catching a
 *  stray ?code= that landed somewhere other than /auth/callback. Renders null. */
function AuthQueryEffects() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const authError = searchParams.get('auth_error')
    if (!authError) return

    const detail = searchParams.get('error_description') ?? undefined
    const failureCode = searchParams.get('auth_error_code') ?? undefined

    // The callback distinguishes its failure modes now; the wording stays as it
    // was, but the reason is recorded so a 1-a-day failure is diagnosable
    // without catching it live in the server logs.
    if (authError === 'stanford_required') {
      showAuthError('stanford_required')
    } else if (authError === 'oauth_failed') {
      showAuthError('oauth_failed', detail)
    } else {
      showAuthError('session_failed', detail)
    }
    track('login_failed', { reason: authError, ...(failureCode ? { code: failureCode } : {}) })

    const params = new URLSearchParams(searchParams.toString())
    params.delete('auth_error')
    params.delete('auth_error_code')
    params.delete('error_description')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [searchParams, router, pathname])

  // Client-side fallback: if ?code= lands on a page other than /auth/callback
  // (e.g. before middleware runs or on cached navigation), forward to callback.
  useEffect(() => {
    if (pathname === '/auth/callback') return
    const code = searchParams.get('code')
    if (!code) return

    const params = new URLSearchParams(searchParams.toString())
    params.delete('code')
    const nextPath = pathname + (params.toString() ? `?${params.toString()}` : '')
    const callback = `/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(nextPath || '/')}`
    router.replace(callback)
  }, [pathname, searchParams, router])

  return null
}
