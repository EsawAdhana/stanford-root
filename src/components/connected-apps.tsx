'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { OAuthGrant } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { StanfordLoginButton } from '@/components/stanford-login-button'
import { useAuthStore } from '@/lib/auth-store'
import { supabase } from '@/lib/supabase'

type Grants = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; grants: OAuthGrant[] }

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Apps the user allowed on the consent page (/oauth/consent), with a way to
 * take that back. Disconnecting revokes the app's grant in Supabase's OAuth
 * server, so it has to ask again before it can act on the account.
 */
export function ConnectedApps() {
  const user = useAuthStore(state => state.user)
  const isAuthLoading = useAuthStore(state => state.isLoading)
  const [state, setState] = useState<Grants>({ kind: 'loading' })
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.oauth.listGrants()
    setState(error || !data ? { kind: 'failed' } : { kind: 'ready', grants: data })
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  async function disconnect(grant: OAuthGrant) {
    setRevoking(grant.client.id)
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: grant.client.id })
    setRevoking(null)
    if (error) {
      toast.error(`Could not disconnect ${grant.client.name}. Try again.`)
      return
    }
    toast.success(`Disconnected ${grant.client.name}`)
    setState(s => (s.kind === 'ready' ? { kind: 'ready', grants: s.grants.filter(g => g.client.id !== grant.client.id) } : s))
  }

  if (isAuthLoading) return <Message body="Loading…" />

  if (!user) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-bold text-foreground mb-2">Connected apps</h1>
        <p className="text-lg text-muted-foreground mb-8">Sign in to see the apps you allowed to use your account.</p>
        <StanfordLoginButton size="lg" className="font-bold" source="header" returnPath="/connected-apps" />
      </div>
    )
  }

  if (state.kind === 'loading') return <Message body="Loading…" />
  if (state.kind === 'failed') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-bold text-foreground mb-2">Connected apps</h1>
        <p className="text-lg text-muted-foreground mb-8">Your connected apps could not be loaded.</p>
        <Button size="lg" className="font-bold" onClick={() => { setState({ kind: 'loading' }); void load() }}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-md w-full">
      <h1 className="text-3xl font-bold text-foreground mb-2">Connected apps</h1>
      {state.grants.length === 0 ? (
        <p className="text-lg text-muted-foreground">No apps are connected to your account.</p>
      ) : (
        <>
          <p className="text-lg text-muted-foreground mb-8">
            These can see and change your saved schedule and read course evaluations, as you.
          </p>
          <ul className="text-left divide-y divide-border border border-border rounded-md">
            {state.grants.map(grant => (
              <li key={grant.client.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{grant.client.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Connected {dateFormat.format(new Date(grant.granted_at))}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoking !== null}
                  onClick={() => void disconnect(grant)}
                >
                  {revoking === grant.client.id ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Message({ body }: { body: string }) {
  return (
    <div className="max-w-md">
      <p className="text-lg text-muted-foreground">{body}</p>
    </div>
  )
}
