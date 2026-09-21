import { useQueryStates, parseAsArrayOf, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs'
import { useCallback } from 'react'

/**
 * Single source of truth for "clear all filters". Setting every browse filter
 * param to null removes it from the URL, so each falls back to its default
 * (e.g. terms returns to the catalog default term). Shared by the filter chip
 * row and the empty-results state so recovery is one click everywhere.
 */
export function useResetFilters() {
  const [, setFilters] = useQueryStates({
    q: parseAsString.withDefault(''),
    depts: parseAsArrayOf(parseAsString).withDefault([]),
    terms: parseAsArrayOf(parseAsString).withDefault([]),
    formats: parseAsArrayOf(parseAsString).withDefault([]),
    levels: parseAsArrayOf(parseAsString).withDefault([]),
    gers: parseAsArrayOf(parseAsString).withDefault([]),
    schools: parseAsArrayOf(parseAsString).withDefault([]),
    exclude: parseAsArrayOf(parseAsString).withDefault([]),
    unitMin: parseAsInteger.withDefault(1),
    unitMax: parseAsInteger.withDefault(5),
    timeMin: parseAsInteger.withDefault(420),
    timeMax: parseAsInteger.withDefault(1320),
    hideConflicts: parseAsBoolean.withDefault(false),
    hideUnavailable: parseAsBoolean.withDefault(false),
    hideStudyAbroad: parseAsBoolean.withDefault(false),
    newOnly: parseAsBoolean.withDefault(false),
  })

  return useCallback(() => {
    setFilters({
      q: null,
      depts: null,
      terms: null,
      formats: null,
      levels: null,
      gers: null,
      schools: null,
      exclude: null,
      unitMin: null,
      unitMax: null,
      timeMin: null,
      timeMax: null,
      hideConflicts: null,
      hideUnavailable: null,
      hideStudyAbroad: null,
      newOnly: null,
    })
  }, [setFilters])
}
