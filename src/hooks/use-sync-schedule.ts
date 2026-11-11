'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { useCartStore } from '@/lib/cart-store'
import { debouncedPush, flushPendingPush, hydrateLocalCart, cancelDebouncedPush, pullSchedule } from '@/lib/schedule-sync'
import { syncIgnoredClashes } from '@/lib/ignored-clashes'

export function useSyncSchedule() {
  const user = useAuthStore(state => state.user)

  useEffect(() => {
    hydrateLocalCart()
  }, [])

  useEffect(() => {
    if (!user?.id) return

    const id = user.id
    const unsub = useCartStore.subscribe(() => debouncedPush(id))
    // Ignored finals clashes ride the same moments as the schedule: signing in
    // and coming back to the tab. Their own small request, so the schedule's
    // read and write paths stay as they are.
    void syncIgnoredClashes(id)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingPush(id)
        return
      }
      // Coming back to a tab or phone that has been sitting on a schedule the
      // user has since changed elsewhere. Nothing pushes updates between
      // devices, so without this re-read the stale list survives until reload.
      void pullSchedule(id, { force: true })
      void syncIgnoredClashes(id)
    }
    // A tab left on screen beside another app never goes hidden, so the re-read
    // above never runs, and the next edit here would push a list missing what
    // that app saved (the Stanford Root MCP writes the same row). Clicking back
    // into the window is the moment before any such edit.
    const handleFocus = () => {
      void pullSchedule(id, { force: true })
      void syncIgnoredClashes(id)
    }
    const handleBeforeUnload = () => flushPendingPush(id)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      unsub()
      cancelDebouncedPush()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [user?.id])
}
