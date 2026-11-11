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

/** Whether the catalog holds courses a saved schedule can be matched against. */
function catalogReady(): boolean {
  const { hasLoaded, courses } = useCourseStore.getState()
  return hasLoaded && courses.length > 0
}

/**
 * Waits for the course catalog, then resolves true when it holds courses to
 * hydrate against. Resolves false when the load failed or the timeout passed,
 * so callers can't hang. Callers must not hydrate on false: matching a saved
 * schedule against an empty catalog resolves nothing, and the pull used to set
 * the visible cart to [] that way whenever the catalog failed or took over 10s.
 */
function waitForCourses(timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    if (catalogReady()) {
      resolve(true)
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      resolve(catalogReady())
    }
    const timer = setTimeout(finish, timeoutMs)
    // Listening before the load starts, so no settle can be missed.
    const unsub = useCourseStore.subscribe((state) => {
      // A load that settled, either way. `hasLoaded` alone is already true
      // while a retry after a failed load is still running.
      if (state.hasLoaded && !state.isLoading) finish()
    })
    // Nothing else may have started the catalog load — a signed-in user sitting
    // on the landing page has no catalog screen mounted — and sync needs it to
    // re-attach Course objects to the saved schedule. After a failed load this
    // is also the retry.
    void useCourseStore.getState().fetchCourses()
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
  // Without a catalog the cart keeps its metadata-only items; the next pull
  // hydrates them.
  if (!(await waitForCourses())) return
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

// ---------------------------------------------------------------------------
// Merging two copies of a schedule
// ---------------------------------------------------------------------------

/**
 * How many courses an empty saved row may take off a device in one step.
 *
 * There is no "clear all" button, so a student empties a schedule one removal
 * at a time, and a device that kept up sees the last one go: one course to
 * none. A row that went from several courses to [] in one step is what the
 * 2026-09-30 and 2026-11-10 wipes looked like. A device still holding more
 * than this many of the courses it last agreed on keeps them and writes them
 * back instead of adopting the empty row.
 */
export const MAX_COURSES_AN_EMPTY_ROW_MAY_CLEAR = 1

/** Conditional writes tried before a save gives up until the next edit or focus. */
export const MAX_SAVE_ATTEMPTS = 3

/**
 * One saved entry in a form where equal choices compare equal: keys sorted,
 * empty fields dropped, and the single-section form written before
 * multi-section support read as the list it means.
 */
function itemKey(item: ScheduleItem): string {
  const sectionIds = readSectionIds(item)
  const fields: Record<string, unknown> = {
    id: item.id,
    selectedTerm: item.selectedTerm,
    selectedSectionIds: sectionIds?.length ? sectionIds : undefined,
    selectedUnits: item.selectedUnits,
    color: item.color,
    optionalMeetings: item.optionalMeetings?.length ? item.optionalMeetings : undefined,
  }
  return JSON.stringify(
    Object.keys(fields).sort().filter(k => fields[k] !== undefined && fields[k] !== null).map(k => [k, fields[k]])
  )
}

/** Same courses, same choices, same order. Order counts because the row is compared as stored. */
function sameSchedule(a: ScheduleItem[], b: ScheduleItem[]): boolean {
  return a.length === b.length && a.every((item, i) => itemKey(item) === itemKey(b[i]))
}

function byId(items: ScheduleItem[]): Map<string, ScheduleItem> {
  const map = new Map<string, ScheduleItem>()
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item)
  return map
}

