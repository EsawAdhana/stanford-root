import { describe, expect, it } from 'vitest'
import { importSummary, parseICS } from '@/lib/ics-parser'

/**
 * An .ics import with a non-class event used to put a card named "ICS IMPORT"
 * on the calendar and toast "Imported 3 courses (2 matched to catalog)".
 */

const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Stanford Schedule - Autumn 2026',
  'BEGIN:VEVENT', 'SUMMARY:CS 103', 'DTSTART;TZID=America/Los_Angeles:20260923T133000', 'DTEND;TZID=America/Los_Angeles:20260923T145000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:MATH51', 'DTSTART;TZID=America/Los_Angeles:20260923T103000', 'DTEND;TZID=America/Los_Angeles:20260923T112000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Office hours\\, Gates 104', 'DTSTART;TZID=America/Los_Angeles:20260924T160000', 'DTEND;TZID=America/Los_Angeles:20260924T170000', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('parseICS', () => {
  it('names an event that is not a class by its own SUMMARY', () => {
    const courses = parseICS(ICS)
    const codes = courses.map(c => `${c.subject} ${c.code}`.trim())
    expect(codes).toEqual(['CS 103', 'MATH 51', 'Office hours, Gates 104'])
    expect(codes.join(' ')).not.toContain('ICS IMPORT')
    const office = courses[2]
    expect(office.title).toBe('Office hours, Gates 104')
    expect(office.selectedTerm).toBe('Autumn 2026')
    expect(office.sections?.[0].meetings[0]).toMatchObject({ days: 'Thu', time: '4:00 PM - 5:00 PM' })
  })
})

describe('importSummary', () => {
  it('counts classes and other events in words', () => {
    expect(importSummary(2, 1)).toBe('Imported 2 classes and 1 other event.')
    expect(importSummary(1, 2)).toBe('Imported 1 class and 2 other events.')
    expect(importSummary(3, 0)).toBe('Imported 3 classes.')
    expect(importSummary(1, 0)).toBe('Imported 1 class.')
    expect(importSummary(0, 1)).toBe('Imported 1 event.')
    expect(importSummary(0, 4)).toBe('Imported 4 events.')
  })
})
