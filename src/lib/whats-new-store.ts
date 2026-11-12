import { create } from 'zustand'

/**
 * Open state and "seen" flag for the what's-new card, shared between the card
 * (loaded late, in DeferredShell) and the header's New button, which opens it.
 * Kept out of the card's module so the header does not pull the card's code in.
 *
 * Bump SEEN_KEY for the next announcement; the old key is simply ignored, so
 * the header's dot comes back for everyone.
 */
export const SEEN_KEY = 'whats-new-seen:2026-11-schedule'

export function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null
  } catch {
    // Storage blocked (private mode): treat it as seen, so nothing nags about
    // a card whose dismissal could not be remembered.
    return true
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString())
  } catch {
    // Nothing to do; the dot goes away for this page load either way.
  }
}

type WhatsNewState = {
  open: boolean
  /** Whether this browser has opened the card. Null until storage is read, so the dot waits instead of flashing. */
  seen: boolean | null
  /** Read the flag from storage; call once on the client. */
  load: () => void
  /** Open the card on its first slide and remember it was seen. */
  show: () => void
  setOpen: (open: boolean) => void
}

export const useWhatsNewStore = create<WhatsNewState>(set => ({
  open: false,
  seen: null,
  load: () => set({ seen: readSeen() }),
  show: () => {
    writeSeen()
    set({ open: true, seen: true })
  },
  setOpen: open => set({ open }),
}))
