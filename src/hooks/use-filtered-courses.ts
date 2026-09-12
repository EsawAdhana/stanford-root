import React, { useMemo, useCallback } from 'react';
import { useCourseStore } from '@/lib/store';
import { useCartStore } from '@/lib/cart-store';
import { useQueryState, parseAsArrayOf, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs';
import { aggregateCrossListMetrics, compareCourseCodes, getCrossListPrimaryMap, normalizeCourseId, resolveToCanonicalPrimary, parseUnitsOptions } from '@/lib/utils';
import type { Course } from '@/types/course';
import { searchCourses } from '@/lib/search-utils';
import { filterCourses } from '@/lib/course-filter';
import { useSelectedTerms } from '@/hooks/use-selected-terms';

/**
 * The free-text query step, kept out of filterCourses because the list adds
 * cross-list primary inclusion on top of plain search. Extracted so the
 * visible list and the empty-state "hidden by" counts run the identical
 * pipeline — a second inlined copy is how those two drift apart.
 */
function applyQuery(result: Course[], query: string, courses: Course[], primaryMap: Map<string, string>): Course[] {
    if (!query) return result;
    const beforeSearch = result;
    result = searchCourses(result, query);
    // If the user searched for an alternate course code (e.g. "cs 238v"), include the primary course so it shows up
    const queryNorm = normalizeCourseId(query.trim().replace(/\s+/g, ''));
    if (queryNorm && primaryMap.has(queryNorm)) {
        const canonicalNorm = resolveToCanonicalPrimary(queryNorm, primaryMap);
        // Prefer primary from beforeSearch (so it passed term/dept etc.); fallback to full list so search always finds the course
        let primary = beforeSearch.find(c => normalizeCourseId(c.id) === canonicalNorm);
        if (!primary) {
            const withGrading = courses.filter(c => c.grading && c.grading.trim() !== '' && c.grading !== 'TBD');
            primary = withGrading.find(c => normalizeCourseId(c.id) === canonicalNorm);
        }
        if (primary && !result.some(c => c.id === primary!.id)) result = [...result, primary];
    }
    return result;
}

/**
 * Filters that narrow the list but never show up as a removable chip, so an
 * empty list gave no clue they were responsible. Searching "cs 448" under
 * Autumn 2026 with a 10:30 Mon/Wed class already in the schedule showed
 * "No courses match your search" with nothing to click; the one course was
 * hidden by Hide conflicting classes.
 */
export type HiddenByToggle = {
    key: string
    label: string
    count: number
    disable: () => void
}

export function useFilteredCourses() {
    const courses = useCourseStore(state => state.courses);
    const isLoading = useCourseStore(state => state.isLoading);
    const cartItems = useCartStore(state => state.items);

    const [query] = useQueryState('q', { defaultValue: '' });
    const [selectedDepts] = useQueryState('depts', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedTerms] = useSelectedTerms();
    const [selectedFormats] = useQueryState('formats', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedLevels] = useQueryState('levels', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedGers] = useQueryState('gers', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedSchools] = useQueryState('schools', parseAsArrayOf(parseAsString).withDefault([]));

    const [unitMin] = useQueryState('unitMin', parseAsInteger.withDefault(1));
    const [unitMax] = useQueryState('unitMax', parseAsInteger.withDefault(5));
    const [timeMin] = useQueryState('timeMin', parseAsInteger.withDefault(420));
    const [timeMax] = useQueryState('timeMax', parseAsInteger.withDefault(1320));
    const [hideConflicts, setHideConflicts] = useQueryState('hideConflicts', parseAsBoolean.withDefault(true));
    // Closed/waitlisted and study abroad (BOSP) courses are hidden by default.
    const [hideUnavailable, setHideUnavailable] = useQueryState('hideUnavailable', parseAsBoolean.withDefault(true));
    const [hideStudyAbroad, setHideStudyAbroad] = useQueryState('hideStudyAbroad', parseAsBoolean.withDefault(true));
    const [newOnly, setNewOnly] = useQueryState('newOnly', parseAsBoolean.withDefault(false));
    const [excludedWords] = useQueryState('exclude', parseAsArrayOf(parseAsString).withDefault([]));
    const [sortBy, setSortBy] = useQueryState('sort', parseAsString.withDefault('az'));
    const [sortOrder, setSortOrder] = useQueryState('order', parseAsString);

    // Default order per sort type: rating = high→low (desc), others = low→high (asc)
    const getDefaultOrderForSort = useCallback((s: string) =>
        (s === 'rating' ? 'desc' : 'asc') as 'asc' | 'desc', []);
    const effectiveSortOrder = sortOrder ?? getDefaultOrderForSort(sortBy);

    const primaryMap = useMemo(() => getCrossListPrimaryMap(courses), [courses]);

    const filteredResult = useMemo(() => {
        // Shared filter pipeline (also used by the sidebar facet counts) — applies
        // every filter except the free-text query, which is handled below.
        let result = filterCourses(courses, {
            excludedWords,
            selectedDepts,
            selectedTerms,
            selectedFormats,
            selectedLevels,
            selectedGers,
            selectedSchools,
            unitMin,
            unitMax,
            timeMin,
            timeMax,
            hideConflicts,
            hideUnavailable,
            hideStudyAbroad,
            newOnly,
        }, primaryMap, cartItems);

        result = applyQuery(result, query, courses, primaryMap);

        // All filtering is done; this is the set we will sort (sort is the last step)
        return result;
    }, [courses, primaryMap, query, selectedDepts, selectedTerms, selectedFormats, selectedLevels, selectedGers, selectedSchools, unitMin, unitMax, timeMin, timeMax, hideConflicts, hideUnavailable, hideStudyAbroad, newOnly, cartItems, excludedWords]);

    // Only runs when the list is empty, so the extra filter passes (at most one
    // per active toggle) never touch the common case.
    const hiddenByToggles = useMemo<HiddenByToggle[]>(() => {
        if (filteredResult.length > 0 || courses.length === 0) return [];
        const criteria = {
            excludedWords, selectedDepts, selectedTerms, selectedFormats, selectedLevels,
            selectedGers, selectedSchools, unitMin, unitMax, timeMin, timeMax,
            hideConflicts, hideUnavailable, hideStudyAbroad, newOnly,
        };
        const candidates: { key: string; label: string; active: boolean; off: Partial<typeof criteria>; disable: () => void }[] = [
            { key: 'hideConflicts', label: 'Hide conflicting classes', active: hideConflicts, off: { hideConflicts: false }, disable: () => setHideConflicts(false) },
            { key: 'hideUnavailable', label: 'Hide closed & waitlisted', active: hideUnavailable, off: { hideUnavailable: false }, disable: () => setHideUnavailable(false) },
            { key: 'hideStudyAbroad', label: 'Hide study abroad', active: hideStudyAbroad, off: { hideStudyAbroad: false }, disable: () => setHideStudyAbroad(false) },
            { key: 'newOnly', label: 'New courses only', active: newOnly, off: { newOnly: false }, disable: () => setNewOnly(null) },
        ];
        const out: HiddenByToggle[] = [];
        for (const c of candidates) {
            if (!c.active) continue;
            const count = applyQuery(
                filterCourses(courses, { ...criteria, ...c.off }, primaryMap, cartItems),
                query, courses, primaryMap,
            ).length;
            if (count > 0) out.push({ key: c.key, label: c.label, count, disable: c.disable });
        }
        return out;
    }, [filteredResult, courses, primaryMap, cartItems, query, excludedWords, selectedDepts, selectedTerms,
        selectedFormats, selectedLevels, selectedGers, selectedSchools, unitMin, unitMax, timeMin, timeMax,
        hideConflicts, hideUnavailable, hideStudyAbroad, newOnly,
        setHideConflicts, setHideUnavailable, setHideStudyAbroad, setNewOnly]);

    // Precompute hrs/unit, hrs/week and rating per course. Figures are pooled
    // across every code a cross-listed class is listed under (mean, not
    // last-one-wins), so all four listings of one class show the same numbers.
    const metricsByCourseId = useMemo(() => {
        const map = new Map<string, { hrsPerUnit?: number; hours?: number; quality?: number }>();
        const coursesById = new Map(courses.map(c => [c.id, c]));

        // Build canonical -> courseIds in group (one pass)
        const canonicalToIds = new Map<string, string[]>();
        for (const c of courses) {
            const canonical = resolveToCanonicalPrimary(normalizeCourseId(c.id), primaryMap);
            if (!canonicalToIds.has(canonical)) canonicalToIds.set(canonical, []);
            canonicalToIds.get(canonical)!.push(c.id);
        }

        // One aggregate per group, shared by all its members.
        const byCanonical = new Map<string, ReturnType<typeof aggregateCrossListMetrics>>();
        for (const [canonical, groupIds] of canonicalToIds) {
            const members = groupIds
                .map(id => coursesById.get(id))
                .filter((c): c is Course => c != null)
                .map(c => ({ hours: c.hours, quality: c.quality, units: c.units }));
            byCanonical.set(canonical, aggregateCrossListMetrics(members));
        }

        for (const course of courses) {
            const canonical = resolveToCanonicalPrimary(normalizeCourseId(course.id), primaryMap);
            const metrics = byCanonical.get(canonical);
            if (metrics && (metrics.hrsPerUnit != null || metrics.hours != null || metrics.quality != null)) {
                map.set(course.id, metrics);
            }
        }
        return map;
    }, [courses, primaryMap]);

    const displayCourses = useMemo(() => {
        if (filteredResult.length === 0) return [] as Course[];
        const effectiveSort = ['units', 'hrsPerWeek', 'hrsPerUnit', 'rating'].includes(sortBy) ? sortBy : 'az';
        const mult = effectiveSortOrder === 'desc' ? -1 : 1;
        return [...filteredResult].sort((a, b) => {
            const safeSubject = (x: Course) => (x?.subject ?? '').toString();
            const safeCode = (x: Course) => (x?.code ?? '').toString();
            const subjectCompare = safeSubject(a).localeCompare(safeSubject(b));
            const codeCompare = compareCourseCodes(safeCode(a), safeCode(b));
            const tiebreak = subjectCompare !== 0 ? subjectCompare : codeCompare;

            if (effectiveSort === 'az') {
                return mult * (subjectCompare !== 0 ? subjectCompare : codeCompare);
            }
            if (effectiveSort === 'units') {
                const optsA = parseUnitsOptions(a.units);
                const optsB = parseUnitsOptions(b.units);
                const hasA = optsA.length > 0;
                const hasB = optsB.length > 0;
                if (!hasA && !hasB) return tiebreak;
                if (!hasA) return 1;  // a (null) goes to bottom
                if (!hasB) return -1; // b (null) goes to bottom
                const minA = Math.min(...optsA);
                const minB = Math.min(...optsB);
                if (minA !== minB) return mult * (minA - minB);
                return tiebreak;
            }
            if (effectiveSort === 'hrsPerWeek') {
                const mA = metricsByCourseId.get(a.id);
                const mB = metricsByCourseId.get(b.id);
                const hrsA = mA?.hours;
                const hrsB = mB?.hours;
                const hasA = hrsA != null;
                const hasB = hrsB != null;
                if (!hasA && !hasB) return tiebreak;
                if (!hasA) return 1;
                if (!hasB) return -1;
                if (hrsA !== hrsB) return mult * (hrsA - hrsB);
                return tiebreak;
            }
            if (effectiveSort === 'hrsPerUnit') {
                const mA = metricsByCourseId.get(a.id);
                const mB = metricsByCourseId.get(b.id);
                const diffA = mA?.hrsPerUnit;
                const diffB = mB?.hrsPerUnit;
                const hasA = diffA != null;
                const hasB = diffB != null;
                if (!hasA && !hasB) return tiebreak;
                if (!hasA) return 1;
                if (!hasB) return -1;
                if (diffA !== diffB) return mult * (diffA - diffB);
                return tiebreak;
            }
            if (effectiveSort === 'rating') {
                const mA = metricsByCourseId.get(a.id);
                const mB = metricsByCourseId.get(b.id);
                const qA = mA?.quality;
                const qB = mB?.quality;
                const hasA = qA != null;
                const hasB = qB != null;
                if (!hasA && !hasB) return tiebreak;
                if (!hasA) return 1;
                if (!hasB) return -1;
                if (qA !== qB) return mult * (qA - qB);
                return tiebreak;
            }
            return mult * tiebreak;
        });
    }, [filteredResult, sortBy, effectiveSortOrder, metricsByCourseId]);

    const getSortDisplayValue = useCallback((course: Course): string | null => {
        const m = metricsByCourseId.get(course.id);
        const effectiveSort = ['units', 'hrsPerWeek', 'hrsPerUnit', 'rating'].includes(sortBy) ? sortBy : 'az';
        if (effectiveSort === 'hrsPerWeek' && m?.hours != null) return `${m.hours.toFixed(1)} hrs/wk`;
        if (effectiveSort === 'hrsPerUnit' && m?.hrsPerUnit != null) return `${m.hrsPerUnit.toFixed(1)} hrs/unit`;
        if (effectiveSort === 'rating') return null; // rating already shown on card
        if (effectiveSort === 'az' && m?.hrsPerUnit != null) return `${m.hrsPerUnit.toFixed(1)} hrs/unit`;
        return null;
    }, [metricsByCourseId, sortBy]);

    const getRatingForCourse = useCallback((course: Course): number | null => {
        const m = metricsByCourseId.get(course.id);
        return m?.quality ?? null;
    }, [metricsByCourseId]);

    const isEnriching = useCourseStore(state => state.isEnriching);

    const handleSetSortBy = useCallback((v: string) => {
        setSortBy(v);
        setSortOrder(getDefaultOrderForSort(v));
    }, [setSortBy, setSortOrder, getDefaultOrderForSort]);

    return { courses: displayCourses, hiddenByToggles, isLoading, isEnriching, getSortDisplayValue, getRatingForCourse, sortBy, setSortBy: handleSetSortBy, sortOrder: effectiveSortOrder, setSortOrder };
}
