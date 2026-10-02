import type { Course, Section } from '@/types/course'
import type { ScheduleItem } from '@/lib/schedule-sync'
import { getCurrentTerm } from '@/lib/terms'
import { mergeSectionSelection, isScheduledForTerm } from '@/lib/schedule-utils'
import { displayedStatus } from '@/lib/seats'
import { parseUnitsOptions } from '@/lib/utils'
import { type Catalog, byComponent, code, findCourse, groupOf, sectionsIn, standIn, termKey } from './catalog'
import { DAY_ORDER, type Slot, clock, label, overlaps, slotKeys, slotsOf } from './meetings'

/** A saved item's section picks, reading the single-section form older rows used. */
export function pickedIds(item: ScheduleItem): number[] {
  if (item.selectedSectionIds?.length) return item.selectedSectionIds
  return item.selectedSectionId !== undefined ? [item.selectedSectionId] : []
}

export type Entry = { item: ScheduleItem; course?: Course; term?: string; drawn: Section[]; picked: boolean; unpicked: string[]; units: [number, number] | null }

export function entryOf(cat: Catalog, item: ScheduleItem, term?: string): Entry {
  const course = findCourse(cat, item.id)
  const t = term ?? item.selectedTerm
  if (!course) return { item, term: t, drawn: [], picked: false, unpicked: [], units: null }
  const secs = sectionsIn(course, t)
  const ids = pickedIds(item)
  const picked = secs.filter(s => ids.includes(s.classId))
  const fallback = t ? standIn(course, t) : undefined
  const drawn = picked.length ? picked : fallback ? [fallback] : []
  const have = new Set(picked.map(s => s.component))
  return {
    item, course, term: t, drawn, picked: picked.length > 0,
    unpicked: [...byComponent(secs).keys()].filter(c => !have.has(c)),
    units: unitsOf(course, item, picked),
  }
}

/** The schedule page's per-course units: selected, else the first picked section's, else the course's range. */
function unitsOf(course: Course, item: ScheduleItem, picked: Section[]): [number, number] | null {
  if (typeof item.selectedUnits === 'number') return [item.selectedUnits, item.selectedUnits]
  for (const s of picked) {
    const opts = parseUnitsOptions(s.units).filter(u => u > 0)
    if (opts.length) return [Math.min(...opts), Math.max(...opts)]
  }
  const opts = parseUnitsOptions(course.units)
  return opts.length ? [Math.min(...opts), Math.max(...opts)] : null
}

export function entriesFor(cat: Catalog, items: ScheduleItem[], term: string): Entry[] {
  return items
    .filter(i => {
      const c = findCourse(cat, i.id)
      return isScheduledForTerm({ selectedTerm: i.selectedTerm, terms: c?.terms }, term)
    })
    .map(i => entryOf(cat, i, term))
}

/** A section's meetings, split per day into attended and marked-optional (the site skips optional days one by one). */
function split(s: Section, optional: Set<string>): { slot: Slot; optional: boolean }[] {
  const out: { slot: Slot; optional: boolean }[] = []
  for (const sl of slotsOf(s)) {
    const keys = new Map(sl.days.map((d, i) => [d, slotKeys(sl)[i]]))
    const skipped = sl.days.filter(d => optional.has(keys.get(d)!))
    const kept = sl.days.filter(d => !skipped.includes(d))
    if (kept.length) out.push({ slot: { ...sl, days: kept }, optional: false })
    if (skipped.length) out.push({ slot: { ...sl, days: skipped }, optional: true })
  }
  return out
}

export function labelledMeetings(s: Section, item: ScheduleItem): string[] {
  return split(s, new Set(item.optionalMeetings ?? [])).map(x => label(x.slot) + (x.optional ? ' (marked optional)' : ''))
}

export function requiredSlots(s: Section, item: ScheduleItem, includeOptional = false): Slot[] {
  return split(s, includeOptional ? new Set() : new Set(item.optionalMeetings ?? [])).filter(x => !x.optional).map(x => x.slot)
}

