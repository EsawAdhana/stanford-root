'use client';

import React from 'react';
import { LogOut } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StanfordLoginButton } from '@/components/stanford-login-button';
import { useAuthStore } from '@/lib/auth-store';

/**
 * The header's Log in button, or the signed-in student's avatar with their email
 * and Sign out. The schedule page and a shared schedule both use it.
 */
export function AccountButton() {
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)
  const signOut = useAuthStore(s => s.signOut)

  if (!user) {
    return isLoading ? null : (
      <StanfordLoginButton
        source="header"
        size="default"
        signingInLabel="Signing in…"
        className="rounded-lg h-9 px-4 text-sm font-medium gap-2"
      >
        Log in
      </StanfordLoginButton>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label="Account menu" className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full transition-transform active:scale-95">
          {user.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt=""
              className="h-8 w-8 rounded-full ring-2 ring-border/60 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-3xs font-bold text-primary ring-2 ring-border/60 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all">
              {(user.email || '?')[0].toUpperCase()}
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end" sideOffset={8}>
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/40 mb-1">
          {user.email}
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-sm transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </PopoverContent>
    </Popover>
  )
}
