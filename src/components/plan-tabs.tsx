'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { expectedWeeklyHours, formatUnitRange, formatWeeklyHours, termUnitRange } from '@/lib/schedule-totals';
import type { SavedItem } from '@/lib/schedule-plans';
import { StatsTable, type StatsColumn } from '@/components/schedule-stats';

const codeOf = (c: { subject: string; code: string }) => `${c.subject} ${c.code}`

function joinCodes(codes: string[]): string {
  if (codes.length <= 2) return codes.join(' and ')
  return `${codes.slice(0, -1).join(', ')}, and ${codes[codes.length - 1]}`
}

/**
 * Whether plans can be switched yet. A switch rebuilds the plan's classes from
 * the catalog, so before it has courses (still loading, or failed to load) every
 * class would drop out. The store refuses too; this keeps the controls honest.
 */
function useCanSwitchPlans(): boolean {
  return useCourseStore(s => s.hasLoaded && s.courses.length > 0)
}

/** Switches the term's plan, from the tabs or the stats table's headings alike. */
function useSwitchPlan(term: string) {
  const switchPlan = useCartStore(s => s.switchPlan)
  return useCallback((label: string) => {
    const plans = useCartStore.getState().plans[term]?.order.length ?? 1
    const moved = switchPlan(term, label)
    track('plan_switched', { plans })
    if (moved.length > 0) {
      const codes = joinCodes(moved.map(codeOf))
      toast(`${codes} moved to ${term}, since Plan ${label} has ${moved.length === 1 ? 'it' : 'them'} and a class sits on one term at a time.`)
    }
  }, [term, switchPlan])
}

/** Plan A, Plan B, ... above the calendar, for the term on screen. */
export function PlanTabs({ term }: { term: string }) {
  const termPlans = useCartStore(s => s.plans[term])
  const items = useCartStore(s => s.items)
  const createPlan = useCartStore(s => s.createPlan)
  const deletePlan = useCartStore(s => s.deletePlan)
  const canSwitch = useCanSwitchPlans()
  const onSwitch = useSwitchPlan(term)

  const order = termPlans?.order ?? ['A']
  const active = termPlans?.active ?? 'A'
  const activeCount = items.filter(i => i.selectedTerm === term).length

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
              disabled={!canSwitch}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 py-2 text-sm font-semibold text-muted-foreground data-[state=active]:text-foreground transition-colors hover:text-foreground/80"
            >
              Plan {label}
            </TabsTrigger>
            {label === active && order.length > 1 && (
              <DeletePlan label={label} count={activeCount} disabled={!canSwitch} onDelete={() => onDelete(label)} />
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={onCreate}
          disabled={!canSwitch}
          className="shrink-0 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          + New plan
        </button>
      </TabsList>
    </Tabs>
  )
}

function DeletePlan({ label, count, disabled, onDelete }: { label: string; count: number; disabled: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Delete Plan ${label}`}
          // Deleting the plan on screen brings its neighbour up from the catalog.
          disabled={disabled}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
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
 * Units and hours for each plan of the term, Plan A alone until
 * there is a Plan B. The plan on screen takes the page's own hours figure, which
 * holds its last value through a refetch, so its column never flickers.
 */
export function PlanStats({ term, activeCourses, activeHours, overUnits }: {
  term: string
  activeCourses: CartItem[]
  activeHours: { total: number | null; loading: boolean }
  /** The plan on screen is over the unit limit and the warning wasn't dismissed. */
  overUnits: boolean
}) {
  const termPlans = useCartStore(s => s.plans[term])
  const onSwitch = useSwitchPlan(term)
  const canSwitch = useCanSwitchPlans()
  const courses = useCourseStore(s => s.courses)
  const user = useAuthStore(s => s.user)
  const fetchBulkEvaluations = useEvaluationStore(s => s.fetchBulkEvaluations)
  const getEvaluations = useEvaluationStore(s => s.getEvaluations)
  const loadingCourses = useEvaluationStore(s => s.loadingCourses)
  const evaluations = useEvaluationStore(s => s.evaluations)

  const active = termPlans?.active ?? 'A'
  const plans = useMemo(() => {
    if (!termPlans) return [{ label: 'A', courses: activeCourses }]
    const byId = new Map(courses.map(c => [c.id, c as CartItem]))
    return termPlans.order.map(label => ({
      label,
      courses: label === termPlans.active ? activeCourses : displayCourses(termPlans.parked[label] ?? [], byId),
    }))
  }, [termPlans, courses, activeCourses])

  // Parked plans' courses need sections for their units, and evaluations for their hours.
  const parkedIds = useMemo(
    () => [...new Set(plans.filter(p => p.label !== active).flatMap(p => p.courses.map(c => c.id)))],
    [plans, active]
  )
  useEffect(() => {
    if (parkedIds.length === 0) return
    const { enrichedCourseIds, fetchCourseDetails } = useCourseStore.getState()
    const missing = parkedIds.filter(id => !enrichedCourseIds.has(id))
    if (missing.length > 0) fetchCourseDetails(missing)
    if (user) fetchBulkEvaluations(parkedIds)
  }, [parkedIds, user, fetchBulkEvaluations])

  const columns = useMemo<StatsColumn[]>(() => plans.map(({ label, courses: planCourses }) => {
    const isActive = label === active
    return {
      key: label,
      heading: isActive ? `Plan ${label}` : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canSwitch}
          onClick={() => onSwitch(label)}
          className="h-auto p-0 text-3xs font-semibold uppercase tracking-wider hover:bg-transparent hover:text-foreground"
        >
          Plan {label}
        </Button>
      ),
      // A parked plan's classes come from the catalog: until it has courses,
      // its totals are unknown, not zero.
      units: isActive || canSwitch ? formatUnitRange(termUnitRange(planCourses, term)) : '…',
      hours: isActive
        ? formatWeeklyHours(activeHours)
        : canSwitch ? formatWeeklyHours(expectedWeeklyHours(planCourses, getEvaluations, loadingCourses)) : '…',
      active: isActive,
      overUnits: isActive && overUnits,
    }
  }),
  // `evaluations` is what changes when a fetch lands; getEvaluations reads it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [plans, active, term, activeHours, overUnits, onSwitch, canSwitch, getEvaluations, loadingCourses, evaluations])

  return <StatsTable columns={columns} />
}
