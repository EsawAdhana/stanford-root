'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VList, VListHandle } from 'virtua';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { setPreferredTerms } from '@/lib/preferred-term';
import { useFilteredCourses } from '@/hooks/use-filtered-courses';
import { useInstructorSearch } from '@/hooks/use-instructor-search';
import { useCourseStore } from '@/lib/store';
import { CourseCard } from './course-card';
import { SearchX, ArrowUp, AlertCircle, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActiveFilterChips } from './active-filter-chips';
import { useResetFilters } from '@/hooks/use-reset-filters';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnsureCatalog } from '@/hooks/use-catalog';
const SCROLL_THRESHOLD = 200;
const SCROLL_STORAGE_KEY = 'course-list-scroll';

export function CourseList() {
    useEnsureCatalog();
  const { courses, isLoading, getSortDisplayValue, getRatingForCourse, sortBy, setSortBy, sortOrder, setSortOrder } = useFilteredCourses();
  const catalogError = useCourseStore(s => s.catalogError);
  const fetchCourses = useCourseStore(s => s.fetchCourses);
  const vListRef = useRef<VListHandle>(null);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const scrollOffsetRef = useRef(0);
  const hasRestoredScroll = useRef(false);

  // Map letter -> first index for A-Z scrubber
  const letterToIndex = useMemo(() => {
    const map = new Map<string, number>()
    courses.forEach((c, i) => {
      const firstChar = (c.subject || c.code || '')[0]?.toUpperCase()
      const letter = /[A-Z]/.test(firstChar) ? firstChar : '#'
      if (!map.has(letter)) map.set(letter, i)
    })
    return map
  }, [courses])

  // Only letters that have courses, sorted (# first, then A-Z)
  const existingLetters = useMemo(() => {
    const letters = Array.from(letterToIndex.keys())
    return letters.sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
  }, [letterToIndex])

  const scrollToLetter = useCallback((letter: string) => {
    const index = letterToIndex?.get(letter)
    if (index != null && vListRef.current) {
      vListRef.current.scrollToIndex(index, { align: 'start' })
    }
  }, [letterToIndex])

  const searchParams = useSearchParams();
  const resetFilters = useResetFilters();

  const selectedTermParam = searchParams.get('terms');

  const searchQuery = searchParams.get('q') ?? '';
  const hasSearchQuery = searchQuery.trim().length > 0;
  // Only fires when the query is someone's actual name, so there is nothing to
  // toggle off: "math" returns classes, "mathews" returns the person too.
  const instructorMatches = useInstructorSearch(searchQuery);
  const FILTER_PARAM_KEYS = ['q', 'depts', 'terms', 'formats', 'levels', 'gers', 'schools', 'exclude', 'unitMin', 'unitMax', 'timeMin', 'timeMax', 'hideConflicts', 'hideUnavailable'];
  const hasAnyFilter = FILTER_PARAM_KEYS.some(k => searchParams.has(k));

  const prefetchCourseDetail = useCallback((courseId: string) => {
    const state = useCourseStore.getState();
    // Skip enriched courses (fetchCourseDetail would no-op, but this avoids the
    // call entirely) and known-failed ids, so a failing course doesn't refetch
    // on every hover. The detail page has its own explicit retry.
    if (state.enrichedCourseIds.has(courseId) || state.failedDetailIds.has(courseId)) return;
    state.fetchCourseDetail(courseId);
  }, []);

  const saveScrollOnClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.button === 1) return; // New tab — no scroll save
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(SCROLL_STORAGE_KEY, String(scrollOffsetRef.current));
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Hand the browsed term to the course page out-of-band so the Sections panel opens on
  // it without the term appearing in the course URL. Stable identity: CourseCard is
  // memoized and an inline closure would re-render every card on each keystroke.
  const openCourse = useCallback((e: React.MouseEvent) => {
    setPreferredTerms(selectedTermParam ? selectedTermParam.split(',') : null);
    saveScrollOnClick(e);
  }, [selectedTermParam, saveScrollOnClick]);

  // Restore scroll position when returning via back navigation
  useEffect(() => {
    if (courses.length === 0 || hasRestoredScroll.current) return;
    if (typeof window === 'undefined') return;
    const saved = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (saved == null) return;
    hasRestoredScroll.current = true;
    sessionStorage.removeItem(SCROLL_STORAGE_KEY);
    const offset = parseInt(saved, 10);
    if (isNaN(offset) || offset < 0) return;
    const raf = requestAnimationFrame(() => {
      vListRef.current?.scrollTo(offset);
    });
    return () => cancelAnimationFrame(raf);
  }, [courses.length]);


  if (isLoading) {
    return (
      <div className="flex-1 h-full w-full overflow-hidden flex flex-col relative">
        <div className="shrink-0 border-b border-border/30 bg-background z-10 flex items-center gap-1 flex-nowrap py-2 pl-2 pr-2">
          <div className="h-7 flex-1 rounded-md bg-muted/50 animate-pulse" />
          <div className="h-5 w-16 rounded bg-muted/50 animate-pulse" />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2 space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full w-full overflow-hidden flex flex-col relative">
      {/* Results bar */}
      <div className="shrink-0 overflow-hidden border-b border-border/30 bg-background z-10 pt-1 pb-0.5 px-2 sm:px-4 text-xs font-medium text-muted-foreground transition-all duration-300 leading-normal">
        <div className="flex flex-col gap-2 min-w-0 w-full">
            {/* Row 1: Mobile = Sort by line + (Order + count) line; Desktop = Sort by | Order | count with consistent gaps */}
            <div className="flex flex-row flex-wrap gap-x-4 sm:gap-x-0 sm:gap-y-0 gap-y-2 items-center w-full min-w-0">
              {/* Sort by — full width on mobile, flex-1 on desktop; pr-6 = spacing from bubble to Order */}
              <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1 sm:pr-6">
                <label htmlFor="sort-by" className="h-8 flex shrink-0 items-center justify-end text-xs text-muted-foreground whitespace-nowrap w-14">
                  Sort by:
                </label>
                <Select
                  value={['az', 'units', 'hrsPerWeek', 'hrsPerUnit', 'rating'].includes(sortBy) ? sortBy : 'az'}
                  onValueChange={(v) => setSortBy(v)}
                >
                  <SelectTrigger id="sort-by" className="h-8 min-w-0 flex-1 sm:min-w-[160px] text-xs px-3 ml-1 mr-0 sm:mx-0 [&>span]:line-clamp-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="az">Alphabetical</SelectItem>
                    <SelectItem value="rating">Course Rating</SelectItem>
                    <SelectItem value="units">Units</SelectItem>
                    <SelectItem value="hrsPerWeek">Hrs/Wk</SelectItem>
                    <SelectItem value="hrsPerUnit">Difficulty (Hrs/Unit)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Order — flex-1 on desktop; pr-6 = spacing from bubble to class count (matches Sort by) */}
              <div className="flex items-center gap-2 min-w-0 flex-1 sm:pr-6">
                <label htmlFor="sort-order" className="h-8 flex shrink-0 items-center justify-end text-xs text-muted-foreground whitespace-nowrap w-14">
                  Order:
                </label>
                <Select
                  value={sortOrder}
                  onValueChange={(v) => setSortOrder(v)}
                >
                  <SelectTrigger id="sort-order" className="h-8 min-w-0 flex-1 sm:min-w-[120px] text-xs px-3 mx-1 sm:mx-0 [&>span]:line-clamp-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortBy === 'az' && (
                      <>
                        <SelectItem value="asc">A–Z</SelectItem>
                        <SelectItem value="desc">Z–A</SelectItem>
                      </>
                    )}
                    {(sortBy === 'units' || sortBy === 'hrsPerWeek' || sortBy === 'hrsPerUnit') && (
                      <>
                        <SelectItem value="asc">Low → High</SelectItem>
                        <SelectItem value="desc">High → Low</SelectItem>
                      </>
                    )}
                    {sortBy === 'rating' && (
                      <>
                        <SelectItem value="desc">High → Low</SelectItem>
                        <SelectItem value="asc">Low → High</SelectItem>
                      </>
                    )}
                    {!['az', 'units', 'hrsPerWeek', 'hrsPerUnit', 'rating'].includes(sortBy) && (
                      <>
                        <SelectItem value="asc">A–Z</SelectItem>
                        <SelectItem value="desc">Z–A</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <span className="h-8 flex items-center text-xs tabular-nums font-semibold text-foreground/70 whitespace-nowrap shrink-0 ml-auto">
                {courses.length.toLocaleString('en-US')} {courses.length === 1 ? 'class' : 'classes'}
              </span>
            </div>
            {/* Row 2: Filters only */}
            <div className="flex flex-row flex-wrap items-center gap-2 min-w-0 overflow-hidden">
              <ActiveFilterChips />
            </div>
          </div>
        </div>

      {instructorMatches.length > 0 && (
        <div className="shrink-0 border-b border-border/30 bg-background px-2 sm:px-4 py-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 pl-1">
            Instructors
          </div>
          <div className="flex flex-col gap-1">
            {instructorMatches.map((instructor) => (
              <Link
                key={instructor.slug}
                href={`/instructors/${instructor.slug}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[15px] font-semibold text-foreground hover:bg-secondary/40 transition-colors"
              >
                <User size={14} className="text-muted-foreground shrink-0" />
                <span className="truncate">{instructor.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {courses.length === 0 ? (
          catalogError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <AlertCircle size={32} className="text-muted-foreground/40" />
              <p className="text-sm font-medium">Couldn&apos;t load courses.</p>
              <p className="text-xs text-muted-foreground/60">Check your connection and try again.</p>
              <Button size="sm" variant="outline" onClick={() => fetchCourses()} className="mt-1">Retry</Button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <SearchX size={32} className="text-muted-foreground/30" />
              <p className="text-sm font-medium">
                {hasSearchQuery ? 'No courses match your search.' : 'No courses match your filters.'}
              </p>
              <p className="text-xs text-muted-foreground/60">
                {hasSearchQuery ? 'Try a different search or clearing your filters.' : 'Try adjusting your filters.'}
              </p>
              {hasAnyFilter && (
                <Button size="sm" variant="outline" onClick={resetFilters} className="mt-1">Clear all filters</Button>
              )}
            </div>
          )
        ) : (
          <>
            {/* List area — full width when A-Z (scrubber overlays); otherwise flex-1 */}
            <div className="flex-1 min-w-0 relative overflow-hidden">
              {showJumpTop && (
                <button
                  type="button"
                  onClick={() => vListRef.current?.scrollTo(0)}
                  className="absolute top-0 right-6 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-bl-md bg-primary text-primary-foreground text-xs font-medium shadow-md hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring animate-in fade-in slide-in-from-top-2 duration-200"
                  aria-label="Jump to top"
                >
                  <ArrowUp size={14} strokeWidth={2.5} />
                  <span>Top</span>
                </button>
              )}
              <VList
                ref={vListRef}
                className={`h-full w-full scrollbar-hide pb-24 px-2 sm:px-4 ${sortBy === 'az' ? 'pr-6 sm:pr-7' : ''}`}
                onScroll={(offset) => {
                  scrollOffsetRef.current = offset;
                  const shouldShow = offset > SCROLL_THRESHOLD;
                  setShowJumpTop(prev => (prev === shouldShow ? prev : shouldShow));
                }}
              >
                {courses.map((course) => (
                  <div key={course.id} className="w-full">
                  <CourseCard
                    course={course}
                    // A course URL is just the course: /CS106A. The catalog filters used to
                    // ride along, which left shareable links like ?q=mark&hideConflicts=false.
                    // Nothing on the detail page needs them -- `terms` only pre-selected the
                    // Sections tab, which now falls back to getDefaultTerm -- and Back still
                    // returns to the filtered catalog view, because that URL is in history.
                    href={`/${encodeURIComponent(course.id)}`}
                    sortDisplayValue={getSortDisplayValue(course)}
                    rating={getRatingForCourse(course)}
                    onClick={openCourse}
                    onHoverPrefetch={prefetchCourseDetail}
                  />
                  </div>
                ))}
              </VList>

              {/* A-Z scrubber — overlay when sorted A-Z, gives cards more width */}
              {sortBy === 'az' && letterToIndex && existingLetters.length > 0 && (
                <div className="absolute right-0 top-0 bottom-0 w-5 flex flex-col items-center justify-center py-2 z-10 bg-background/80 backdrop-blur-[2px]">
                  <div
                    role="navigation"
                    aria-label="Jump to letter"
                    className="flex flex-col items-center gap-0.5"
                  >
                    {existingLetters.map((letter) => (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => scrollToLetter(letter)}
                        className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        aria-label={`Jump to ${letter === '#' ? 'numbers/symbols' : letter}`}
                      >
                        {letter}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