/**
 * Three-way merge of a saved schedule.
 *
 *  - base:   what this device and the row last agreed on. Null when this
 *            device has never agreed with the row (a schedule built before
 *            signing in, or a new browser).
 *  - mine:   this device's schedule now.
 *  - theirs: the row now, as other devices and the MCP left it.
 *
 * The rule, in plain words:
 *  - A course added on either side since base is kept.
 *  - A course removed on either side since base is removed, even if the other
 *    side changed its section or units meanwhile.
 *  - A course both sides still hold takes whichever side changed it since
 *    base. If both changed it, or there is no base, this device's version wins.
 *  - With no base nothing counts as removed, so the result is the union.
 *  - An empty row does not take more than MAX_COURSES_AN_EMPTY_ROW_MAY_CLEAR
 *    courses off this device: past that, this device's list is kept whole.
 *  - Courses the catalog no longer lists are ordinary entries here, so they
 *    are kept like any other.
 *
 * The result follows the row's order, with this device's additions after it,
 * so a merge that changes nothing returns exactly the row and writes nothing.
 */
export function mergeSchedules(base: ScheduleItem[] | null, mine: ScheduleItem[], theirs: ScheduleItem[]): ScheduleItem[] {
  const baseById = base ? byId(base) : null
  const mineById = byId(mine)
  const theirsById = byId(theirs)

  if (theirs.length === 0 && baseById) {
    const takenOff = [...mineById.keys()].filter(id => baseById.has(id)).length
    if (takenOff > MAX_COURSES_AN_EMPTY_ROW_MAY_CLEAR) return [...mineById.values()]
  }

  const out: ScheduleItem[] = []
  for (const their of theirsById.values()) {
    const my = mineById.get(their.id)
    const was = baseById?.get(their.id)
    if (!my) {
      if (was) continue // removed here
      out.push(their) // added there
      continue
    }
    if (was && itemKey(my) === itemKey(was)) out.push(their) // only they changed it, or nobody did
    else if (was && itemKey(their) === itemKey(was)) out.push(my) // only this device changed it
    else out.push(itemKey(my) === itemKey(their) ? their : my) // both changed it, or no base
  }
  for (const my of mineById.values()) {
    if (theirsById.has(my.id)) continue
    if (baseById?.has(my.id)) continue // removed there
    out.push(my) // added here
  }
  return out
}

/**
 * The merge against the row as read. No row at all is not an empty schedule:
 * it is ambiguous (a fresh project, a policy hiccup, a manual delete) and this
 * device's list may be the only copy left, so it is kept whole.
 */
function mergeWithRow(base: ScheduleItem[] | null, mine: ScheduleItem[], theirs: ScheduleItem[] | null): ScheduleItem[] {
  return theirs === null ? mine : mergeSchedules(base, mine, theirs)
}

/**
 * Adds back the agreed courses this device could not show because the catalog
 * does not list them. They are parked, not removed: the student never saw them
 * here, so could not have removed them. After a reload they are no longer in
 * memory, so without this the merge would read them as removed on this device.
 * Call only with the catalog loaded.
 */
function withParked(items: ScheduleItem[], base: ScheduleItem[] | null): ScheduleItem[] {
  if (!base) return items
  const inCart = new Set(items.map(i => i.id))
  const listed = new Set(useCourseStore.getState().courses.map(c => c.id))
  return [...items, ...base.filter(b => !inCart.has(b.id) && !listed.has(b.id))]
}

// ---------------------------------------------------------------------------
// Reading and writing the row
// ---------------------------------------------------------------------------

/** The row's schedule, null when the account has no row yet. */
type RowRead = { ok: true; schedule: ScheduleItem[] | null } | { ok: false }

async function readRow(userId: string): Promise<RowRead> {
  const { data, error } = await supabase
    .from('user_schedules')
    .select('schedule')
    .eq('user_id', userId)
    .single()
  if (error && error.code !== 'PGRST116') {
    console.error('Failed to fetch schedule from Supabase:', error)
    return { ok: false }
  }
  if (!data) return { ok: true, schedule: null }
  return { ok: true, schedule: (Array.isArray(data.schedule) ? data.schedule : []) as ScheduleItem[] }
}

type WriteResult = 'written' | 'conflict' | 'failed'

/**
 * Longest URL-encoded schedule a conditional save compares against. Measured
 * 2026-11-11 with read-only requests to the project's API: a 13,623-character
 * filter was accepted, 18,163 failed with a network error and 27,243 with 400.
 * The largest saved schedule then was 5,204 characters of JSON (about 8,000
 * encoded).
 */
