'use client';

import React, { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { AccountButton } from '@/components/account-button';
import { useEnsureCatalog } from '@/hooks/use-catalog';
import { useCourseStore } from '@/lib/store';
import { useAuthStore } from '@/lib/auth-store';
import { useEvaluationStore } from '@/lib/evaluation-store';
import { readShareLink } from '@/lib/share-link';
import { expectedWeeklyHours, formatUnitRange, formatWeeklyHours, termUnitRange } from '@/lib/schedule-totals';
import { StatsTable } from '@/components/schedule-stats';
import type { CartItem } from '@/lib/cart-store';

const CalendarView = dynamic(
  () => import('@/components/calendar-view').then(m => ({ default: m.CalendarView })),
  { ssr: false }
);

/** Someone's schedule, from the classes carried in a share link. Nothing here can change it. */
export function SharedScheduleView() {
  useEnsureCatalog()
  const params = useSearchParams()
  const shared = useMemo(() => readShareLink(params), [params])
  const courses = useCourseStore(s => s.courses)
  const hasLoaded = useCourseStore(s => s.hasLoaded)
  const user = useAuthStore(s => s.user)

  const items = useMemo<CartItem[]>(() => {
    if (!shared) return []
    const byId = new Map(courses.map(c => [c.id, c]))
    return shared.entries.flatMap(entry => {
      const course = byId.get(entry.id)
      if (!course) return []
      return [{
        ...course,
        selectedTerm: shared.term,
        selectedSectionIds: entry.selectedSectionIds,
        selectedUnits: entry.selectedUnits,
      }]
    })
  }, [shared, courses])

  // Sections come with the full catalog; ask for these courses' first, as the schedule page does.
  useEffect(() => {
    if (!hasLoaded || items.length === 0) return
    const { enrichedCourseIds, fetchCourseDetails } = useCourseStore.getState()
    const ids = items.map(i => i.id).filter(id => !enrichedCourseIds.has(id))
    if (ids.length > 0) fetchCourseDetails(ids)
  }, [items, hasLoaded])

  const fetchBulkEvaluations = useEvaluationStore(s => s.fetchBulkEvaluations)
  const getEvaluations = useEvaluationStore(s => s.getEvaluations)
  const loadingCourses = useEvaluationStore(s => s.loadingCourses)
  const evaluations = useEvaluationStore(s => s.evaluations)
  useEffect(() => {
    if (user && items.length > 0) fetchBulkEvaluations(items.map(i => i.id))
  }, [user, items, fetchBulkEvaluations])

  const units = useMemo(() => (shared ? termUnitRange(items, shared.term) : { min: 0, max: 0 }), [items, shared])
  const hours = useMemo(
    () => expectedWeeklyHours(items, getEvaluations, loadingCourses),
    // `evaluations` is what changes when a fetch lands; getEvaluations reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, getEvaluations, loadingCourses, evaluations]
  )

  const unreadable = shared && hasLoaded ? shared.entries.length - items.length + shared.skipped : 0

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex-none h-16 border-b bg-card">
        <div className="h-full w-full max-w-shell mx-auto px-4 md:px-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 px-2 py-1 -ml-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <Logo className="h-8 w-8 md:h-10 md:w-10" />
            <span className="font-display text-2xl md:text-3xl tracking-tight text-foreground select-none">Stanford Root</span>
          </Link>
          <div className="flex items-center gap-3 ml-auto">
            <ThemeToggle />
            <AccountButton />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 md:px-6 pt-4 md:pt-6 pb-16 md:pb-20">
        <div className="min-h-full w-full max-w-content mx-auto flex flex-col">
          {!shared ? (
            <div className="mx-auto mt-16 max-w-sm rounded-xl border bg-card p-6 text-center">
              <p className="font-medium">This share link doesn&apos;t have a schedule in it</p>
              <p className="mt-1 text-sm text-muted-foreground">
                It may have been cut off when it was pasted. Ask for the link again.
              </p>
              <Link href="/" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                Browse Stanford courses
              </Link>
            </div>
          ) : !hasLoaded ? (
            <div className="h-[min(70vh,720px)] rounded-xl border border-border/40 bg-muted/20 animate-pulse" />
          ) : (
            <>
            {/* Styled like the planner's plan tabs, with one tab: this schedule is
                someone's to look at, not a plan to edit. It runs the full width, so
                the calendar and the totals beside it start level, as on the planner. */}
            <div className="mb-2 flex w-full items-center border-b border-border/40">
              <span className="inline-flex items-center whitespace-nowrap border-b-2 border-primary py-2 text-sm font-semibold text-foreground">
                Shared schedule
              </span>
            </div>
            <CalendarView
              currentTerm={shared.term}
              readOnly
              items={items}
              totalUnitsMax={units.max}
              isOverload={false}
              isIgnored
              onIgnoreOverload={() => {}}
              aboveCalendar={unreadable > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {unreadable === 1
                    ? "1 class in this link couldn't be found in the catalog, so it isn't shown."
                    : `${unreadable} classes in this link couldn't be found in the catalog, so they aren't shown.`}
                </p>
              ) : undefined}
              stats={
                <StatsTable
                  columns={[{
                    key: 'shared',
                    units: formatUnitRange(units),
                    hours: formatWeeklyHours(hours),
                  }]}
                />
              }
            />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
