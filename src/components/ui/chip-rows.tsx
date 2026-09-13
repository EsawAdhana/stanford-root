'use client'

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ChipBox = { top: number; bottom: number }
export type Clamp = { height: number; hidden: number }

/**
 * Where to cut a wrapped chip list, from chip boxes measured relative to the
 * top of the content box. Returns null when everything fits in `rows`.
 *
 * Split out from the DOM read so the arithmetic is testable: measuring against
 * offsetParent instead of the content box was silently adding the sidebar's
 * whole scroll offset to the clamp height, showing thirteen rows instead of two.
 */
export function planClamp(boxes: ChipBox[], rows: number): Clamp | null {
  if (boxes.length === 0 || rows < 1) return null
  // Chips sharing a top are one wrapped row.
  const tops: number[] = []
  for (const box of boxes) {
    if (!tops.includes(box.top)) tops.push(box.top)
  }
  if (tops.length <= rows) return null
  const lastVisibleTop = tops.slice().sort((a, b) => a - b)[rows - 1]
  return {
    height: Math.max(...boxes.filter(b => b.top === lastVisibleTop).map(b => b.bottom)),
    hidden: boxes.filter(b => b.top > lastVisibleTop).length,
  }
}

/**
 * A wrapping chip list clamped to `rows` visible rows, with a caret that
 * expands the rest. Sixty-odd exclude keywords pushed the course list off
 * screen entirely, so anything that grows one chip at a time uses this.
 *
 * Rows are measured from the DOM rather than assumed from a chip count: the
 * same number of chips is one row on a wide window and four on a narrow one.
 */
export function ChipRows({
  rows = 2,
  chipHeight = 28,
  chipGap = 8,
  className,
  contentClassName,
  trailing,
  children,
}: {
  rows?: number
  /**
   * Chip height and row gap in px, used only for the clamp that ships in the
   * server-rendered HTML. The server cannot measure, so without them a refresh
   * paints all ninety chips until hydration snaps them down to two rows.
   */
  chipHeight?: number
  chipGap?: number
  className?: string
  /** Classes for the wrapping flex row that holds the chips (gaps, alignment). */
  contentClassName?: string
  /** Rendered next to the caret, outside the clamped area (e.g. "Clear all"). */
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  // null = measured as fitting within `rows`, so no caret and no clamp.
  const [collapsed, setCollapsed] = useState<Clamp | null>(null)
  // Until the first measurement, fall back to the chipHeight/chipGap estimate.
  const [measured, setMeasured] = useState(false)

  const measure = useCallback(() => {
    const content = contentRef.current
    if (!content) return
    // The trailing slot is excluded: it sits after the last chip, so leaving it
    // out keeps the row count independent of whether it is currently inline.
    // Otherwise moving it in and out of the flow could flip the caret forever.
    const items = (Array.from(content.children) as HTMLElement[])
      .filter(item => !item.hasAttribute('data-chip-rows-trailing'))
    setMeasured(true)
    if (items.length === 0) {
      setCollapsed(null)
      return
    }
    // Offsets relative to the content box, not to offsetParent: the chips are
    // statically positioned, so offsetTop is measured from some ancestor far up
    // the sidebar and would inflate the clamp height by that whole distance.
    const origin = content.getBoundingClientRect().top
    const boxes = items.map(item => {
      const rect = item.getBoundingClientRect()
      return { top: Math.round(rect.top - origin), bottom: Math.round(rect.bottom - origin) }
    })
    setCollapsed(planClamp(boxes, rows))
  }, [rows])

  // Layout effect, not effect: measuring after paint means one frame of the
  // unclamped wall on every navigation into the page.
  useLayoutEffect(() => {
    measure()
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    for (const item of Array.from(content.children)) observer.observe(item)
    return () => observer.disconnect()
  }, [measure, children])

  const isClamped = collapsed !== null && !expanded
  const estimating = !measured && !expanded

  // Tabbing into a clipped chip would scroll it inside a hidden box, leaving the
  // focus ring invisible and the rows shifted. Expand instead, but only for
  // chips below the fold, since focus also bubbles from the visible ones.
  const handleFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const clip = e.currentTarget
    // Chrome scrolls an overflow-hidden box to reveal a focused child before
    // this handler runs, so "is it below the fold" has to include "did the box
    // just get scrolled": by then the geometry alone says it is in view.
    const scrolled = clip.scrollTop > 0
    const below = (e.target as HTMLElement).getBoundingClientRect().bottom
      > clip.getBoundingClientRect().bottom + 1
    if (scrolled || below) {
      clip.scrollTop = 0
      setExpanded(true)
    }
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn((isClamped || estimating) && 'overflow-hidden')}
        style={
          isClamped ? { height: collapsed.height }
            : estimating ? { maxHeight: rows * chipHeight + (rows - 1) * chipGap }
              : undefined
        }
        onFocus={isClamped ? handleFocus : undefined}
      >
        <div ref={contentRef} className={cn('flex flex-wrap items-center', contentClassName)}>
          {children}
          {/* Inline while everything fits; moves next to the caret once clamped. */}
          {collapsed === null && trailing && (
            <span data-chip-rows-trailing className="contents">{trailing}</span>
          )}
        </div>
      </div>
      {collapsed !== null && (
        <div className={cn('flex flex-wrap items-center', contentClassName)}>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 h-8 sm:h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {expanded
              ? <ChevronDown size={14} className="shrink-0" />
              : <ChevronRight size={14} className="shrink-0" />}
            {expanded ? 'Show less' : `${collapsed.hidden} more`}
          </button>
          {trailing}
        </div>
      )}
    </div>
  )
}
