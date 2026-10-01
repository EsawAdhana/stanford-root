import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import type { User } from '@supabase/supabase-js'

/** The token in an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i)
  return match ? match[1] : null
}

function stanfordOnly(user: User | null): User | null {
  return user?.email?.endsWith('@stanford.edu') ? user : null
}

/** Verifies the request carries a valid Stanford session. Evaluation data is
 *  Stanford-community-only, so anonymous requests are rejected. */
export async function getStanfordUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null

  // Apps the user connected through Stanford Root's OAuth server (the MCP)
  // send their access token instead of a session cookie. Supabase verifies it
  // the same way, and the Stanford check applies to both. A bad token is a
  // rejection, not a reason to fall back to whatever cookie came along.
  const token = bearerToken((await headers()).get('authorization'))
  if (token) {
    const supabase = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } })
    const { data: { user } } = await supabase.auth.getUser(token)
    return stanfordOnly(user)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Ignored when called from a Route Handler
        }
      }
    }
  })
  const { data: { user } } = await supabase.auth.getUser()
  return stanfordOnly(user)
}
