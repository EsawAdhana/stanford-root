import { supabase } from './supabase'
import { useCartStore } from './cart-store'
import { useCourseStore } from './store'
import { cartHydrated } from './cart-hydration'
import { trackOnce } from './analytics'
import { useUnresolvedSchedule } from './unresolved-schedule'
import { dedupeCrossListedItems } from './schedule-utils'

// Minimal payload stored server-side — no full Course catalog data
export type ScheduleItem = {
  id: string
  selectedTerm?: string
  selectedSectionIds?: number[]
  /** Rows written before multi-section support stored a single section. */
  selectedSectionId?: number
  selectedUnits?: number
  color?: string
  optionalMeetings?: string[]
}

function readSectionIds(item: ScheduleItem): number[] | undefined {
  if (item.selectedSectionIds?.length) return item.selectedSectionIds
  return item.selectedSectionId !== undefined ? [item.selectedSectionId] : undefined
}

function toScheduleItems(): ScheduleItem[] {
  const items: ScheduleItem[] = useCartStore.getState().items.map(item => ({
    id: item.id,
    selectedTerm: item.selectedTerm,
    selectedSectionIds: item.selectedSectionIds,
    selectedUnits: item.selectedUnits,
    color: item.color,
    optionalMeetings: item.optionalMeetings,
  }))
  // Saved entries the catalog cannot resolve are not in the cart, so they would
  // be dropped from this payload and erased server-side. Carry them through.
  const inCart = new Set(items.map(i => i.id))
  for (const unresolved of unresolvedPayload) {
    if (!inCart.has(unresolved.id)) items.push(unresolved)
  }
  return items
}

/**
 * The raw saved entries hydration could not match to a catalog course. Kept
 * verbatim so a course that returns to the catalog rehydrates untouched.
 */
let unresolvedPayload: ScheduleItem[] = []

function recordUnresolved(scheduleItems: ScheduleItem[], resolvedIds: Set<string>) {
  unresolvedPayload = scheduleItems.filter(item => !resolvedIds.has(item.id))
  useUnresolvedSchedule.getState().set(
    unresolvedPayload.map(item => ({ id: item.id, selectedTerm: item.selectedTerm }))
  )
}

/** Waits for the course catalog to be loaded, then resolves. Resolves after a
 * timeout regardless, so callers can't hang if `hasLoaded` never flips. */
function waitForCourses(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve) => {
    if (useCourseStore.getState().hasLoaded) {
      resolve()
      return
    }
    // Nothing else may have started the catalog load — a signed-in user sitting
    // on the landing page has no catalog screen mounted — and sync needs it to
    // re-attach Course objects to the saved schedule.
    void useCourseStore.getState().fetchCourses()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    const unsub = useCourseStore.subscribe((state) => {
      if (state.hasLoaded) finish()
    })
  })
}

/**
 * Re-attaches full Course objects from catalog. Course IDs the catalog does not
 * know stay out of the cart — nothing downstream can render a course it has no
 * data for — but they are recorded so the push payload keeps them and the
 * schedule page can say what happened to them.
 */
function hydrateItems(scheduleItems: ScheduleItem[], logPrefix = '') {
  const courses = useCourseStore.getState().courses
  const courseMap = new Map(courses.map(c => [c.id, c]))
  const result = scheduleItems.flatMap(item => {
    const course = courseMap.get(item.id)
    if (!course) return []
    return [{
      ...course,
      selectedTerm: item.selectedTerm,
      selectedSectionIds: readSectionIds(item),
      selectedUnits: item.selectedUnits,
      color: item.color,
      optionalMeetings: item.optionalMeetings,
    }]
  })
  recordUnresolved(scheduleItems, new Set(result.map(item => item.id)))
  if (process.env.NODE_ENV === 'development' && result.length < scheduleItems.length) {
    const dropped = scheduleItems.filter(s => !courseMap.has(s.id)).map(s => s.id)
    console.warn(
      `${logPrefix} hydrateItems dropped ${dropped.length} course(s) not in catalog:`,
      dropped,
      '| Catalog has',
      courses.length,
      'courses'
    )
  }
  return dedupeCrossListedItems(result, courses)
}

