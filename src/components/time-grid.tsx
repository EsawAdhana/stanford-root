import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { DEFAULT_END_MINUTES, DEFAULT_START_MINUTES, HOUR_HEIGHT } from '@/lib/calendar-utils'

type Column = { key: string; label: string }

/**
 * The calendar's time grid: a header row, an hour rail, and one positioned
 * column per entry. Weekly classes and finals week both draw into it, so the
 * two views line up and look the same.
 */
export function TimeGrid({ columns, startMinutes, endMinutes, renderColumn }: {
  columns: Column[]
  startMinutes: number
  endMinutes: number
  renderColumn: (key: string) => React.ReactNode
}) {
  const hours = useMemo(
    () => Array.from({ length: (endMinutes - startMinutes) / 60 + 1 }, (_, i) => startMinutes / 60 + i),
    [startMinutes, endMinutes],
  )
  const gridTemplateColumns = `var(--cal-rail) repeat(${columns.length}, minmax(0, 1fr))`

  return (
    <div className="w-full overflow-x-auto scrollbar-hide shrink-0">
      <div className="min-w-0 sm:min-w-calendar">
        <div className="grid [--cal-rail:48px] sm:[--cal-rail:72px] border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30" style={{ gridTemplateColumns }}>
          <div className="p-1 px-2 sm:p-3 text-xs font-semibold text-muted-foreground border-r" />
          {columns.map(d => (
            <div key={d.key} className="p-1.5 sm:p-3 text-3xs sm:text-xs font-semibold text-muted-foreground border-r last:border-r-0 text-center truncate px-0.5">
              {d.label}
            </div>
          ))}
        </div>
        <div
          className="grid [--cal-rail:48px] sm:[--cal-rail:72px] relative"
          style={{ gridTemplateColumns, height: `${((endMinutes - startMinutes) / 60) * HOUR_HEIGHT}px` }}
        >
          {/* Time rail - left column, labels right-justified in box */}
          <div className="relative border-r bg-background/50">
            {hours.map((h, idx) => (
              <div key={h} className="absolute left-0 right-0" style={{ top: `${idx * HOUR_HEIGHT}px` }}>
                {idx !== hours.length - 1 && (
                  <div className={cn(
                    'absolute right-0 top-0 pr-1 sm:pr-2 text-right text-4xs sm:text-3xs text-muted-foreground bg-background/50 whitespace-nowrap',
                    'translate-y-0 mt-1'
                  )}>
                    {`${((h + 11) % 12) + 1}${h >= 12 ? 'p' : 'a'}`}
                  </div>
                )}
              </div>
            ))}
          </div>

          {columns.map(({ key }) => (
            <div key={key} className="relative border-r last:border-r-0 bg-background/30">
              {renderColumn(key)}
            </div>
          ))}

          {/* Horizontal lines, above the column backgrounds and below the blocks (z-20) */}
          <div className="absolute inset-0 pointer-events-none">
            {hours.map((_, idx) => (
              <div key={idx} className="absolute left-0 right-0 border-t border-border/40" style={{ top: `${idx * HOUR_HEIGHT}px` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Where a block sits in its column: its time span, and its share of the width beside overlapping blocks. */
export function blockStyle(
  block: { start: number; end: number; colIndex: number; colCount: number },
  startMinutes: number,
): React.CSSProperties {
  const colWidth = 100 / block.colCount
  const gutter = 2
  return {
    top: `${((block.start - startMinutes) / 60) * HOUR_HEIGHT}px`,
    height: `${((block.end - block.start) / 60) * HOUR_HEIGHT}px`,
    left: `calc(${block.colIndex * colWidth}% + ${gutter}px)`,
    width: `calc(${colWidth}% - ${gutter * 2}px)`,
    minHeight: '18px',
  }
}

/** 8 AM to 8 PM, stretched to whole hours around anything outside it, never shrunk. */
export function gridRange(blocks: { start: number; end: number }[]): { startMinutes: number; endMinutes: number } {
  if (blocks.length === 0) return { startMinutes: DEFAULT_START_MINUTES, endMinutes: DEFAULT_END_MINUTES }
  const minStart = blocks.reduce((m, b) => Math.min(m, b.start), Infinity)
  const maxEnd = blocks.reduce((m, b) => Math.max(m, b.end), 0)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const startMinutes = clamp(Math.min(DEFAULT_START_MINUTES, Math.floor(minStart / 60) * 60), 0, 23 * 60)
  const endMinutes = clamp(Math.max(DEFAULT_END_MINUTES, Math.ceil(maxEnd / 60) * 60), startMinutes + 60, 24 * 60)
  return { startMinutes, endMinutes }
}
