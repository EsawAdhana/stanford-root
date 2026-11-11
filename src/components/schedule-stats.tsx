'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type StatsColumn = {
  key: string
  /** The column's heading. Leave it off every column for a table with no heading row. */
  heading?: React.ReactNode
  units: string
  hours: string
  /** The plan on screen, set in bold. */
  active?: boolean
  /** Over the unit limit: the units figure turns red. */
  overUnits?: boolean
}

const ROWS = [
  ['Units', 'units'],
  ['Hours / week', 'hours'],
] as const

/** Units and hours for a schedule, one column per plan. */
export function StatsTable({ columns }: { columns: StatsColumn[] }) {
  const hasHeadings = columns.some(c => c.heading !== undefined)
  // Tighter cells once plans pile up, so four columns still fit the sidebar.
  const dense = columns.length > 3
  const cell = cn('py-2.5 text-right tabular-nums whitespace-nowrap', dense ? 'px-2' : 'px-3')

  return (
    <div className="rounded-xl border bg-card overflow-x-auto shrink-0">
      <table className={cn('w-full', dense ? 'text-xs' : 'text-sm')}>
        {hasHeadings && (
          <thead>
            <tr className="border-b">
              <td className="px-3 py-2" />
              {columns.map(c => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(cell, 'py-2 text-3xs uppercase font-semibold tracking-wider', c.active ? 'text-foreground' : 'text-muted-foreground')}
                >
                  {c.heading}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {ROWS.map(([name, field], i) => (
            <tr key={field} className={cn(i < ROWS.length - 1 && 'border-b')}>
              <th scope="row" className="px-3 py-2.5 text-left font-normal text-muted-foreground whitespace-nowrap">
                {name}
              </th>
              {columns.map(c => (
                <td
                  key={c.key}
                  className={cn(cell, c.active && 'font-semibold', field === 'units' && c.overUnits && 'text-destructive')}
                >
                  {c[field]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
