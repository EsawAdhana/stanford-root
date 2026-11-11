import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { supabase } from './supabase'

/**
 * The finals clashes a student chose to ignore, per term, each by its clash
 * signature (clashSignature in final-exams.ts). Kept on the device, and on the
 * account's user_schedules row so an ignore holds on every device.
 */
export type IgnoredClashes = Record<string, string[]>

const COLUMN = 'ignored_exam_clashes'

/** A stored value as IgnoredClashes, dropping anything malformed. */
export function readIgnoredClashes(value: unknown): IgnoredClashes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const byTerm: IgnoredClashes = {}
  for (const [term, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue
    const signatures = [...new Set(list.filter((s): s is string => typeof s === 'string' && s !== ''))]
    if (signatures.length > 0) byTerm[term] = signatures
  }
  return byTerm
}

/** Both lists together, per term, each signature once. */
export function mergeIgnoredClashes(a: IgnoredClashes, b: IgnoredClashes): IgnoredClashes {
  const byTerm: IgnoredClashes = {}
  for (const term of new Set([...Object.keys(a), ...Object.keys(b)])) {
    byTerm[term] = [...new Set([...(a[term] ?? []), ...(b[term] ?? [])])]
  }
  return byTerm
}

/** Whether `wider` holds every signature in `narrower`. */
function covers(wider: IgnoredClashes, narrower: IgnoredClashes): boolean {
  return Object.entries(narrower).every(([term, list]) => {
    const have = new Set(wider[term] ?? [])
    return list.every(signature => have.has(signature))
  })
}

type IgnoredClashState = {
  byTerm: IgnoredClashes
  /**
   * The account this list was last synced with, or null for ignores made
   * signed out. A list synced with another account is that person's, not work
   * to merge into whoever signs in next.
   */
  owner: string | null
  add: (term: string, signature: string) => void
  replace: (byTerm: IgnoredClashes, owner: string) => void
  clear: () => void
}

export const useIgnoredClashStore = create<IgnoredClashState>()(
  persist(
    set => ({
      byTerm: {},
      owner: null,
      add: (term, signature) => set(s => ({ byTerm: mergeIgnoredClashes(s.byTerm, { [term]: [signature] }) })),
      replace: (byTerm, owner) => set({ byTerm, owner }),
      clear: () => set({ byTerm: {}, owner: null }),
    }),
    {
      name: 'stanford-root:ignored-exam-clashes',
      storage: createJSONStorage(() => localStorage),
      partialize: s => ({ byTerm: s.byTerm, owner: s.owner }),
      merge: (persisted, current) => {
        const saved = persisted as { byTerm?: unknown; owner?: unknown } | undefined
        return {
          ...current,
          byTerm: readIgnoredClashes(saved?.byTerm),
          owner: typeof saved?.owner === 'string' ? saved.owner : null,
        }
      },
    },
  ),
)

/** Conditional writes tried before a sync gives up until the next focus or ignore. */
const MAX_WRITE_ATTEMPTS = 3

/**
 * Brings this device and the account to the same list: reads the account's,
 * adds this device's, and writes the union back when the account was missing
 * any. Nothing is ever removed, so devices that sync in any order end up equal.
 *
 * The write only lands if the column still holds what was read, like the
 * schedule's own save. Another device that ignored a different clash in
 * between makes it miss, and the sync reads again and writes the larger union,
 * so neither device's ignore is overwritten.
 *
 * A failure leaves this device's list as it is for the next sync to carry: no
 * saved row yet (schedule sync creates it), the column not added yet, offline.
 * There is nothing to show the student, since the ignore already holds here.
 */
export async function syncIgnoredClashes(userId: string): Promise<void> {
  if (columnMissing) return
  const startedIn = signedInSession
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.from('user_schedules').select(COLUMN).eq('user_id', userId).maybeSingle()
    // Signed out while the read was out: this account's list must not land on
    // the device, where the next person to sign in would get it.
    if (startedIn !== signedInSession) return
    if (error) {
      // Production before the migration that adds the column (Postgres
      // undefined_column, or PostgREST's schema-cache miss): stop asking for the
      // rest of this page's life instead of failing on every focus.
      if (error.code === '42703' || error.code === 'PGRST204') columnMissing = true
      return
    }
    if (!data) return
    const stored = (data as Record<string, unknown>)[COLUMN] ?? null
    const account = readIgnoredClashes(stored)
    const local = useIgnoredClashStore.getState()
    const mine = local.owner === null || local.owner === userId ? local.byTerm : {}
    const merged = mergeIgnoredClashes(account, mine)
    useIgnoredClashStore.getState().replace(merged, userId)
    if (covers(account, merged)) return

    const update = supabase.from('user_schedules').update({ [COLUMN]: merged }).eq('user_id', userId)
    const conditional = stored === null ? update.is(COLUMN, null) : update.eq(COLUMN, JSON.stringify(stored))
    const { data: written, error: writeError } = await conditional.select('user_id')
    if (writeError || written?.length) return
  }
}
/** Ignores one clash on this device and, when signed in, on the account. */
export async function ignoreExamClash(userId: string | null, term: string, signature: string): Promise<void> {
  useIgnoredClashStore.getState().add(term, signature)
  if (userId) await syncIgnoredClashes(userId)
}

/**
 * Counts sign-outs, so a sync that was already reading the account when its
 * owner signed out drops what it read instead of restoring it.
 */
let signedInSession = 0

/** The account has no ignored_exam_clashes column yet; checked again on the next page load. */
let columnMissing = false

/** On sign-out, so the next person on this device starts with nothing ignored. */
export function clearIgnoredClashes(): void {
  signedInSession++
  useIgnoredClashStore.getState().clear()
}
