'use client'

import React from 'react'
import { X } from 'lucide-react'
import { useResetFilters } from '@/hooks/use-reset-filters'
import { useActiveFilterChips } from '@/hooks/use-active-filter-chips'
import { ChipRows } from '@/components/ui/chip-rows'

export function ActiveFilterChips() {
  const chips = useActiveFilterChips()
  const resetFilters = useResetFilters()

  if (chips.length === 0) return null

  return (
    <ChipRows
      contentClassName="gap-2"
      trailing={chips.length > 1 ? (
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex items-center h-8 sm:h-7 px-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          Clear all
        </button>
      ) : null}
    >
      {chips.map(({ id, label, onRemove }) => (
        <span
          key={id}
          className="inline-flex items-center gap-2 h-8 sm:h-7 pl-3 pr-2.5 sm:pl-2.5 sm:pr-2 rounded-md bg-primary/5 border border-primary/30 text-xs font-medium text-primary"
        >
          <span className="whitespace-nowrap">{label}</span>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded p-0.5 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={`Remove ${label}`}
          >
            <X size={12} className="text-muted-foreground hover:text-foreground" />
          </button>
        </span>
      ))}
    </ChipRows>
  )
}
