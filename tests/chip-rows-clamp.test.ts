import { describe, it, expect } from 'vitest'
import { planClamp, type ChipBox } from '@/components/ui/chip-rows'

/** `count` chips laid out on one row, `h` tall, starting at `top`. */
function row(top: number, count: number, h = 28): ChipBox[] {
  return Array.from({ length: count }, () => ({ top, bottom: top + h }))
}

describe('planClamp', () => {
  it('does not clamp when every chip fits in the row budget', () => {
    expect(planClamp([...row(0, 5), ...row(36, 3)], 2)).toBeNull()
  })

  it('does not clamp at exactly the row budget', () => {
    expect(planClamp([...row(0, 5), ...row(36, 5)], 2)).toBeNull()
  })

  it('clamps to the bottom of the last visible row and counts the rest', () => {
    const boxes = [...row(0, 5), ...row(36, 5), ...row(72, 4), ...row(108, 1)]
    expect(planClamp(boxes, 2)).toEqual({ height: 64, hidden: 5 })
  })

  it('measures height from the content box, not from a scrolled ancestor', () => {
    // The offsetParent bug: same two rows, but 900px down the sidebar. The clamp
    // must still be 64px, or it shows thirteen rows instead of two.
    const boxes = [...row(900, 3), ...row(936, 3), ...row(972, 3)]
    const origin = 900
    const relative = boxes.map(b => ({ top: b.top - origin, bottom: b.bottom - origin }))
    expect(planClamp(relative, 2)).toEqual({ height: 64, hidden: 3 })
  })

  it('uses the tallest chip in the last visible row', () => {
    // A two-line chip label makes its row taller; clamping to a shorter sibling
    // would slice the descenders off the visible row.
    const boxes = [
      ...row(0, 2),
      { top: 36, bottom: 36 + 28 },
      { top: 36, bottom: 36 + 44 },
      ...row(88, 2),
    ]
    expect(planClamp(boxes, 2)).toEqual({ height: 80, hidden: 2 })
  })

  it('handles an empty list and a single row', () => {
    expect(planClamp([], 2)).toBeNull()
    expect(planClamp(row(0, 1), 2)).toBeNull()
  })

  it('clamps to one row when asked for one', () => {
    expect(planClamp([...row(0, 3), ...row(36, 2)], 1)).toEqual({ height: 28, hidden: 2 })
  })

  it('never clamps on a nonsense row budget', () => {
    expect(planClamp([...row(0, 3), ...row(36, 2)], 0)).toBeNull()
  })

  it('is not fooled by chips arriving out of visual order', () => {
    // Radix and virtualised lists can reorder children; row identity is the
    // top coordinate, so a later-in-DOM chip on an earlier row still counts
    // as visible rather than shifting the cut.
    const boxes = [...row(36, 2), ...row(0, 2), ...row(72, 3)]
    expect(planClamp(boxes, 2)).toEqual({ height: 64, hidden: 3 })
  })
})
