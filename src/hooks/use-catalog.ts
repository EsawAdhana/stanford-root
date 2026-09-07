'use client'

import { useEffect } from 'react'
import { useCourseStore } from '@/lib/store'

/**
 * Loads the course catalog for a screen that actually shows courses.
 *
 * The store used to call `fetchCourses()` at module import, and the root layout
 * transitively imports the store — so a visitor who only saw `/`, `/privacy` or
 * `/terms` still downloaded the light catalog plus the ~3.3MB full payload and
 * paid the parse on the main thread. Worse, that work competed with the render
 * of pages that never needed it: the catalog at `/` is statically prerendered and served
 * from the CDN, yet real users saw TTFB p75 of 1272ms against an origin that
 * answers in ~110ms.
 *
 * `fetchCourses` is idempotent (in-flight guard plus a loaded check), so every
 * component that reads the catalog can safely ensure it.
 */
export function useEnsureCatalog(): void {
  const fetchCourses = useCourseStore(s => s.fetchCourses)
  useEffect(() => {
    void fetchCourses()
  }, [fetchCourses])
}