export type Overlap = { course_ids: string[]; when: string }

export function conflicts(cat: Catalog, entries: Entry[], includeOptional = false): Overlap[] {
  const out: Overlap[] = []
  entries.forEach((a, i) => {
    for (const b of entries.slice(i + 1)) {
      if (!a.course || !b.course) continue
      const ga = new Set(groupOf(cat, a.course.id))
      if (groupOf(cat, b.course.id).some(id => ga.has(id))) continue
      const as = a.drawn.flatMap(s => requiredSlots(s, a.item, includeOptional))
      const bs = b.drawn.flatMap(s => requiredSlots(s, b.item, includeOptional))
      for (const x of as) {
        const y = bs.find(z => overlaps(x, z))
        if (y) {
          out.push({ course_ids: [a.item.id, b.item.id], when: `${x.days.filter(d => y.days.includes(d)).join('/')} ${clock(Math.max(x.start, y.start))}-${clock(Math.min(x.end, y.end))}` })
          break
        }
      }
    }
  })
  return out
}

export function unitTotal(entries: Entry[]): [number, number] {
  return entries.reduce<[number, number]>((t, e) => (e.units ? [t[0] + e.units[0], t[1] + e.units[1]] : t), [0, 0])
}

export function unitsLabel(u: [number, number] | null): string | null {
  if (!u) return null
  const f = (n: number) => (Number.isInteger(n) ? String(n) : String(n))
  return u[0] === u[1] ? f(u[0]) : `${f(u[0])}-${f(u[1])}`
}

export function entryOut(e: Entry) {
  return {
    course_id: e.item.id,
    code: e.course ? code(e.course) : null,
    title: e.course?.title ?? null,
    term: e.term ?? null,
    units: unitsLabel(e.units),
    section_picked: e.picked,
    sections: e.drawn.map(s => ({
      section_id: s.classId,
      component: s.component,
      meetings: labelledMeetings(s, e.item),
      status: displayedStatus(s.status, s, s.combined),
    })),
    unpicked_components: e.unpicked,
    time_tba: e.drawn.length > 0 && !e.drawn.some(s => slotsOf(s).length),
  }
}

/** The site's addItem for one saved row: same quarter merges picks by component, another quarter starts over, a sibling listing is replaced. */
export function applyAdd(items: ScheduleItem[], cat: Catalog, c: Course, term: string, sectionIds: number[], units?: number): { items: ScheduleItem[]; action: 'added' | 'updated' | 'unchanged'; replaced: string | null } {
  const list = items.map(i => ({ ...i }))
  const existing = list.find(i => i.id === c.id)
  const group = new Set(groupOf(cat, c.id))
  const sibling = list.find(i => i.id !== c.id && group.has(i.id) && (i.selectedTerm ?? term) === term)
  let picks = existing && existing.selectedTerm === term ? pickedIds(existing) : []
  for (const id of sectionIds) picks = mergeSectionSelection(picks, id, sectionsIn(c, term))
  const base: ScheduleItem = existing ? { ...existing } : { id: c.id }
  if (existing && existing.selectedTerm !== term) delete base.optionalMeetings
  base.selectedTerm = term
  delete base.selectedSectionId
  if (picks.length) base.selectedSectionIds = picks
  else delete base.selectedSectionIds
  if (units !== undefined) base.selectedUnits = units
  if (!existing && sibling?.color) base.color = sibling.color
  let next: ScheduleItem[]
  let action: 'added' | 'updated' | 'unchanged'
  if (!existing) {
    action = 'added'
    next = [...list, base]
  } else {
    action = JSON.stringify(sortKeys(base)) === JSON.stringify(sortKeys(existing)) ? 'unchanged' : 'updated'
    next = list.map(i => (i === existing ? base : i))
  }
  if (sibling) next = next.filter(i => i !== sibling)
  return { items: next, action, replaced: sibling?.id ?? null }
}

