import type { Section } from '@/types/course'
import { getParsedSectionMeetings, makeMeetingKey } from '@/lib/schedule-utils'

/** One weekly meeting, from the site's own parser, with the strings the site keys optional meetings by. */
export type Slot = { days: string[]; start: number; end: number; startTime: string; endTime: string }

export const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export type Day = typeof DAY_ORDER[number]

export function slotsOf(section: Pick<Section, 'meetings'>): Slot[] {
  return getParsedSectionMeetings(section)
    .filter(m => m.days.length > 0 && m.endMinutes > m.startMinutes)
    .map(m => ({
      days: DAY_ORDER.filter(d => m.days.includes(d)),
      start: m.startMinutes,
      end: m.endMinutes,
      startTime: m.startTime,
      endTime: m.endTime,
    }))
}

export function overlaps(a: Slot, b: Slot): boolean {
  return a.days.some(d => b.days.includes(d)) && a.start < b.end && b.start < a.end
}

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function label(slot: Pick<Slot, 'days' | 'start' | 'end'>): string {
  return `${slot.days.join('/')} ${clock(slot.start)}-${clock(slot.end)}`
}

/** The keys the site stores in optionalMeetings, one per day. */
export function slotKeys(slot: Slot): string[] {
  return slot.days.map(d => makeMeetingKey(d, slot.startTime, slot.endTime))
}

/** "13:30" or "1:30 PM" -> minutes after midnight. */
export function parseClock(raw: string): number {
  const ampm = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (ampm) return (Number(ampm[1]) % 12 + (ampm[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(ampm[2])
  const hm = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2])
  throw new Error(`bad time ${raw}`)
}