/**
 * After hydrating cart items with Phase 1 (light) course data, subscribes to
 * re-hydrate those items when Phase 2 enrichment completes so section/time
 * data is correct. Only touches courses from the original sync — preserves
 * any items the user added after the initial sync.
 */
function reHydrateOnEnrichment(syncedIds: Set<string>) {
  if (useCourseStore.getState().hasEnriched) return
  const timer = setTimeout(() => { unsub() }, 60000)
  const unsub = useCourseStore.subscribe((state) => {
    if (!state.hasEnriched) return
    clearTimeout(timer)
    unsub()
    const courseMap = new Map(state.courses.map(c => [c.id, c]))
    useCartStore.setState((cartState) => ({
      items: cartState.items.map(item => {
        if (!syncedIds.has(item.id)) return item
        const enriched = courseMap.get(item.id)
        if (!enriched) return item
        return { ...enriched, selectedTerm: item.selectedTerm, selectedSectionIds: item.selectedSectionIds, selectedUnits: item.selectedUnits, color: item.color, optionalMeetings: item.optionalMeetings }
      })
    }))
  })
}

let _localHydrated = false

/**
 * Re-attaches full Course data from the catalog to the locally-persisted
 * (metadata-only) cart. Runs once on app load so a reload doesn't show
 * title-less / meeting-less cart items before the server pull resolves.
 * Reads cart state fresh after awaiting so it never clobbers a server pull.
 */
export async function hydrateLocalCart(): Promise<void> {
  if (_localHydrated) return
  _localHydrated = true
  await cartHydrated
  if (useCartStore.getState().items.length === 0) return
  await waitForCourses()
  const courseMap = new Map(useCourseStore.getState().courses.map(c => [c.id, c]))
  const items = useCartStore.getState().items
  useCartStore.setState({
    items: items.map(item => {
      const course = courseMap.get(item.id)
      if (!course) return item
      return {
        ...course,
        selectedTerm: item.selectedTerm,
        selectedSectionIds: item.selectedSectionIds,
        selectedUnits: item.selectedUnits,
        color: item.color,
        optionalMeetings: item.optionalMeetings,
      }
    }),
  })
  reHydrateOnEnrichment(new Set(items.map(i => i.id)))
}

/**
 * Upserts current cart to Supabase as plaintext JSONB.
 * Errors are swallowed — local state remains visible to user.
 */
async function pushSchedule(userId: string): Promise<void> {
  try {
    const schedule = toScheduleItems()
    const signature = cartSignature()
    const { error } = await supabase
      .from('user_schedules')
      .upsert({ user_id: userId, schedule }, { onConflict: 'user_id' })
    if (error) {
      console.error('Failed to push schedule:', error)
    } else {
      _lastSyncedSignature = signature
    }
  } catch (err) {
    console.error('pushSchedule error:', err)
  }
}

/**
 * Records that this device has completed a pull for a given user, surviving
 * reloads. It is what separates "my local cart is a stale cache" from "my local
 * cart is a schedule I built before signing in" — two states that are otherwise
 * identical, which is why a removal made on another device used to be unioned
 * straight back in on the next pull.
 */
const SYNCED_DEVICE_KEY = 'navigator-schedule-synced-user'

function readSyncedDevice(): string | null {
  try {
    return globalThis.localStorage?.getItem(SYNCED_DEVICE_KEY) ?? null
  } catch {
    return null
  }
}

function markSyncedDevice(userId: string) {
  try {
    globalThis.localStorage?.setItem(SYNCED_DEVICE_KEY, userId)
  } catch {
    // Private mode / storage disabled. Losing the marker only costs us a merge
    // on the next load, which is the old, safe-but-resurrecting behaviour.
  }
}

function clearSyncedDevice() {
  try {
    globalThis.localStorage?.removeItem(SYNCED_DEVICE_KEY)
  } catch {
    // ignore
  }
}

let pullInFlight: Promise<void> | null = null
let _pullActive = false
let _lastPulledUserId: string | null = null

