'use client'

import { useEffect, useMemo, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { useCartStore } from '@/lib/cart-store'
import { useCourseStore } from '@/lib/store'
import { findAffectedSchedule } from '@/lib/unresolved-schedule'
import { track } from '@/lib/analytics'

/**
 * Root's class data now comes from Navigator (the same PeopleSoft records Axess
 * enrolls from) rather than ExploreCourses. A few dozen courses ExploreCourses
 * listed for 2026-27 have no class in Navigator yet, and some section numbers
 * moved, so a handful of saved schedules point at something that is no longer
 * there. Tell those people rather than letting a course quietly vanish.
 *
 * Only shows when this specific schedule is affected. Bump the key if the
 * wording changes so it re-shows.
 */
const STORAGE_KEY = 'root_catalog_source_navigator_dismissed'

export function ScheduleSourceNotice() {
  const items = useCartStore(s => s.items)
  const courses = useCourseStore(s => s.courses)
  const hasLoaded = useCourseStore(s => s.hasLoaded)
  const unresolved = useCartStore(s => s.unresolved)

  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // localStorage unavailable (private mode, etc.) — just show it.
      setDismissed(false)
    }
  }, [])

  const { missing, movedSections } = useMemo(
    () => (hasLoaded ? findAffectedSchedule(items, courses, unresolved) : { missing: [], movedSections: [] }),
    [items, courses, hasLoaded, unresolved],
  )

  // A course that lost its listing and one that lost the section you picked are
  // the same problem to the person reading this: check it before you enroll.
  const affected = useMemo(
    () => [...new Set([...missing, ...movedSections])].sort(),
    [missing, movedSections],
  )

  const visible = !dismissed && affected.length > 0

  useEffect(() => {
    if (visible) {
      track('schedule_source_notice_shown', { missing: missing.length, movedSections: movedSections.length })
    }
  }, [visible, missing.length, movedSections.length])

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Ignore persistence failures; worst case it shows again next visit.
    }
    setDismissed(true)
  }

  if (!visible) return null

  return (
    <div className="relative border-b border-cardinal-red/25 border-l-4 border-l-cardinal-red bg-cardinal-red/5 px-4 py-2.5 pr-10 text-sm text-foreground dark:border-cardinal-red-light/40 dark:border-l-cardinal-red-light dark:bg-cardinal-red-light/10">
      <div className="mx-auto flex max-w-5xl items-start gap-2.5">
        <Megaphone
          className="mt-0.5 h-4 w-4 shrink-0 text-cardinal-red dark:text-cardinal-red-light"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-relaxed">
          <span className="font-semibold text-cardinal-red dark:text-cardinal-red-light">
            Heads up:
          </span>{' '}
          Stanford Root now reads courses from Navigator, to better reflect
          what you&rsquo;ll see in Navigate Enrollment. Some of your planned
          courses / sections ({affected.join(', ')}) may no longer be available.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-cardinal-red/10 hover:text-cardinal-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-cardinal-red-light"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
