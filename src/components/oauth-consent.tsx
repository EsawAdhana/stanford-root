'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StanfordLoginButton } from '@/components/stanford-login-button'
import { useAuthStore } from '@/lib/auth-store'
import { supabase } from '@/lib/supabase'

type ConsentRequest =
  | { kind: 'loading' }
  | { kind: 'ready'; clientName: string; email: string; returnTo: string }
  | { kind: 'redirecting' }
  | { kind: 'failed' }

/**
 * The consent step of Supabase's OAuth server. Supabase owns the codes and
 * tokens; this page only shows the request to a signed-in Stanford user and
 * passes their answer back. Approving or denying returns them to the app's
 * redirect URI, with a code or with `error=access_denied`.
 */
export function OAuthConsent() {
  const authorizationId = useSearchParams().get('authorization_id')
  const user = useAuthStore(state => state.user)
  const isAuthLoading = useAuthStore(state => state.isLoading)
  const [request, setRequest] = useState<ConsentRequest>({ kind: 'loading' })
  const [deciding, setDeciding] = useState(false)
  const fetchedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!authorizationId || !user) return
    if (fetchedFor.current === authorizationId) return
    fetchedFor.current = authorizationId
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (error || !data) {
        setRequest({ kind: 'failed' })
        return
      }
      // Already approved this app once: Supabase hands back the redirect directly.
      if ('redirect_url' in data) {
        setRequest({ kind: 'redirecting' })
        window.location.replace(data.redirect_url)
        return
      }
      setRequest({ kind: 'ready', clientName: data.client.name, email: data.user.email, returnTo: returnLabel(data.redirect_uri) })
    })
  }, [authorizationId, user])

  async function decide(approve: boolean) {
    if (!authorizationId || deciding) return
    setDeciding(true)
    const options = { skipBrowserRedirect: true }
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, options)
      : await supabase.auth.oauth.denyAuthorization(authorizationId, options)
    if (error || !data) {
      setDeciding(false)
      setRequest({ kind: 'failed' })
      return
    }
    setRequest({ kind: 'redirecting' })
    window.location.replace(data.redirect_url)
  }

  if (!authorizationId) {
    return (
      <Message
        title="Nothing to connect"
        body="This link is missing its request. Go back to the app and start connecting again."
        home
      />
    )
  }

  if (isAuthLoading) return <Message body="Loading…" />

  if (!user) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-bold text-foreground mb-2">Sign in to connect</h1>
        <p className="text-lg text-muted-foreground mb-8">
          An app wants to use your Stanford Root account. Sign in to review the request.
        </p>
        <StanfordLoginButton
          size="lg"
          className="font-bold"
          source="oauth_consent"
          returnPath={`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`}
        />
      </div>
    )
  }

  if (request.kind === 'loading') return <Message body="Loading…" />
  if (request.kind === 'redirecting') return <Message body="Returning you to the app…" />
  if (request.kind === 'failed') {
    return (
      <Message
        title="This request has expired"
        body="It may have already been used. Go back to the app and start connecting again."
        home
      />
    )
  }

  return (
    <div className="max-w-md">
      <h1 className="text-3xl font-bold text-foreground mb-2">
        Allow {request.clientName} to use your account?
      </h1>
      <p className="text-lg text-muted-foreground mb-8">
        It will be able to see and change your saved schedule and read course evaluations, as{' '}
        <span className="text-foreground">{request.email}</span>.
      </p>
      <p className="text-sm text-muted-foreground -mt-6 mb-8">
        Allowing returns you to {request.returnTo}. Disconnect it any time from Connected apps.
      </p>
      <div className="flex justify-center gap-3">
        <Button variant="outline" size="lg" disabled={deciding} onClick={() => void decide(false)}>
          Deny
        </Button>
        <Button size="lg" className="font-bold" disabled={deciding} onClick={() => void decide(true)}>
          Allow
        </Button>
      </div>
    </div>
  )
}

/** Where Allow sends the user, so a look-alike app name cannot hide its destination. */
export function returnLabel(redirectUri: string): string {
  try {
    const { hostname } = new URL(redirectUri)
    return hostname === '127.0.0.1' || hostname === 'localhost' ? 'an app on this computer' : hostname
  } catch {
    return 'the app'
  }
}

function Message({ title, body, home }: { title?: string; body: string; home?: boolean }) {
  return (
    <div className="max-w-md">
      {title && <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>}
      <p className="text-lg text-muted-foreground mb-8">{body}</p>
      {home && (
        <Button asChild size="lg" className="font-bold">
          <Link href="/">Return Home</Link>
        </Button>
      )}
    </div>
  )
}