/**
 * On sign-in: fetch server schedule. If the local cart is non-empty (e.g. a
 * schedule built anonymously before logging in), merge local + server (union by
 * course id, local wins) and push the result so nothing is lost. If the local
 * cart is empty, the server wins — a true cross-device pull.
 *
 * Guards:
 *  - Only pulls once per user per module lifetime (page navigations won't
 *    re-pull and clobber local state).
 *  - Flushes any pending debounced push before fetching so local changes
 *    reach the server before we read from it.
 *  - Detects cart mutations made while the fetch is in-flight and preserves
 *    local state when they occur.
 *  - Sets `_pullActive` to suppress `debouncedPush` during the pull to
 *    prevent pull's own `setState` from triggering a redundant push.
 */
export async function pullSchedule(userId: string, opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force && _lastPulledUserId === userId) return
  if (pullInFlight) return pullInFlight
  pullInFlight = _pullSchedule(userId).finally(() => { pullInFlight = null })
  return pullInFlight
}

/** Reset sync state (call on sign-out so the next sign-in pulls fresh). */
export function resetSyncState() {
  _lastPulledUserId = null
  lastItemCount = -1
  _localHydrated = false
  _pushSuspended = false
  _lastSyncedSignature = null
  clearSyncedDevice()
}

/**
 * Blocks `debouncedPush` from writing to the server. Used during sign-out so
 * clearing the local cart doesn't push an empty schedule and wipe the user's
 * saved server schedule. `resetSyncState()` lifts the suspension.
 */
export function suspendPush() {
  _pushSuspended = true
}

/** Stable signature of the full schedule (id + term + section + units + optional meetings),
 * so a mid-pull edit to an existing item — not just adds/removes — is detected. */
function cartSignature(): string {
  return useCartStore.getState().items
    .map(i => `${i.id}|${i.selectedTerm ?? ''}|${(i.selectedSectionIds ?? []).join('~')}|${i.selectedUnits ?? ''}|${i.color ?? ''}|${(i.optionalMeetings ?? []).join('~')}`)
    .sort()
    .join(';')
}

