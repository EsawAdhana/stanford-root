'use client';

import React, { useMemo, useState } from 'react';
import { useCourseStore } from '@/lib/store';
import { useCartStore } from '@/lib/cart-store';
import { useQueryState, parseAsArrayOf, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs';
import { cn, getSchoolFromSubject, abbreviateGer, unitsLabel, formatComponent, isAllowedGer, formatLevel, parseUnitsOptions, getCrossListPrimaryMap } from '@/lib/utils';
import { searchCourses } from '@/lib/search-utils';
import { filterCoursesForFacets, COUNTED_FACET_KEYS, type CourseFilterCriteria } from '@/lib/course-filter';
import { formatMinutes } from '@/lib/schedule-utils';
import { compareTerms } from '@/lib/terms';
import { useSelectedTerms } from '@/hooks/use-selected-terms';
import type { Course } from '@/types/course';
import { CheckboxItem, FilterGroup } from '@/components/ui/filter-components';
import { Input } from '@/components/ui/input';
import { Search, Plus, X, ChevronDown, ChevronRight, Check, Minus } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'


// Manual ScrollArea since I didn't install shadcn ScrollArea
const SimpleScrollArea = ({ className, children }: { className?: string, children: React.ReactNode }) => (
    <div className={cn("overflow-auto custom-scrollbar", className)}>
        {children}
    </div>
);

// Helper for collapsible sections
const FilterSection = ({
    title,
    children,
    defaultOpen = false,
    hasActive = false
}: {
    title: string,
    children: React.ReactNode,
    defaultOpen?: boolean,
    hasActive?: boolean
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="group flex w-full cursor-pointer items-center justify-between rounded-sm py-2.5 px-1 text-left hover:bg-secondary/50 focus:outline-none focus-visible:ring-0 min-h-[2.5rem]"
                >
                    <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">{title}</h3>
                        {hasActive && !isOpen && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                        )}
                    </div>
                    {isOpen ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1">
                {children}
            </CollapsibleContent>
        </Collapsible>
    );
};


export function FilterSidebar() {
    const courses = useCourseStore(state => state.courses);
    const cartItems = useCartStore(state => state.items);

    // State
    const [query] = useQueryState('q', { defaultValue: '' });
    const [selectedDepts, setSelectedDepts] = useQueryState('depts', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedTerms, setSelectedTerms] = useSelectedTerms();
    const [hideConflicts, setHideConflicts] = useQueryState('hideConflicts', parseAsBoolean.withDefault(true));
    // Closed/waitlisted and study abroad (BOSP) courses are hidden by default.
    const [hideUnavailable, setHideUnavailable] = useQueryState('hideUnavailable', parseAsBoolean.withDefault(true));
    const [hideStudyAbroad, setHideStudyAbroad] = useQueryState('hideStudyAbroad', parseAsBoolean.withDefault(true));
    const [newOnly, setNewOnly] = useQueryState('newOnly', parseAsBoolean.withDefault(false));
    const [excludedWords, setExcludedWords] = useQueryState('exclude', parseAsArrayOf(parseAsString).withDefault([]));

    // New Filters
    const [selectedFormats, setSelectedFormats] = useQueryState('formats', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedLevels, setSelectedLevels] = useQueryState('levels', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedGers, setSelectedGers] = useQueryState('gers', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedSchools, setSelectedSchools] = useQueryState('schools', parseAsArrayOf(parseAsString).withDefault([]));

    // Single Selects (Dropdowns) -> Now Multi Selects (Checkboxes)
    const [unitMin, setUnitMin] = useQueryState('unitMin', parseAsInteger.withDefault(1));
    const [unitMax, setUnitMax] = useQueryState('unitMax', parseAsInteger.withDefault(5));
    const [timeMin, setTimeMin] = useQueryState('timeMin', parseAsInteger.withDefault(420));
    const [timeMax, setTimeMax] = useQueryState('timeMax', parseAsInteger.withDefault(1320));
    // Debounced Local State for Sliders (fixes dragging lag)
    const [localUnitMin, setLocalUnitMin] = useState(unitMin);
    const [localUnitMax, setLocalUnitMax] = useState(unitMax);
    const [localTimeMin, setLocalTimeMin] = useState(timeMin);
    const [localTimeMax, setLocalTimeMax] = useState(timeMax);

    React.useEffect(() => {
        setLocalUnitMin(unitMin);
        setLocalUnitMax(unitMax);
        setLocalTimeMin(timeMin);
        setLocalTimeMax(timeMax);
    }, [unitMin, unitMax, timeMin, timeMax]);

    // Debounce pushing Local -> Global
    React.useEffect(() => {
        const handler = setTimeout(() => {
            if (localUnitMin !== unitMin) setUnitMin(localUnitMin);
            if (localUnitMax !== unitMax) setUnitMax(localUnitMax);
            if (localTimeMin !== timeMin) setTimeMin(localTimeMin);
            if (localTimeMax !== timeMax) setTimeMax(localTimeMax);
        }, 300); // 300ms debounce
        return () => clearTimeout(handler);
    }, [localUnitMin, localUnitMax, localTimeMin, localTimeMax, setUnitMin, setUnitMax, setTimeMin, setTimeMax, unitMin, unitMax, timeMin, timeMax]);

    const [deptQuery, setDeptQuery] = useState('');
    const [excludeInput, setExcludeInput] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [waysExpanded, setWaysExpanded] = useState(false);

    const primaryMap = useMemo(() => getCrossListPrimaryMap(courses), [courses]);

    // Shared filter criteria (same pipeline as the visible course list)
    const facetCriteria = useMemo<CourseFilterCriteria>(() => ({
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
    }), [excludedWords, selectedDepts, selectedTerms, selectedFormats, selectedLevels, selectedGers, selectedSchools, unitMin, unitMax, timeMin, timeMax, hideConflicts, hideUnavailable, hideStudyAbroad, newOnly]);

    // Per-facet course lists (each facet's own selection omitted), computed in
    // ONE pass over the catalog instead of one full filter pass per facet.
    const facetLists = useMemo(
        () => filterCoursesForFacets(courses, facetCriteria, primaryMap, cartItems),
        [courses, facetCriteria, primaryMap, cartItems]
    );

    // Apply the search query per facet list. Facets with no active selection
    // share the same array instance, so identity-dedupe keeps this to a single
    // search in the common case.
    const searchedFacetLists = useMemo(() => {
        if (!query) return facetLists;
        const searchedByList = new Map<Course[], Course[]>();
        const out = {} as typeof facetLists;
        for (const key of COUNTED_FACET_KEYS) {
            const list = facetLists[key];
            let searched = searchedByList.get(list);
            if (!searched) {
                searched = searchCourses(list, query);
                searchedByList.set(list, searched);
            }
            out[key] = searched;
        }
        return out;
    }, [facetLists, query]);

    // Compute Facets based on filtered courses
    const facets = useMemo(() => {
        const depts = new Map<string, number>();
        const terms = new Map<string, number>();

        // New Facets
        const formats = new Map<string, number>();
        const levels = new Map<string, number>();
        const gers = new Map<string, number>();
        const schools = new Map<string, number>();

        // Filtered courses per facet type (that facet's own filter excluded)
        const coursesForDepts = searchedFacetLists.depts;
        const coursesForTerms = searchedFacetLists.terms;
        const coursesForFormats = searchedFacetLists.formats;
        const coursesForLevels = searchedFacetLists.levels;
        const coursesForGers = searchedFacetLists.gers;
        const coursesForSchools = searchedFacetLists.schools;

        // Compute dept facets
        coursesForDepts.forEach(c => {
            depts.set(c.subject, (depts.get(c.subject) || 0) + 1);
        });

        // Compute term facets
        coursesForTerms.forEach(c => {
            if (c.terms) {
                c.terms.forEach(t => terms.set(t, (terms.get(t) || 0) + 1));
            }
        });

        // Compute format facets
        coursesForFormats.forEach(c => {
            const uniqueComponents = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if (s.component) uniqueComponents.add(s.component);
                });
            }
            uniqueComponents.forEach(comp => formats.set(comp, (formats.get(comp) || 0) + 1));
        });


        // Compute level facets (normalize UG/UNDERGRAD -> Undergrad, etc.); infer from course code when sections lack classLevel
        coursesForLevels.forEach(c => {
            const uniqueLevels = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if (s.classLevel && String(s.classLevel).trim()) uniqueLevels.add(formatLevel(s.classLevel));
                });
            }
            if (uniqueLevels.size === 0) uniqueLevels.add(formatLevel(c.code || ''));
            uniqueLevels.forEach(lvl => { if (lvl !== 'N/A') levels.set(lvl, (levels.get(lvl) || 0) + 1); });
        });

        // Compute GER facets (only allowed GERs: WAYS, WIM, PWR, COLLEGE, Language)
        coursesForGers.forEach(c => {
            const uniqueGers = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if (s.gers) s.gers.forEach(g => {
                        if (isAllowedGer(g)) uniqueGers.add(g);
                    });
                });
            }
            uniqueGers.forEach(g => gers.set(g, (gers.get(g) || 0) + 1));
        });

        // Compute school facets
        coursesForSchools.forEach(c => {
            const school = getSchoolFromSubject(c.subject);
            if (school) schools.set(school, (schools.get(school) || 0) + 1);
        });

        // A selected value whose count drops to zero still has to render, or the
        // only way to undo it is the chip row: with a conflicting class in the
        // schedule, the sidebar dropped the Autumn 2026 checkbox while its own
        // chip was still showing it as active. Departments and schools already
        // render selections independently of the counts; these four did not.
        selectedTerms.forEach(t => { if (t !== 'any' && !terms.has(t)) terms.set(t, 0); });
        selectedFormats.forEach(f => { if (!formats.has(f)) formats.set(f, 0); });
        selectedLevels.forEach(l => { if (!levels.has(l)) levels.set(l, 0); });
        selectedGers.forEach(g => { if (!gers.has(g)) gers.set(g, 0); });

        return {
            depts: Array.from(depts.entries())
                .map(([code, count]) => ({
                    code,
                    count,
                    name: code
                }))
                .sort((a, b) => a.code.localeCompare(b.code)),
            terms: Array.from(terms.entries()).sort((a, b) => compareTerms(a[0], b[0])),
            formats: Array.from(formats.entries()).sort((a, b) => b[1] - a[1]), // Sort by count desc
            levels: Array.from(levels.entries()).sort((a, b) => b[1] - a[1]),
            gers: Array.from(gers.entries()).sort((a, b) => a[0].localeCompare(b[0])),
            schools,
        };
    }, [searchedFacetLists, selectedTerms, selectedFormats, selectedLevels, selectedGers]);

    const filteredDepts = useMemo(() => {
        if (!deptQuery) return facets.depts;
        const lower = deptQuery.toLowerCase().trim();
        return facets.depts.filter(d => {
            const codeLower = d.code.toLowerCase();
            // Match department code that starts with query (e.g. "cs" -> CS, CSB, CSRE, but not ECOS)
            if (codeLower.startsWith(lower)) return true;
            const nameLower = (d.name || '').toLowerCase();
            if (nameLower.startsWith(lower)) return true;
            const words = nameLower.split(/[\s-]+/);
            return words.some(w => w.startsWith(lower));
        });
    }, [facets.depts, deptQuery]);

    const toggleFilter = (
        item: string,
        current: string[],
        setFn: (val: string[] | null) => void
    ) => {
        if (current.includes(item)) {
            const next = current.filter(i => i !== item);
            setFn(next.length ? next : null);
        } else {
            setFn([...current, item]);
        }
    };

    const removeDept = (dept: string) => {
        const next = selectedDepts.filter(d => d !== dept);
        setSelectedDepts(next.length ? next : null);
    };

    const handleAddExclude = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && excludeInput.trim()) {
            const newWord = excludeInput.trim();
            if (!excludedWords.includes(newWord)) {
                setExcludedWords([...excludedWords, newWord]);
            }
            setExcludeInput('');
        }
    };

    const removeExcludedWord = (word: string) => {
        const next = excludedWords.filter(w => w !== word);
        setExcludedWords(next.length ? next : null);
    };

    return (
        <div className="flex flex-col h-full bg-background border-r border-border/40">
            <div className="px-4 py-3 border-b border-border/40 flex items-center min-w-0 w-full">
                <h2 className="text-base font-semibold text-foreground/80 tracking-wide uppercase shrink-0">Filters</h2>
            </div>

            <SimpleScrollArea className="flex-1 px-4 py-3 space-y-3">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 min-h-8">
                        <input
                            type="checkbox"
                            id="hideConflicts"
                            checked={hideConflicts}
                            onChange={(e) => setHideConflicts(e.target.checked)}
                            className="h-4 w-4 shrink-0 rounded border-input text-primary accent-primary outline-none"
                        />
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <label htmlFor="hideConflicts" className="text-sm text-foreground/80 font-medium cursor-pointer flex items-center gap-1.5">
                                        Hide conflicting classes
                                    </label>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="max-w-[240px]">
                                    Hide courses that overlap with courses on your schedule.
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-2 min-h-8">
                        <input
                            type="checkbox"
                            id="hideUnavailable"
                            checked={hideUnavailable}
                            onChange={(e) => setHideUnavailable(e.target.checked)}
                            className="h-4 w-4 shrink-0 rounded border-input text-primary accent-primary outline-none"
                        />
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <label htmlFor="hideUnavailable" className="text-sm text-foreground/80 font-medium cursor-pointer flex items-center gap-1.5">
                                        Hide closed &amp; waitlisted
                                    </label>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="max-w-[240px]">
                                    Hide courses with no open sections in the selected term.
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-2 min-h-8">
                        <input
                            type="checkbox"
                            id="hideStudyAbroad"
                            checked={hideStudyAbroad}
                            onChange={(e) => setHideStudyAbroad(e.target.checked)}
                            className="h-4 w-4 shrink-0 rounded border-input text-primary accent-primary outline-none"
                        />
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <label htmlFor="hideStudyAbroad" className="text-sm text-foreground/80 font-medium cursor-pointer flex items-center gap-1.5">
                                        Hide study abroad
                                    </label>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="max-w-[240px]">
                                    Hide Bing Overseas Studies Program (BOSP) courses taught abroad.
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-2 min-h-8">
                        <input
                            type="checkbox"
                            id="newOnly"
                            checked={newOnly}
                            onChange={(e) => setNewOnly(e.target.checked)}
                            className="h-4 w-4 shrink-0 rounded border-input text-primary accent-primary outline-none"
                        />
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <label htmlFor="newOnly" className="text-sm text-foreground/80 font-medium cursor-pointer flex items-center gap-1.5">
                                        New courses only
                                    </label>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="max-w-[240px]">
                                    Show only courses that have not been offered in the last three years.
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>

                {/* Exclude Keywords */}
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1 flex items-center gap-1.5">
                        Exclude Keywords
                    </h3>
                    <div className="space-y-2">
                        <Input
                            placeholder="Type & press Enter to exclude..."
                            value={excludeInput}
                            onChange={(e) => setExcludeInput(e.target.value)}
                            onKeyDown={handleAddExclude}
                            className="h-8 text-sm"
                        />
                        {excludedWords.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {excludedWords.map(word => (
                                    <span key={word} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-destructive/10 text-destructive text-xs font-medium">
                                        {word}
                                        <button
                                            onClick={() => removeExcludedWord(word)}
                                            className="hover:text-destructive/80"
                                        >
                                            <X size={12} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Terms */}
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1 flex items-center gap-1.5">
                        Term
                    </h3>
                    <div className="space-y-1">
                        {facets.terms.map(([term, count]) => (
                            <CheckboxItem
                                key={term}
                                label={term}
                                count={count}
                                checked={selectedTerms.includes(term)}
                                onChange={() => {
                                    if (selectedTerms.includes(term)) {
                                        const next = selectedTerms.filter(t => t !== term);
                                        setSelectedTerms(next.length ? next : ['any']);
                                    } else {
                                        const next = selectedTerms.filter(t => t !== 'any');
                                        setSelectedTerms([...next, term]);
                                    }
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Departments */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1 flex items-center gap-1.5">
                            Departments
                        </h3>
                        {selectedDepts.length > 0 && (
                            <button
                                onClick={() => setSelectedDepts(null)}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground hover:text-foreground mb-2">
                                <Plus size={14} className="mr-2" />
                                Add Department
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
                            <DialogHeader className="px-6 py-4 border-b">
                                <DialogTitle className="sr-only">Select Departments</DialogTitle>
                                <div className="text-lg font-semibold">Select Departments</div>
                            </DialogHeader>
                            <div className="p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search departments..."
                                        className="pl-9 text-base md:text-sm"
                                        value={deptQuery}
                                        onChange={(e) => setDeptQuery(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <SimpleScrollArea className="flex-1 p-2">
                                <div className="space-y-0.5">
                                    {filteredDepts.map(({ code, count, name }) => (
                                        <div
                                            key={code}
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 rounded-md cursor-pointer transition-colors",
                                                selectedDepts.includes(code) ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-secondary/50"
                                            )}
                                            onClick={() => toggleFilter(code, selectedDepts, setSelectedDepts)}
                                            title={name}
                                        >
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">{code}</span>
                                                <span className="text-xs text-muted-foreground line-clamp-1">{name}</span>
                                            </div>
                                            {selectedDepts.includes(code) && (
                                                <div className="h-2 w-2 rounded-full bg-primary" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </SimpleScrollArea>
                            <div className="p-4 border-t bg-muted/20 flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">{selectedDepts.length} selected</span>
                                <Button size="sm" onClick={() => setIsDialogOpen(false)}>Done</Button>
                            </div>
                        </DialogContent>
                    </Dialog>

                    <div className="space-y-1">
                        {selectedDepts.map(dept => (
                            <div key={dept} className="group flex items-center justify-between text-sm px-2 py-1.5 rounded-md bg-secondary/40 hover:bg-secondary/60 transition-colors">
                                <span>{dept}</span>
                                <button
                                    onClick={() => removeDept(dept)}
                                    className="text-muted-foreground hover:text-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="h-px bg-border/40" />

                {/* Collapsible filter sections: no gap so entire strip is clickable */}
                <div className="space-y-0">
                    <FilterSection title="Format" hasActive={selectedFormats.length > 0}>
                        {facets.formats.map(([fmt, count]) => (
                            <CheckboxItem
                                key={fmt}
                                label={formatComponent(fmt)} // e.g. "Lecture", "Seminar"
                                count={count}
                                checked={selectedFormats.includes(fmt)}
                                onChange={() => toggleFilter(fmt, selectedFormats, setSelectedFormats)}
                            />
                        ))}
                    </FilterSection>


                    {/* Class Level */}
                    <FilterSection title="Class Level" hasActive={selectedLevels.length > 0}>
                        {facets.levels.map(([lvl, count]) => (
                            <CheckboxItem
                                key={lvl}
                                label={lvl}
                                count={count}
                                checked={selectedLevels.includes(lvl)}
                                onChange={() => toggleFilter(lvl, selectedLevels, setSelectedLevels)}
                            />
                        ))}
                    </FilterSection>

                    {/* Number of Units — Min and Max on separate tracks so both are easy to use */}
                    <FilterSection title="Number of Units" hasActive={unitMin > 1 || unitMax < 5}>
                        <div className="space-y-1 px-1">
                            <div className="space-y-2">
                                <div>
                                    <input
                                        type="range"
                                        min={1}
                                        max={5}
                                        value={localUnitMin}
                                        onChange={(e) => {
                                            const v = Number(e.target.value)
                                            setLocalUnitMin(v)
                                            if (v > localUnitMax) setLocalUnitMax(v)
                                        }}
                                        className="w-full filter-range accent-primary"
                                    />
                                    <p className="text-xs text-muted-foreground tabular-nums mt-0.5">Min: {localUnitMin}</p>
                                </div>
                                <div>
                                    <input
                                        type="range"
                                        min={1}
                                        max={5}
                                        value={localUnitMax}
                                        onChange={(e) => {
                                            const v = Number(e.target.value)
                                            setLocalUnitMax(v)
                                            if (v < localUnitMin) setLocalUnitMin(v)
                                        }}
                                        className="w-full filter-range accent-primary"
                                    />
                                    <p className="text-xs text-muted-foreground tabular-nums mt-0.5">Max: {localUnitMax >= 5 ? '5+' : localUnitMax}</p>
                                </div>
                                <div className="flex justify-between px-0.5 text-[10px] text-muted-foreground">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <span key={n} className="tabular-nums">{n === 5 ? '5+' : n}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </FilterSection>

                    <FilterSection title="Start Time" hasActive={timeMin > 420 || timeMax < 1320}>
                        <div className="space-y-1 px-1">
                            <div className="space-y-2">
                                <div>
                                    <input
                                        type="range"
                                        min={420}
                                        max={1320}
                                        step={30}
                                        value={localTimeMin}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setLocalTimeMin(v);
                                            if (v > localTimeMax) setLocalTimeMax(v);
                                        }}
                                        className="w-full filter-range accent-primary"
                                    />
                                    <p className="text-xs text-muted-foreground tabular-nums mt-0.5">From: {formatMinutes(localTimeMin)}</p>
                                </div>
                                <div>
                                    <input
                                        type="range"
                                        min={420}
                                        max={1320}
                                        step={30}
                                        value={localTimeMax}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setLocalTimeMax(v);
                                            if (v < localTimeMin) setLocalTimeMin(v);
                                        }}
                                        className="w-full filter-range accent-primary"
                                    />
                                    <p className="text-xs text-muted-foreground tabular-nums mt-0.5">To: {formatMinutes(localTimeMax)}</p>
                                </div>
                            </div>
                        </div>
                    </FilterSection>

                    {/* GERs */}
                    <FilterSection title="General Education Requirements" hasActive={selectedGers.length > 0}>
                        {(() => {
                            const WAYS_GERS = new Set([
                                'Aesthetic and Interpretive Inquiry',
                                'Applied Quantitative Reasoning',
                                'Creative Expression',
                                'Exploring Difference and Power',
                                'Ethical Reasoning',
                                'Formal Reasoning',
                                'Scientific Method and Analysis',
                                'Social Inquiry',
                            ]);
                            const isWays = (ger: string) => {
                                // Check full name match
                                if (WAYS_GERS.has(ger)) return true;
                                // Check if the string ends with a known WAYS abbreviation
                                const abbrev = ger.match(/\(([A-Za-z0-9+]+)\)\s*$/);
                                if (abbrev) {
                                    const code = abbrev[1];
                                    return ['AII', 'AQR', 'CE', 'EDP', 'ER', 'FR', 'SMA', 'SI'].includes(code);
                                }
                                return false;
                            };
                            const waysGers = facets.gers.filter(([ger]) => isWays(ger));
                            const otherGers = facets.gers.filter(([ger]) => !isWays(ger));
                            const waysSelectedCount = waysGers.filter(([ger]) => selectedGers.includes(ger)).length;
                            const allWaysSelected = waysGers.length > 0 && waysSelectedCount === waysGers.length;
                            const someWaysSelected = waysSelectedCount > 0;
                            const totalWaysCount = waysGers.reduce((sum, [, count]) => sum + count, 0);
                            const formatGerLabel = (ger: string) => {
                                const map: Record<string, string> = {
                                    'Language': 'Foreign Language',
                                    'Writing 1': 'PWR 1',
                                    'Writing 2': 'PWR 2',
                                    'Writing SLE': 'SLE',
                                    'Intro Seminar - Freshman': 'Frosh IntroSem',
                                    'Intro Seminar - Sophomore': 'Sophomore IntroSem',
                                };
                                return map[ger] ?? ger;
                            };
                            return (
                                <>
                                    {waysGers.length > 0 && (
                                        <Collapsible open={waysExpanded} onOpenChange={setWaysExpanded} className="space-y-1">
                                            <div className="flex items-center w-full py-1">
                                                <div
                                                    className={cn(
                                                        "h-4 w-4 border rounded mr-2 flex items-center justify-center transition-colors cursor-pointer shrink-0",
                                                        allWaysSelected ? "bg-primary border-primary text-primary-foreground" : someWaysSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground hover:border-primary"
                                                    )}
                                                    onClick={() => {
                                                        const waysGerNames = waysGers.map(([ger]) => ger);
                                                        if (allWaysSelected) {
                                                            const next = selectedGers.filter(g => !waysGerNames.includes(g));
                                                            setSelectedGers(next.length ? next : null);
                                                        } else {
                                                            const current = new Set(selectedGers);
                                                            waysGerNames.forEach(g => current.add(g));
                                                            setSelectedGers(Array.from(current));
                                                        }
                                                    }}
                                                >
                                                    {allWaysSelected ? <Check size={10} strokeWidth={3} /> : someWaysSelected ? <Minus size={10} strokeWidth={3} /> : null}
                                                </div>
                                                <CollapsibleTrigger asChild>
                                                    <button type="button" className="flex-1 flex items-center justify-between cursor-pointer text-sm text-left min-w-0 font-medium text-foreground">
                                                        <span>WAYS</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">{totalWaysCount}</span>
                                                            {waysExpanded ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                                                        </div>
                                                    </button>
                                                </CollapsibleTrigger>
                                            </div>
                                            <CollapsibleContent className="space-y-1">
                                                {waysGers.map(([ger, count]) => (
                                                    <CheckboxItem
                                                        key={ger}
                                                        label={formatGerLabel(ger)}
                                                        count={count}
                                                        checked={selectedGers.includes(ger)}
                                                        onChange={() => toggleFilter(ger, selectedGers, setSelectedGers)}
                                                    />
                                                ))}
                                            </CollapsibleContent>
                                        </Collapsible>
                                    )}
                                    {otherGers.map(([ger, count]) => (
                                        <CheckboxItem
                                            key={ger}
                                            label={formatGerLabel(ger)}
                                            count={count}
                                            checked={selectedGers.includes(ger)}
                                            onChange={() => toggleFilter(ger, selectedGers, setSelectedGers)}
                                        />
                                    ))}
                                </>
                            );
                        })()}
                    </FilterSection>

                    {/* School */}
                    <FilterSection title="School" hasActive={selectedSchools.length > 0}>
                        {['Business', 'Education', 'Engineering', 'Humanities & Sciences', 'Law', 'Medicine', 'Sustainability'].map(school => (
                            <CheckboxItem
                                key={school}
                                label={school}
                                count={facets.schools.get(school) || 0}
                                checked={selectedSchools.includes(school)}
                                onChange={() => toggleFilter(school, selectedSchools, setSelectedSchools)}
                            />
                        ))}
                    </FilterSection>
                </div>

            </SimpleScrollArea>
        </div>
    );
}
