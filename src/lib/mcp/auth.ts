import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { AuthInfo } from '@modelcontextprotocol/server'

/**
 * Bearer tokens come from Stanford Root's Supabase OAuth server: Claude (or any
 * MCP client) registers, the user approves on /oauth/consent, and the client
 * sends the access token here. Supabase Auth verifies it, which also catches a
 * session revoked from Connected apps. Verified tokens are remembered briefly
 * so a burst of tool calls is one check, not one per call.
 */
const VERIFIED_FOR_MS = 60_000
const verified = new Map<string, { info: AuthInfo; at: number }>()

export const AUTH_SERVER = () => `${(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1`

function claims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

export async function verifyToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined
  const key = createHash('sha256').update(bearer).digest('hex')
  const hit = verified.get(key)
  if (hit && Date.now() - hit.at < VERIFIED_FOR_MS) return hit.info
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await supabase.auth.getUser(bearer)
  if (!user) {
    verified.delete(key)
    return undefined
  }
  const c = claims(bearer)
  const info: AuthInfo = {
    token: bearer,
    clientId: typeof c.client_id === 'string' ? c.client_id : 'stanford-root',
    scopes: typeof c.scope === 'string' ? c.scope.split(' ').filter(Boolean) : [],
    expiresAt: typeof c.exp === 'number' ? c.exp : undefined,
    extra: { userId: user.id, email: user.email ?? '' },
  }
  if (verified.size > 5000) verified.clear()
  verified.set(key, { info, at: Date.now() })
  return info
}