const MAX_COMPARE_URL_CHARS = 12_000

/**
 * Writes `next` only if the row still holds `expected`, exactly as this device
 * last read or wrote it. A row someone else changed since matches nothing and
 * comes back as a conflict, never as an overwrite. `expected` null means this
 * device saw no row: the write is an insert, and a row created meanwhile is a
 * conflict too. Same pattern as the MCP's writeSchedule in src/lib/mcp/data.ts,
 * and the same row-level security policies (own-row select, insert, update).
 */
async function writeIfUnchanged(userId: string, next: ScheduleItem[], expected: ScheduleItem[] | null): Promise<WriteResult> {
  if (expected === null) {
    const { error } = await supabase
      .from('user_schedules')
      .insert({ user_id: userId, schedule: next })
      .select('user_id')
    if (error?.code === '23505') return 'conflict'
    if (error) {
      console.error('Failed to save schedule:', error)
      return 'failed'
    }
    return 'written'
  }
  const expectedJson = JSON.stringify(expected)
  if (encodeURIComponent(expectedJson).length > MAX_COMPARE_URL_CHARS) {
    // The expected value travels in the URL, and past the gateway's limit the
    // request fails outright. A schedule that large saves the way every save
    // did before compare-and-set rather than never saving at all.
    const { error: upsertError } = await supabase
      .from('user_schedules')
      .upsert({ user_id: userId, schedule: next }, { onConflict: 'user_id' })
    if (upsertError) {
      console.error('Failed to save schedule:', upsertError)
      return 'failed'
    }
    return 'written'
  }
  const { data, error } = await supabase
    .from('user_schedules')
    .update({ schedule: next })
    .eq('user_id', userId)
    .eq('schedule', expectedJson)
    .select('user_id')
  if (error) {
    console.error('Failed to save schedule:', error)
    return 'failed'
  }
  return data?.length ? 'written' : 'conflict'
}

// ---------------------------------------------------------------------------
// What this device last agreed on with the row
// ---------------------------------------------------------------------------

/**
 * The row's schedule exactly as this tab last read or wrote it, which is both
 * the merge base and the value a save expects to find. Undefined until this
 * tab has agreed with the row, null when the agreement was "no row yet".
 */
let _synced: ScheduleItem[] | null | undefined = undefined

/**
 * The cart this tab loaded with, captured at its first pull. On a browser that
 * synced this user before, the persisted cart is a cache of the row as it was
 * then, so it stands in as the base until this tab agrees with the row.
 *
 * The agreement itself is deliberately not persisted. The persisted cart is
 * written by whichever tab of this browser changed it last, so a stored
 * agreement from one tab can be newer than the cart another tab left behind,
 * and the merge would then read the difference as courses removed here.
 * Using the cart as its own base can never invent a removal.
 */
let _loadedCart: ScheduleItem[] | undefined = undefined

/** The merge base for this user, or null when this device has never agreed with their row. */
function mergeBase(userId: string): ScheduleItem[] | null {
  if (_synced !== undefined) return _synced ?? []
  if (readSyncedDevice() === userId) return _loadedCart ?? []
  return null
}

/**
 * Records that the row holds `stored` and the cart matches it. `signature` is
 * the cart's signature at that moment, or null when the cart has moved on
 * since and still owes a save.
 */
function recordAgreement(stored: ScheduleItem[] | null, signature: string | null) {
  _synced = stored
  _lastSyncedSignature = signature
}

/** Replaces the cart with `items`, rebuilt from the catalog. Entries it cannot resolve are parked, not dropped. */
function applyToCart(items: ScheduleItem[]) {
  useCartStore.setState({ items: hydrateItems(items) })
  if (items.length > 0) {
    const syncedIds = new Set(items.map(s => s.id))
    useCourseStore.getState().fetchCourseDetails([...syncedIds])
    reHydrateOnEnrichment(syncedIds)
  }
}

