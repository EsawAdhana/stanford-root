'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCartStore, type CartItem } from '@/lib/cart-store';
import { useCourseStore } from '@/lib/store';
import { useAuthStore } from '@/lib/auth-store';
import { useEvaluationStore } from '@/lib/evaluation-store';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { expectedWeeklyHours, formatUnitRange, termUnitRange } from '@/lib/schedule-totals';
import type { SavedItem } from '@/lib/schedule-plans';

const codeOf = (c: { subject: string; code: string }) => `${c.subject} ${c.code}`

function joinCodes(codes: string[]): string {
  if (codes.length <= 2) return codes.join(' and ')
  return `${codes.slice(0, -1).join(', ')}, and ${codes[codes.length - 1]}`
}

/** Plan A, Plan B, ... above the calendar, for the term on screen. */
export function PlanTabs({ term }: { term: string }) {
  const termPlans = useCartStore(s => s.plans[term])
  const items = useCartStore(s => s.items)
  const createPlan = useCartStore(s => s.createPlan)
  const switchPlan = useCartStore(s => s.switchPlan)
  const deletePlan = useCartStore(s => s.deletePlan)
  // A plan switch rebuilds classes from the catalog, so it waits for it.
  const hasLoaded = useCourseStore(s => s.hasLoaded)

  const order = termPlans?.order ?? ['A']
  const active = termPlans?.active ?? 'A'
  const activeCount = items.filter(i => i.selectedTerm === term).length

  const onSwitch = (label: string) => {
    const moved = switchPlan(term, label)
    track('plan_switched', { plans: order.length })
    if (moved.length > 0) {
      const codes = joinCodes(moved.map(codeOf))
      toast(`${codes} moved to ${term}, since Plan ${label} has ${moved.length === 1 ? 'it' : 'them'} and a class sits on one term at a time.`)
    }
  }

  const onCreate = () => {
    const label = createPlan(term)
    track('plan_created', { plans: order.length + 1 })
    toast(`Plan ${label} starts as a copy of Plan ${active}. Changes here leave Plan ${active} as it is.`)
  }

  const onDelete = (label: string) => {
    deletePlan(term, label)
    track('plan_deleted', { plans: order.length - 1 })
  }

  return (
    <Tabs value={active} onValueChange={onSwitch}>
      <TabsList className="w-full justify-start bg-transparent border-b border-border/40 rounded-none h-auto p-0 gap-6 overflow-x-auto overflow-y-hidden scrollbar-hide">
        {order.map(label => (
          <div key={label} className="flex items-center gap-1 shrink-0">
            <TabsTrigger
              value={label}
              disabled={!hasLoaded}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 py-2 text-sm font-semibold text-muted-foreground data-[state=active]:text-foreground transition-colors hover:text-foreground/80"
            >
              Plan {label}
            </TabsTrigger>
            {label === active && order.length > 1 && (
              <DeletePlan label={label} count={activeCount} onDelete={() => onDelete(label)} />
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={onCreate}
          disabled={!hasLoaded}
          className="shrink-0 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          + New plan
        </button>
      </TabsList>
    </Tabs>
  )
}

function DeletePlan({ label, count, onDelete }: { label: string; count: number; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Delete Plan ${label}`}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <p className="text-sm font-medium">Delete Plan {label}?</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {count === 0
            ? 'It has no classes. Your other plans stay as they are.'
            : `Its ${count} ${count === 1 ? 'class goes' : 'classes go'} with it. Your other plans stay as they are.`}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={() => { setOpen(false); onDelete() }}>Delete</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Full course data for a parked plan's entries, for its column in the comparison. */
function displayCourses(saved: SavedItem[], byId: Map<string, CartItem>): CartItem[] {
  return saved.flatMap(s => {
    const course = byId.get(s.id)
    return course
      ? [{ ...course, selectedTerm: s.selectedTerm, selectedSectionIds: s.selectedSectionIds, selectedUnits: s.selectedUnits }]
      : []
  })
}

/**
 * The plans side by side, in place of the units and hours cards. Every figure is
 * computed the way those cards compute it, so the active column matches what
 * the cards would have said.
 */
export function PlanComparison({ term, activeCourses }: { term: string; activeCourses: CartItem[] }) {
  const termPlans = useCartStore(s => s.plans[term])
  const switchPlan = useCartStore(s => s.switchPlan)
  const courses = useCourseStore(s => s.courses)
  const user = useAuthStore(s => s.user)
  const fetchBulkEvaluations = useEvaluationStore(s => s.fetchBulkEvaluations)
  const getEvaluations = useEvaluationStore(s => s.getEvaluations)
  const loadingCourses = useEvaluationStore(s => s.loadingCourses)
  const evaluations = useEvaluationStore(s => s.evaluations)

  const columns = useMemo(() => {
    if (!termPlans) return []
    const byId = new Map(courses.map(c => [c.id, c as CartItem]))
    return termPlans.order.map(label => ({
      label,
      courses: label === termPlans.active ? activeCourses : displayCourses(termPlans.parked[label] ?? [], byId),
    }))
  }, [termPlans, courses, activeCourses])

  // Parked plans' courses need sections for their units, and evaluations for their hours.
  const parkedIds = useMemo(
    () => [...new Set(columns.filter(c => c.label !== termPlans?.active).flatMap(c => c.courses.map(x => x.id)))],
    [columns, termPlans]
  )
  useEffect(() => {
    if (parkedIds.length === 0) return
    const { enrichedCourseIds, fetchCourseDetails } = useCourseStore.getState()
    const missing = parkedIds.filter(id => !enrichedCourseIds.has(id))
    if (missing.length > 0) fetchCourseDetails(missing)
    if (user) fetchBulkEvaluations(parkedIds)
  }, [parkedIds, user, fetchBulkEvaluations])

  const rows = useMemo(() => {
    const everywhere = columns.length === 0
      ? new Set<string>()
      : columns.map(c => new Set(c.courses.map(x => x.id))).reduce((a, b) => new Set([...a].filter(id => b.has(id))))
    return columns.map(({ label, courses: planCourses }) => {
      const hours = expectedWeeklyHours(planCourses, getEvaluations, loadingCourses)
      const rated = planCourses.filter(c => typeof c.quality === 'number')
      const rating = rated.length > 0 ? rated.reduce((sum, c) => sum + (c.quality as number), 0) / rated.length : null
      const differs = planCourses.filter(c => !everywhere.has(c.id)).map(codeOf)
      return {
        label,
        units: formatUnitRange(termUnitRange(planCourses, term)),
        hours: hours.loading && hours.total === null ? '…' : hours.total === null ? '0' : `~${hours.total.toFixed(0)}`,
        rating: rating === null ? '–' : rating.toFixed(1),
        differs,
      }
    })
    // `evaluations` is what changes when a fetch lands; getEvaluations reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, term, getEvaluations, loadingCourses, evaluations])

  if (!termPlans) return null

  const cell = 'px-3 py-2.5 text-right tabular-nums'
  const isActive = (label: string) => label === termPlans.active

  return (
    <div className="rounded-xl border bg-card overflow-x-auto shrink-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2" />
            {rows.map(r => (
              <th key={r.label} className={cn(cell, 'py-2 text-3xs uppercase font-semibold tracking-wider whitespace-nowrap', isActive(r.label) ? 'text-foreground' : 'text-muted-foreground')}>
                {isActive(r.label) ? `Plan ${r.label}` : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => switchPlan(term, r.label)}
                    className="h-auto p-0 text-3xs font-semibold uppercase tracking-wider hover:bg-transparent hover:text-foreground"
                  >
                    Plan {r.label}
                  </Button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {([
            ['Units', (r: (typeof rows)[number]) => r.units],
            ['Hours / week', (r: (typeof rows)[number]) => r.hours],
            ['Avg rating', (r: (typeof rows)[number]) => r.rating],
          ] as const).map(([name, read]) => (
            <tr key={name} className="border-b">
              <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{name}</td>
              {rows.map(r => (
                <td key={r.label} className={cn(cell, isActive(r.label) && 'font-semibold')}>{read(r)}</td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap align-top">Differs by</td>
            {rows.map(r => (
              <td key={r.label} className={cn('px-3 py-2.5 text-right align-top', isActive(r.label) && 'font-semibold')}>
                {r.differs.length === 0 ? '–' : r.differs.map(code => <div key={code} className="whitespace-nowrap">{code}</div>)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