async function _pullSchedule(userId: string): Promise<void> {
  _pullActive = true
  let success = false
  try {
    // Flush (not cancel) any pending local changes so the server has them
    // before we read. This prevents the pull from overwriting un-pushed adds.
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
      await pushSchedule(userId)
    }

    await cartHydrated

    const snapshotSig = cartSignature()

    const { data, error } = await supabase
      .from('user_schedules')
      .select('schedule')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Failed to fetch schedule from Supabase:', error)
      return
    }

    // If the user changed the cart while we were fetching (add/remove OR an edit to
    // an existing item), their intent wins — push local instead of overwriting it.
    if (snapshotSig !== cartSignature()) {
      await pushSchedule(userId)
      return
    }

    const serverItems = data
      ? ((Array.isArray(data.schedule) ? data.schedule : []) as ScheduleItem[])
      : []
    const localItems = toScheduleItems()
    const deviceHasSynced = readSyncedDevice() === userId
    // An edit this device made that never reached the server (offline, failed
    // push). It is real work, not a cache, so the row must not overwrite it.
    // Null signature means a fresh load with nothing to compare, and the marker
    // already tells us the cart is a cache.
    const hasUnsyncedEdits = _lastSyncedSignature !== null && cartSignature() !== _lastSyncedSignature

    // This device has pulled as this user before, so its local cart is a cache
    // of the saved row rather than unseen work. The row wins outright — the
    // union below would re-add anything removed on another device, because a
    // removal is indistinguishable from a course this device never saw.
    // Requires `data`: a missing row is ambiguous (fresh project, RLS, manual
    // delete) and local may be the only copy left, so that falls through — as
    // does a local edit that never made it to the server.
    if (data && deviceHasSynced && !hasUnsyncedEdits) {
      await waitForCourses()
      const hydrated = hydrateItems(serverItems)
      // Set even when empty: emptying the schedule elsewhere has to stick.
      // Entries the catalog could not resolve are held by `hydrateItems` and
      // re-added on the next push, so this does not erase them.
      useCartStore.setState({ items: hydrated })
      if (serverItems.length > 0) {
        const syncedIds = new Set(serverItems.map(s => s.id))
        useCourseStore.getState().fetchCourseDetails([...syncedIds])
        reHydrateOnEnrichment(syncedIds)
      }
    } else if (localItems.length > 0) {
      // Local cart has items (e.g. built anonymously before logging in) — merge
      // so nothing the user built is lost. Union by course id; local wins on
      // conflicts. Then push the merged result to the server.
      const localIds = new Set(localItems.map(i => i.id))
      const serverOnly = serverItems.filter(s => !localIds.has(s.id))
      if (serverOnly.length > 0) {
        await waitForCourses()
        const hydratedServerOnly = hydrateItems(serverOnly)
        if (hydratedServerOnly.length > 0) {
          useCartStore.setState((state) => ({
            items: dedupeCrossListedItems(
              [...state.items, ...hydratedServerOnly],
              useCourseStore.getState().courses,
            ),
          }))
          const syncedIds = new Set(serverOnly.map(s => s.id))
          useCourseStore.getState().fetchCourseDetails([...syncedIds])
          reHydrateOnEnrichment(syncedIds)
        }
      }
      await pushSchedule(userId)
    } else if (serverItems.length > 0) {
      // Local cart empty — server wins (true cross-device pull)
      await waitForCourses()
      const hydrated = hydrateItems(serverItems)
      if (hydrated.length > 0) {
        useCartStore.setState({ items: hydrated })
        const syncedIds = new Set(serverItems.map(s => s.id))
        useCourseStore.getState().fetchCourseDetails([...syncedIds])
        reHydrateOnEnrichment(syncedIds)
      }
    } else if (data) {
      // Server row exists but is empty, and local is empty — nothing to do.
      useCartStore.setState({ items: [] })
    }

    // Set before the track call, never after. This block is inside the try, so
    // an analytics call that throws would otherwise land in the catch below and
    // roll back a pull that had already completed — losing the user's schedule
    // edit to a telemetry bug.
    success = true

    // Once per user per 5 minutes per device. A student with a dozen course
    // tabs open has a dozen AuthProviders all pulling on sign-in, which is one
    // sync happening, not a dozen: this event was recorded 14,825 times across
    // 879 sessions over Sep 15-17, peaking at 294 in one session.
    trackOnce('schedule_synced', userId, 5 * 60 * 1000, { items: toScheduleItems().length })
  } catch (err) {
    console.error('pullSchedule error:', err)
  } finally {
    _pullActive = false
    if (success) {
      _lastPulledUserId = userId
      markSyncedDevice(userId)
      _lastSyncedSignature = cartSignature()
    }
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastItemCount = -1
let _pushSuspended = false
/** Cart signature at this device's last agreement with the server (successful
 * push, or a pull it adopted). Lets us skip a push that would only re-assert a
 * stale cache — the write that used to resurrect a course removed elsewhere. */
let _lastSyncedSignature: string | null = null

export function debouncedPush(userId: string) {
  if (_pullActive || _pushSuspended) return
  if (debounceTimer) clearTimeout(debounceTimer)
  const currentCount = useCartStore.getState().items.length

  // Push immediately on removal or empty cart
  if (currentCount === 0 || (lastItemCount >= 0 && currentCount < lastItemCount)) {
    lastItemCount = currentCount
    pushSchedule(userId)
    return
  }

  lastItemCount = currentCount
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    pushSchedule(userId)
  }, 1500)
}

export function cancelDebouncedPush() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

/** Immediately push to server (flushes debounce). */
export async function flushAndPush(userId: string): Promise<void> {
  cancelDebouncedPush()
  await pushSchedule(userId)
}

/**
 * Backgrounding or unloading this device. Pushes only when the local cart has
 * actually diverged from what this device last synced.
 *
 * An unconditional push here is what made a removal on another device come
 * back: this device sends its whole list, and a list it merely cached before
 * the removal still contains the course. A pending debounce still flushes, and
 * so does an edit whose immediate push may not have landed yet, so nothing the
 * user did is dropped.
 */
export async function flushPendingPush(userId: string): Promise<void> {
  if (!debounceTimer && cartSignature() === _lastSyncedSignature) return
  await flushAndPush(userId)
}
