/**
 * Plan A / Plan B: several schedules for one term.
 *
 * The active plan's classes are the cart's items, exactly as before plans
 * existed, so everything that reads the schedule (the calendar, export, the
 * course pages, the MCP, an old tab) sees the plan the student is looking at.
 * Only the plans not on screen are stored here, per term. That split is what
 * lets the saved row keep its shape: `user_schedules.schedule` stays the active
 * plan, and the other plans go in `user_schedules.plans`.
 */

/** A schedule entry as stored: what the cart persists for one course. */
export type SavedItem = {
  id: string
  selectedTerm?: string
  selectedSectionIds?: number[]
  selectedUnits?: number
  color?: string
  optionalMeetings?: string[]
}

export type TermPlans = {
  /** Plan labels in tab order, such as ['A', 'B']. */
  order: string[]
  active: string
  /** The classes of each plan that is not active, by label. */
  parked: Record<string, SavedItem[]>
}

/** Only terms with two or more plans have an entry. */
export type PlansByTerm = Record<string, TermPlans>

/** 0 -> "A", 25 -> "Z", 26 -> "AA": plans have no limit (product call, 2026-11-07). */
export function planLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

export function labelIndex(label: string): number {
  let n = 0
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** The label after the highest one in use, so a deleted plan's letter is never handed to a new plan. */
export function nextPlanLabel(order: string[]): string {
  const highest = order.reduce((max, label) => Math.max(max, labelIndex(label)), -1)
  return planLabel(highest + 1)
}

export function toSavedItem(item: SavedItem): SavedItem {
  const saved: SavedItem = { id: item.id }
  if (item.selectedTerm !== undefined) saved.selectedTerm = item.selectedTerm
  if (item.selectedSectionIds?.length) saved.selectedSectionIds = [...item.selectedSectionIds]
  if (item.selectedUnits !== undefined) saved.selectedUnits = item.selectedUnits
  if (item.color !== undefined) saved.color = item.color
  if (item.optionalMeetings?.length) saved.optionalMeetings = [...item.optionalMeetings]
  return saved
}

/**
 * The entries that make up one term's plan. Only entries saved under that term:
 * an entry with no term shows in every term it is offered in, so it belongs to
 * no single plan and stays put when plans switch.
 */
export function termSnapshot(items: SavedItem[], term: string): SavedItem[] {
  return items.filter(item => item.selectedTerm === term).map(toSavedItem)
}

/** What to write to `user_schedules.plans`: null once no term has a second plan. */
export function plansDocument(plans: PlansByTerm | undefined): PlansByTerm | null {
  return plans && Object.keys(plans).length > 0 ? plans : null
}

function itemSignature(item: SavedItem): string {
  return `${item.id}|${item.selectedTerm ?? ''}|${(item.selectedSectionIds ?? []).join('~')}|${item.selectedUnits ?? ''}|${item.color ?? ''}|${(item.optionalMeetings ?? []).join('~')}`
}

/** Stable across key order, so two devices holding the same plans agree. */
export function plansSignature(plans: PlansByTerm | undefined): string {
  if (!plans) return ''
  return Object.keys(plans).sort().map(term => {
    const p = plans[term]
    const parked = p.order
      .filter(label => label !== p.active)
      .map(label => `${label}:${(p.parked[label] ?? []).map(itemSignature).sort().join(',')}`)
    return `${term}/${p.order.join('.')}/${p.active}/${parked.join('/')}`
  }).join(';')
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{1,3}$/.test(value)
}

/** Saved entries read back from storage, keeping only the well-formed ones. */
export function readSavedItems(raw: unknown): SavedItem[] {
  return Array.isArray(raw) ? raw.map(readItem).filter((i): i is SavedItem => i !== null) : []
}

function readItem(raw: unknown): SavedItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const item: SavedItem = { id: r.id }
  if (typeof r.selectedTerm === 'string') item.selectedTerm = r.selectedTerm
  if (Array.isArray(r.selectedSectionIds)) {
    const ids = r.selectedSectionIds.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    if (ids.length) item.selectedSectionIds = ids
  }
  if (typeof r.selectedUnits === 'number' && Number.isFinite(r.selectedUnits)) item.selectedUnits = r.selectedUnits
  if (typeof r.color === 'string') item.color = r.color
  if (Array.isArray(r.optionalMeetings)) {
    const keys = r.optionalMeetings.filter((k): k is string => typeof k === 'string')
    if (keys.length) item.optionalMeetings = keys
  }
  return item
}

/**
 * Plans read back from the saved row, keeping only what has the right shape.
 * The row is written by this app, but a bad write should cost a plan, not the
 * schedule page.
 */
export function readPlans(raw: unknown): PlansByTerm {
  const plans: PlansByTerm = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return plans
  for (const [term, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const order = Array.isArray(v.order) ? [...new Set(v.order.filter(isLabel))] : []
    if (order.length < 2 || !isLabel(v.active) || !order.includes(v.active)) continue
    const parkedRaw = v.parked && typeof v.parked === 'object' ? (v.parked as Record<string, unknown>) : {}
    const parked: Record<string, SavedItem[]> = {}
    for (const label of order) {
      if (label === v.active) continue
      const list = Array.isArray(parkedRaw[label]) ? (parkedRaw[label] as unknown[]) : []
      parked[label] = list.map(readItem).filter((i): i is SavedItem => i !== null).map(i => ({ ...i, selectedTerm: term }))
    }
    plans[term] = { order, active: v.active, parked }
  }
  return plans
}
