/**
 * What the OAuth callback should do with the params Google sent back.
 *
 * Split out of the route because the route previously collapsed every
 * non-success into one `session_failed` redirect: a user who pressed Cancel at
 * the Google prompt saw "Sign-in failed. Could not complete sign-in." and the
 * logs could not tell a cancel from a broken code exchange.
 */
export type CallbackVerdict =
  /** Google returned an authorization code; exchange it. */
  | { kind: 'exchange'; code: string }
  /** The person backed out at Google. Not a failure; say nothing. */
  | { kind: 'cancelled' }
  /** Google itself refused (consent config, blocked app, bad request). */
  | { kind: 'provider_error'; reason: string; description?: string }
  /** We were called with neither a code nor an error — a stale or hand-made URL. */
  | { kind: 'missing_code' }

export function classifyCallback(params: URLSearchParams): CallbackVerdict {
  const error = params.get('error')
  if (error) {
    // Google sends access_denied both for "user pressed Cancel" and for
    // "user closed the account chooser", which is the same thing to us.
    if (error === 'access_denied') return { kind: 'cancelled' }
    return {
      kind: 'provider_error',
      reason: error,
      description: params.get('error_description') ?? undefined,
    }
  }
  const code = params.get('code')
  if (!code) return { kind: 'missing_code' }
  return { kind: 'exchange', code }
}

/** Where to send the browser for a verdict that isn't an exchange. */
export function authErrorParam(verdict: CallbackVerdict): string | null {
  switch (verdict.kind) {
    case 'cancelled':
      return null
    case 'provider_error':
      return 'oauth_failed'
    case 'missing_code':
      return 'missing_code'
    default:
      return null
  }
}

/** Safe `next` target: a same-origin path, or the catalog at `/`. */
export function safeNextPath(next: string | null): string {
  const raw = next ?? '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}