/**
 * Saves the cart, only over the row this tab last agreed on. If the row has
 * changed since (another device, the MCP, a tab running an older release), the
 * save becomes a pull, which merges both sides and writes the result.
 * Errors are swallowed: local state stays visible. Resolves whether the cart
 * now matches the row.
 */
async function pushSchedule(userId: string, opts: { mergeOnConflict: boolean } = { mergeOnConflict: true }): Promise<boolean> {
  const epoch = _epoch
  // No agreement yet means this tab does not know what the row holds, and a
  // write would be blind. Nothing reaches here before a pull lands except a
  // direct flushAndPush call.
  if (_synced === undefined) return false
  const expected = _synced
  try {
    const schedule = toScheduleItems()
    const signature = cartSignature()
    const result = await writeIfUnchanged(userId, schedule, expected)
    // A push that lands after sign-out must not mark the next user's cart synced.
    if (epoch !== _epoch) return false
    if (result === 'failed') return false
    if (result === 'written') {
      // A pull may have recorded a newer agreement while this write was in flight.
      if (_synced === expected) recordAgreement(schedule, signature)
      return true
    }
    if (!opts.mergeOnConflict) return false
    await pullSchedule(userId, { force: true })
    return epoch === _epoch && cartSignature() === _lastSyncedSignature
  } catch (err) {
    console.error('pushSchedule error:', err)
    return false
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
let pullInFlightUserId: string | null = null
let _pullActive = false
/**
 * Bumped by `resetSyncState()`. A pull or push started before a sign-out
 * compares against it after each await and stops, so it cannot write the
 * signed-out user's schedule into the cart (or mark this device synced for
 * them) after sign-out cleared it.
 */
let _epoch = 0
let _lastPulledUserId: string | null = null

/**
 * Reads the row, merges it with this device's cart (see `mergeSchedules`),
 * writes the merge back if it differs from the row, and shows it in the cart.
 * Runs on sign-in, on focus and when a tab comes back into view, and when a
 * save finds the row changed.
 *
 * Guards:
 *  - Only pulls once per user per module lifetime unless forced (page
 *    navigations won't re-pull).
 *  - A pending debounced save is folded into the merge instead of written first.
 *  - The write is conditional on the row it read; if the row changed in
 *    between, it reads again and re-merges, up to MAX_SAVE_ATTEMPTS times.
 *  - An edit made while the write is in flight is merged on top and saved
 *    after, so neither it nor the row's changes are lost.
 *  - Sets `_pullActive` to suppress `debouncedPush` during the pull, so the
 *    pull's own cart update does not trigger a redundant save.
 */
export async function pullSchedule(userId: string, opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force && _lastPulledUserId === userId) return
  if (pullInFlight) {
    if (pullInFlightUserId === userId) return pullInFlight
    // A pull for someone else (signed out since) is still settling. Wait for
    // it rather than handing this user its result.
    return pullInFlight.then(() => pullSchedule(userId, opts))
  }
  pullInFlightUserId = userId
  pullInFlight = _pullSchedule(userId).finally(() => {
    pullInFlight = null
    pullInFlightUserId = null
  })
  return pullInFlight
}

/** Reset sync state (call on sign-out so the next sign-in pulls fresh). */
export function resetSyncState() {
  _epoch++
  _lastPulledUserId = null
  lastItemCount = -1
  _localHydrated = false
  _pushSuspended = false
  _lastSyncedSignature = null
  _synced = undefined
  _loadedCart = undefined
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

/**
 * Leaves the cart exactly as it was when the catalog cannot be loaded. The
 * pull does not count as landed, so the next focus or edit pulls again.
 */
function abandonPullWithoutCatalog(): void {
  console.error('pullSchedule: course catalog unavailable, keeping the local cart')
}

async function _pullSchedule(userId: string): Promise<void> {
  _pullActive = true
  let success = false
  let owesSave = false
  const epoch = _epoch
  const signedOutSince = () => epoch !== _epoch
  try {
    // Flush (not cancel) a pending save so the row has it before we read.
    // If the row changed meanwhile, the save is not retried here: the merge
    // below starts from the cart, so the edit is in what this pull writes.
    if (debounceTimer) {
      cancelDebouncedPush()
      await pushSchedule(userId, { mergeOnConflict: false })
    }

    await cartHydrated
    if (signedOutSince()) return

    // The cart this tab loaded with, before anything here changed it.
    if (_loadedCart === undefined) _loadedCart = toScheduleItems()
    const base = mergeBase(userId)

    let read = await readRow(userId)
    for (let attempt = 1; ; attempt++) {
      if (signedOutSince()) return
      if (!read.ok) return
      const theirs = read.schedule

      // The merge needs the catalog, to show its result and to tell a course
      // parked here from one removed here. Without it nothing is written or
      // changed, and the next focus or edit tries again.
      if ((theirs?.length ?? 0) > 0 || (base?.length ?? 0) > 0 || toScheduleItems().length > 0) {
        if (!(await waitForCourses())) return abandonPullWithoutCatalog()
        if (signedOutSince()) return
      }
      // Read the cart after the row and the catalog, so an edit made while
      // either was loading is part of the merge.
      const mine = withParked(toScheduleItems(), base)
      const merged = mergeWithRow(base, mine, theirs)
      const mineSignature = cartSignature()

      let stored = theirs
      if (!sameSchedule(merged, theirs ?? [])) {
        const result = await writeIfUnchanged(userId, merged, theirs)
        if (signedOutSince()) return
        // Not landed: the cart keeps this device's edits and the next focus
        // or edit merges again from the same base.
        if (result === 'failed') return
        if (result === 'conflict') {
          if (attempt >= MAX_SAVE_ATTEMPTS) {
            console.error('pullSchedule: the saved schedule kept changing, will retry on the next edit or focus')
            return
          }
          read = await readRow(userId)
          continue
        }
        stored = merged
      }

      // An edit made while the write was in flight is this device's newest
      // intent: merge it over what was just saved, then save it next.
      const editedMeanwhile = cartSignature() !== mineSignature
      const shown = editedMeanwhile ? mergeSchedules(mine, withParked(toScheduleItems(), base), merged) : merged
      applyToCart(shown)
      recordAgreement(stored, editedMeanwhile ? null : cartSignature())
      owesSave = editedMeanwhile
      break
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
    if (success && !signedOutSince()) {
      _lastPulledUserId = userId
      markSyncedDevice(userId)
      if (owesSave) debouncedPush(userId)
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

/**
 * Whether this tab may write its cart over the saved row. Not before a pull has
 * landed here: until then the cart is whatever this browser last held, which is
 * empty on a browser that never had the schedule. A tab hidden while its first
 * pull waited on the catalog pushed exactly that, and replaced a student's 16
 * saved courses with nothing (2026-09-30).
 */
function canPush(userId: string): boolean {
  return _cartLoaded && !_pushSuspended && _lastPulledUserId === userId
}

/**
 * Whether this tab's cart has been read back from localStorage. Before that the
 * cart is the store's empty initial state, not anything the student built, so
 * nothing may write it over the row. A landed pull implies this today, because
 * the pull awaits `cartHydrated`; checked here too so `flushPendingPush`, which
 * cannot wait (the tab is closing), never depends on that ordering.
 */
let _cartLoaded = false
void cartHydrated.then(() => { _cartLoaded = true })

export function debouncedPush(userId: string) {
  if (_pullActive || _pushSuspended) return
  if (!canPush(userId)) {
    // An edit before any pull landed (the first one failed). Pull instead: the
    // pull merges this edit with the row and pushes the result.
    void pullSchedule(userId)
    return
  }
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
  if (!canPush(userId)) return
  if (!debounceTimer && cartSignature() === _lastSyncedSignature) return
  await flushAndPush(userId)
}