export function sortKeys<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) as T
}

// .ics export: one weekly event per meeting, from the section's real first day to its last.

const ICS_DAY: Record<string, string> = { Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA', Sun: 'SU' }
const APPROX_START: Record<string, [number, number]> = { Autumn: [8, 22], Winter: [0, 5], Spring: [2, 30], Summer: [5, 22] }
const VTIMEZONE = ['BEGIN:VTIMEZONE', 'TZID:America/Los_Angeles', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800',
  'TZNAME:PST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE']
const esc = (s: string) => (s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`

export function exportIcs(entries: Entry[], term: string): { ics: string; events: number; leftOff: string[] } {
  const [season, year] = term.split(' ')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stanford Root//MCP Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:Stanford Schedule - ${term}`, 'X-WR-TIMEZONE:America/Los_Angeles', ...VTIMEZONE]
  let events = 0
  const leftOff: string[] = []
  for (const e of entries) {
    if (!e.course) continue
    let drew = false
    for (const s of e.drawn) {
      const [m, d] = APPROX_START[season] ?? [0, 1]
      const start = s.startDate ? new Date(`${s.startDate}T00:00:00Z`) : new Date(Date.UTC(Number(year), m, d))
      for (const slot of requiredSlots(s, e.item)) {
        const first = new Date(start)
        while (!slot.days.includes(DAY_ORDER[(first.getUTCDay() + 6) % 7])) first.setUTCDate(first.getUTCDate() + 1)
        const rule = `RRULE:FREQ=WEEKLY;BYDAY=${slot.days.map(x => ICS_DAY[x]).join(',')}` + (s.endDate ? `;UNTIL=${s.endDate.replace(/-/g, '')}T235959Z` : ';COUNT=10')
        lines.push('BEGIN:VEVENT', `SUMMARY:${esc(`${code(e.course)} ${s.component}`)}`, `DESCRIPTION:${esc(e.course.title)}`,
          `DTSTART;TZID=America/Los_Angeles:${ymd(first)}T${hhmm(slot.start)}`, `DTEND;TZID=America/Los_Angeles:${ymd(first)}T${hhmm(slot.end)}`,
          rule, `UID:${e.item.id}-${s.classId}-${slot.days.join('')}-${slot.start}@stanfordroot.com`, 'END:VEVENT')
        events++
        drew = true
      }
    }
    if (!drew) leftOff.push(code(e.course))
  }
  lines.push('END:VCALENDAR')
  return { ics: lines.join('\r\n') + '\r\n', events, leftOff }
}

// .ics import, like the site's Import, with weekly RRULE days read and unmatched times reported rather than guessed.

type IcsEvent = { summary: string; start: Date; end: Date; days: Set<string> }
const ICS_DAYS: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }

function when(v: string): Date | null {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))) : null
}

export function parseIcs(text: string): { events: IcsEvent[]; term: string | null } {
  const lines = text.replace(/(\r\n|\n|\r)[ \t]/g, '').split(/\r\n|\n|\r/)
  const events: IcsEvent[] = []
  let term: string | null = null
  let cur: Record<string, string> | null = null
  for (const line of lines) {
    if (!term && line.startsWith('X-WR-CALNAME')) {
      const m = line.match(/\b(Winter|Spring|Summer|Autumn|Fall)\s+(\d{4})\b/i)
      if (m) {
        const season = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
        term = `${season === 'Fall' ? 'Autumn' : season} ${m[2]}`
      }
    }
    if (line.startsWith('BEGIN:VEVENT')) cur = {}
    else if (line.startsWith('END:VEVENT') && cur) {
      const start = when(cur.DTSTART ?? '')
      const end = when(cur.DTEND ?? '')
      if (cur.SUMMARY && start && end) {
        const days = new Set([DAY_ORDER[(start.getUTCDay() + 6) % 7] as string])
        const by = (cur.RRULE ?? '').match(/BYDAY=([A-Z,]+)/)
        if (by) for (const d of by[1].split(',')) if (ICS_DAYS[d.slice(-2)]) days.add(ICS_DAYS[d.slice(-2)])
        events.push({ summary: cur.SUMMARY.replace(/\\,/g, ',').replace(/\;/g, ';').trim(), start, end, days })
      }
      cur = null
    } else if (cur && line.includes(':')) {
      const i = line.indexOf(':')
      cur[line.slice(0, i).split(';')[0]] = line.slice(i + 1)
    }
  }
  return { events, term }
}

