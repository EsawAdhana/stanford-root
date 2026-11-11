import { describe, it, expect } from 'vitest'
import { compactDayLabel } from '@/components/time-grid'
import { formatExamColumn } from '@/lib/final-exams'

describe('finals week headers get a compact form for narrow phones', () => {
  it('shortens every weekday the finals view can show', () => {
    // Autumn 2026 finals run Dec 7 to Dec 11; the 13th is a Sunday.
    expect(compactDayLabel(formatExamColumn('2026-12-07'))).toBe('M 12/7')
    expect(compactDayLabel(formatExamColumn('2026-12-08'))).toBe('Tu 12/8')
    expect(compactDayLabel(formatExamColumn('2026-12-09'))).toBe('W 12/9')
    expect(compactDayLabel(formatExamColumn('2026-12-10'))).toBe('Th 12/10')
    expect(compactDayLabel(formatExamColumn('2026-12-11'))).toBe('F 12/11')
    expect(compactDayLabel(formatExamColumn('2026-12-12'))).toBe('Sa 12/12')
    expect(compactDayLabel(formatExamColumn('2026-12-13'))).toBe('Su 12/13')
  })
  it('leaves the weekly view headers alone', () => {
    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', '', 'Monday 12/7', 'Mon 12/7 extra']) {
      expect(compactDayLabel(label)).toBeNull()
    }
  })
})