export type IcsMatch = { summary: string; term: string; course?: Course; sectionIds: number[]; unmatchedTimes: string[]; reason: string | null }

export function matchIcs(cat: Catalog, events: IcsEvent[], calendarTerm: string | null, forceTerm?: string): IcsMatch[] {
  const groups = new Map<string, IcsEvent[]>()
  for (const ev of events) {
    const term = forceTerm ?? calendarTerm ?? getCurrentTerm(new Date(ev.start.getUTCFullYear(), ev.start.getUTCMonth(), ev.start.getUTCDate()))
    const k = `${ev.summary}\u0000${term}`
    groups.set(k, [...(groups.get(k) ?? []), ev])
  }
  const out: IcsMatch[] = []
  const merged = new Map<string, IcsMatch>()
  for (const [k, evs] of groups) {
    const [summary, term] = k.split('\u0000')
    const meetings = new Map<string, { start: number; end: number; days: Set<string> }>()
    for (const ev of evs) {
      const start = ev.start.getUTCHours() * 60 + ev.start.getUTCMinutes()
      const end = ev.end.getUTCHours() * 60 + ev.end.getUTCMinutes()
      const m = meetings.get(`${start}-${end}`) ?? { start, end, days: new Set<string>() }
      for (const d of ev.days) m.days.add(d)
      meetings.set(`${start}-${end}`, m)
    }
    const labels = [...meetings.values()].map(m => label({ days: DAY_ORDER.filter(d => m.days.has(d)), start: m.start, end: m.end }))
    const cm = summary.toUpperCase().match(/^\s*([A-Z&]{2,10})\s*(\d+[A-Z]*)/)
    const course = cm ? findCourse(cat, cm[1] + cm[2]) : undefined
    if (!course) {
      out.push({ summary, term, sectionIds: [], unmatchedTimes: labels, reason: cm ? 'no catalog course matches this title' : 'the title does not start with a course code' })
      continue
    }
    const secs = sectionsIn(course, term)
    if (!secs.length) {
      out.push({ summary, term, course, sectionIds: [], unmatchedTimes: labels, reason: `${code(course)} is not offered in ${term}` })
      continue
    }
    const ids: number[] = []
    const missed: string[] = []
    for (const m of meetings.values()) {
      const days = DAY_ORDER.filter(d => m.days.has(d))
      const hit = secs.find(s => slotsOf(s).some(sl => sl.days.length === days.length && sl.days.every(d => days.includes(d as typeof days[number])) && sl.start === m.start && sl.end === m.end))
      if (!hit) missed.push(label({ days, start: m.start, end: m.end }))
      else if (!ids.includes(hit.classId)) ids.push(hit.classId)
    }
    const key = `${course.id}\u0000${term}`
    const prev = merged.get(key)
    if (prev) {
      prev.summary = `${prev.summary}; ${summary}`
      for (const id of ids) if (!prev.sectionIds.includes(id)) prev.sectionIds.push(id)
      for (const t of missed) if (!prev.unmatchedTimes.includes(t)) prev.unmatchedTimes.push(t)
    } else {
      const row: IcsMatch = { summary, term, course, sectionIds: ids, unmatchedTimes: missed, reason: null }
      merged.set(key, row)
      out.push(row)
    }
  }
  return out
}

export { termKey }
