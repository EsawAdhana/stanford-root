import React, { useMemo, useState } from 'react';
import { useCourseStore } from '@/lib/store';
import { useCartStore } from '@/lib/cart-store';
import { useQueryState, parseAsArrayOf, parseAsString, parseAsBoolean } from 'nuqs';
import { cn, getSchoolFromSubject } from '@/lib/utils';
import { parseMeetingTimes, timeToMinutes, isMeetingOptional } from '@/lib/schedule-utils';
import { CheckboxItem, FilterGroup } from '@/components/ui/filter-components';
import { Input } from '@/components/ui/input';
import { Search, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
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
    defaultOpen = false 
}: { 
    title: string, 
    children: React.ReactNode, 
    defaultOpen?: boolean 
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
            <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">{title}</h3>
                    <span className="text-[10px] text-muted-foreground/60 italic font-normal hidden group-hover:block">None = All</span>
                 </div>
                 <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-secondary">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </Button>
                 </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-1">
                {children}
            </CollapsibleContent>
        </Collapsible>
    );
};


export function FilterSidebar() {
    const { courses } = useCourseStore();
    const cartItems = useCartStore(state => state.items);

    // State
    const [query] = useQueryState('q', { defaultValue: '' });
    const [selectedDepts, setSelectedDepts] = useQueryState('depts', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedTerms, setSelectedTerms] = useQueryState('terms', parseAsArrayOf(parseAsString).withDefault([]));
    const [hideConflicts, setHideConflicts] = useQueryState('hideConflicts', parseAsBoolean.withDefault(false));
    const [excludedWords, setExcludedWords] = useQueryState('exclude', parseAsArrayOf(parseAsString).withDefault([]));
    
    // New Filters
    const [selectedFormats, setSelectedFormats] = useQueryState('formats', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedStatus, setSelectedStatus] = useQueryState('status', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedLevels, setSelectedLevels] = useQueryState('levels', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedGers, setSelectedGers] = useQueryState('gers', parseAsArrayOf(parseAsString).withDefault([]));
    const [selectedSchools, setSelectedSchools] = useQueryState('schools', parseAsArrayOf(parseAsString).withDefault([]));
    
    // Single Selects (Dropdowns) -> Now Multi Selects (Checkboxes)
    const [unitRanges, setUnitRanges] = useQueryState('units', parseAsArrayOf(parseAsString).withDefault([]));
    const [timeRanges, setTimeRanges] = useQueryState('times', parseAsArrayOf(parseAsString).withDefault([]));

    const [deptQuery, setDeptQuery] = useState('');
    const [excludeInput, setExcludeInput] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Helper to filter courses based on all active filters except a specific one
    // This ensures facet counts match the visible course list
    const getFilteredCoursesForFacets = (excludeFilter?: string) => {
            let filtered = courses;

            // Apply excluded words filter
            if (excludedWords && excludedWords.length > 0 && excludeFilter !== 'exclude') {
                filtered = filtered.filter(c => {
                    const textToCheck = `${c.title} ${c.description} ${c.code}`.toLowerCase();
                    return !excludedWords.some(word => textToCheck.includes(word.toLowerCase()));
                });
            }

            // Apply department filter
            if (selectedDepts && selectedDepts.length > 0 && excludeFilter !== 'depts') {
                filtered = filtered.filter(c => selectedDepts.includes(c.subject));
            }

            // Apply term filter
            if (selectedTerms && selectedTerms.length > 0 && excludeFilter !== 'terms') {
                filtered = filtered.filter(c => {
                    if (c.terms) {
                        return c.terms.some(t => selectedTerms.includes(t));
                    }
                    return c.term && selectedTerms.includes(c.term);
                });
            }

            // Apply format filter
            if (selectedFormats && selectedFormats.length > 0 && excludeFilter !== 'formats') {
                filtered = filtered.filter(c => {
                    if (c.sections && c.sections.length > 0) {
                        return c.sections.some(s => s.component && selectedFormats.includes(s.component));
                    }
                    return false;
                });
            }

            // Apply status filter
            if (selectedStatus && selectedStatus.length > 0 && excludeFilter !== 'status') {
                filtered = filtered.filter(c => {
                    if (c.sections && c.sections.length > 0) {
                        return c.sections.some(s => s.status && selectedStatus.includes(s.status));
                    }
                    return false;
                });
            }

            // Apply level filter
            if (selectedLevels && selectedLevels.length > 0 && excludeFilter !== 'levels') {
                filtered = filtered.filter(c => {
                    if (c.sections && c.sections.length > 0) {
                        return c.sections.some(s => s.classLevel && selectedLevels.includes(s.classLevel));
                    }
                    return false;
                });
            }

            // Apply GER filter
            if (selectedGers && selectedGers.length > 0 && excludeFilter !== 'gers') {
                filtered = filtered.filter(c => {
                    if (c.sections && c.sections.length > 0) {
                        return c.sections.some(s => s.gers && s.gers.some(g => selectedGers.includes(g)));
                    }
                    return false;
                });
            }

            // Apply school filter
            if (selectedSchools && selectedSchools.length > 0 && excludeFilter !== 'schools') {
                filtered = filtered.filter(c => {
                    const school = getSchoolFromSubject(c.subject);
                    return selectedSchools.includes(school);
                });
            }

            // Apply unit range filter
            if (unitRanges && unitRanges.length > 0 && excludeFilter !== 'units') {
                filtered = filtered.filter(c => {
                    const checkUnits = (uStr: string | number) => {
                        if (!uStr) return false;
                        const u = typeof uStr === 'string' ? parseFloat(uStr) : uStr;
                        if (isNaN(u)) return false;
                        return unitRanges.some(range => {
                            if (range === '1') return u >= 1 && u < 2;
                            if (range === '2') return u >= 2 && u < 3;
                            if (range === '3') return u >= 3 && u < 4;
                            if (range === '4') return u >= 4 && u < 5;
                            if (range === '5+') return u >= 5;
                            return false;
                        });
                    };
                    if (c.sections && c.sections.length > 0) {
                        return c.sections.some(s => checkUnits(s.units));
                    }
                    const mainUnits = parseFloat(c.units);
                    if (!isNaN(mainUnits)) return checkUnits(mainUnits);
                    return false;
                });
            }

            // Apply time range filter
            if (timeRanges && timeRanges.length > 0 && excludeFilter !== 'times') {
                const timeToHour = (timeStr: string) => {
                    if (!timeStr) return -1;
                    const [time, modifier] = timeStr.split(' ');
                    let [hours] = time.split(':').map(Number);
                    if (modifier === 'PM' && hours < 12) hours += 12;
                    if (modifier === 'AM' && hours === 12) hours = 0;
                    return hours;
                };
                filtered = filtered.filter(c => {
                    if (c.sections && c.sections.length > 0) {
                        return c.sections.some(s => s.meetings.some(m => {
                            const startHour = timeToHour(m.time.split('-')[0].trim());
                            if (startHour === -1) return false;
                            return timeRanges.some(range => {
                                if (range === 'early-morning') return startHour < 10;
                                if (range === 'morning') return startHour >= 10 && startHour < 12;
                                if (range === 'afternoon') return startHour >= 12 && startHour < 14;
                                if (range === 'late-afternoon') return startHour >= 14 && startHour < 17;
                                if (range === 'evening') return startHour >= 17;
                                return false;
                            });
                        }));
                    }
                    return false;
                });
            }

            // Apply conflict hiding filter (always applied, not excluded)
            if (hideConflicts) {
                const hasOverlap = (m1: any, m2: any, cartItem?: any) => {
                    // Check Days - but exclude optional days from cartItem
                    let commonDays = m1.days.filter((d: string) => m2.days.includes(d));
                    
                    // If cartItem is provided, filter out optional days
                    if (cartItem) {
                        commonDays = commonDays.filter((day: string) => {
                            return !isMeetingOptional(cartItem, day, m2.startTime, m2.endTime);
                        });
                    }
                    
                    if (commonDays.length === 0) return false;
                    
                    // Check Times
                    const start1 = timeToMinutes(m1.startTime);
                    const end1 = timeToMinutes(m1.endTime);
                    const start2 = timeToMinutes(m2.startTime);
                    const end2 = timeToMinutes(m2.endTime);
                    
                    return start1 < end2 && start2 < end1;
                };

                const parseSectionMeetings = (section: any) => {
                    return section.meetings.flatMap((m: any) => {
                        let days: string[] = [];
                        if (typeof m.days === 'string') days = m.days.split(/[ ,]+/);
                        
                        // Normalize Days (Mon, Tue...)
                        const normalizedDays = days.map((d: string) => {
                            const lower = d.toLowerCase();
                            if (lower.startsWith('m')) return 'Mon';
                            if (lower.startsWith('tu')) return 'Tue';
                            if (lower.startsWith('w')) return 'Wed';
                            if (lower.startsWith('th')) return 'Thu';
                            if (lower.startsWith('f')) return 'Fri';
                            return '';
                        }).filter(Boolean);

                        let startTime = '', endTime = '';
                        if (m.time && m.time.includes('-')) {
                            [startTime, endTime] = m.time.split('-').map((s: string) => s.trim());
                        }

                        if (!startTime) return [];

                        return [{
                            days: normalizedDays,
                            startTime,
                            endTime
                        }];
                    });
                };

                filtered = filtered.filter(c => {
                    if (!c.sections || c.sections.length === 0) return true;
                    
                    let sectionsToCheck = c.sections;
                    if (selectedTerms && selectedTerms.length > 0) {
                        sectionsToCheck = sectionsToCheck.filter(s => selectedTerms.includes(s.term));
                    }
                    
                    if (sectionsToCheck.length === 0) return true;

                    // A course is valid if AT LEAST ONE section does not overlap
                    return sectionsToCheck.some(section => {
                        const cartItemsForTerm = cartItems.filter(item => item.selectedTerm === section.term);
                        if (cartItemsForTerm.length === 0) return true;
                        
                        const sectionMeetings = parseSectionMeetings(section);
                        if (sectionMeetings.length === 0) return true;

                        const isOverlapping = cartItemsForTerm.some(cartItem => {
                            const cartMeetings = parseMeetingTimes(cartItem, cartItem.selectedTerm);
                            // Check conflicts, but pass cartItem to hasOverlap to exclude optional days
                            return cartMeetings.some(cm => 
                                sectionMeetings.some((sm: any) => hasOverlap(sm, cm, cartItem))
                            );
                        });
                        
                        return !isOverlapping;
                    });
                });
            }

            // Apply search query filter (always applied, not excluded)
            if (query) {
                const lowerQuery = query.toLowerCase().trim()
                const compactQuery = lowerQuery.replace(/\s+/g, '')
                const parts = lowerQuery.split(/\s+/).filter(Boolean)

                const allSubjects = new Set(courses.map(c => c.subject))

                let subject = parts[0]?.toUpperCase() || ''
                let remainingQuery = parts.slice(1).join(' ')

                // Support searches like "cs106a" as well as "cs 106a"
                if (parts.length === 1 && compactQuery) {
                    const m = compactQuery.match(/^([a-z&]+)(\d.*)$/i)
                    if (m) {
                        const maybeSubject = m[1].toUpperCase()
                        if (allSubjects.has(maybeSubject)) {
                            subject = maybeSubject
                            remainingQuery = m[2]
                        }
                    }
                }

                const isSubjectSearch = Boolean(subject) && allSubjects.has(subject)

                if (isSubjectSearch) {
                    filtered = filtered.filter(c => c.subject === subject)

                    if (remainingQuery) {
                        const remainingLower = remainingQuery.toLowerCase().trim()
                        const remainingCompact = remainingLower.replace(/\s+/g, '')
                        filtered = filtered.filter(c => {
                            const codeCompact = (c.code || '').toLowerCase().replace(/\s+/g, '')
                            if (codeCompact.includes(remainingCompact)) return true
                            if ((c.title || '').toLowerCase().includes(remainingLower)) return true
                            return false
                        })
                    }
                } else {
                    filtered = filtered.filter(c => {
                        const subjectCodeSpaced = `${c.subject} ${c.code}`.toLowerCase()
                        const subjectCodeCompact = `${c.subject}${c.code}`.toLowerCase().replace(/\s+/g, '')
                        const codeCompact = (c.code || '').toLowerCase().replace(/\s+/g, '')

                        if (subjectCodeSpaced.startsWith(lowerQuery)) return true
                        if (subjectCodeCompact.startsWith(compactQuery)) return true
                        if (codeCompact.includes(compactQuery)) return true
                        if ((c.title || '').toLowerCase().includes(lowerQuery)) return true
                        if (c.instructors && c.instructors.some(i => i.toLowerCase().includes(lowerQuery))) return true
                        return false
                    })
                }
            }

        return filtered;
    };

    // Compute Facets based on filtered courses
    const facets = useMemo(() => {
        const depts = new Map<string, number>();
        const terms = new Map<string, number>();
        const deptNames = new Map<string, string>(); // Map Code -> Full Name
        
        // New Facets
        const formats = new Map<string, number>();
        const statuses = new Map<string, number>();
        const levels = new Map<string, number>();
        const gers = new Map<string, number>();
        const schools = new Map<string, number>();
        const unitCounts = new Map<string, number>();
        const timeCounts = new Map<string, number>();

        // Get filtered courses for each facet type (excluding that facet's filter)
        const coursesForDepts = getFilteredCoursesForFacets('depts');
        const coursesForTerms = getFilteredCoursesForFacets('terms');
        const coursesForFormats = getFilteredCoursesForFacets('formats');
        const coursesForStatus = getFilteredCoursesForFacets('status');
        const coursesForLevels = getFilteredCoursesForFacets('levels');
        const coursesForGers = getFilteredCoursesForFacets('gers');
        const coursesForSchools = getFilteredCoursesForFacets('schools');
        const coursesForUnits = getFilteredCoursesForFacets('units');
        const coursesForTimes = getFilteredCoursesForFacets('times');

        // Compute dept facets
        coursesForDepts.forEach(c => {
            depts.set(c.subject, (depts.get(c.subject) || 0) + 1);
            if (c.dept && !deptNames.has(c.subject)) {
                deptNames.set(c.subject, c.dept);
            }
        });

        // Compute term facets
        coursesForTerms.forEach(c => {
            if (c.terms) {
                c.terms.forEach(t => terms.set(t, (terms.get(t) || 0) + 1));
            } else if (c.term) {
                terms.set(c.term, (terms.get(c.term) || 0) + 1);
            }
        });

        // Helper parsing functions
        const checkUnits = (uStr: string | number, range: string) => {
            if (!uStr) return false;
            const u = typeof uStr === 'string' ? parseFloat(uStr) : uStr;
            if (isNaN(u)) return false;
            if (range === '1') return u >= 1 && u < 2;
            if (range === '2') return u >= 2 && u < 3;
            if (range === '3') return u >= 3 && u < 4;
            if (range === '4') return u >= 4 && u < 5;
            if (range === '5+') return u >= 5;
            return false;
        };

        const timeToHour = (timeStr: string) => {
            if (!timeStr) return -1;
            const [time, modifier] = timeStr.split(' ');
            let [hours] = time.split(':').map(Number);
            if (modifier === 'PM' && hours < 12) hours += 12;
            if (modifier === 'AM' && hours === 12) hours = 0;
            return hours;
        };

        const checkTime = (timeStr: string, range: string) => {
            const startHour = timeToHour(timeStr.split('-')[0].trim());
            if (startHour === -1) return false;
            if (range === 'early-morning') return startHour < 10;
            if (range === 'morning') return startHour >= 10 && startHour < 12;
            if (range === 'afternoon') return startHour >= 12 && startHour < 14;
            if (range === 'late-afternoon') return startHour >= 14 && startHour < 17;
            if (range === 'evening') return startHour >= 17;
            return false;
        };

        // Compute format facets
        coursesForFormats.forEach(c => {
            const uniqueComponents = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if(s.component) uniqueComponents.add(s.component);
                });
            }
            uniqueComponents.forEach(comp => formats.set(comp, (formats.get(comp) || 0) + 1));
        });

        // Compute status facets
        coursesForStatus.forEach(c => {
            const uniqueStatus = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if(s.status) uniqueStatus.add(s.status);
                });
            }
            uniqueStatus.forEach(stat => statuses.set(stat, (statuses.get(stat) || 0) + 1));
        });

        // Compute level facets
        coursesForLevels.forEach(c => {
            const uniqueLevels = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if(s.classLevel) uniqueLevels.add(s.classLevel);
                });
            }
            uniqueLevels.forEach(lvl => levels.set(lvl, (levels.get(lvl) || 0) + 1));
        });

        // Compute GER facets
        coursesForGers.forEach(c => {
            const uniqueGers = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    if(s.gers) s.gers.forEach(g => uniqueGers.add(g));
                });
            }
            uniqueGers.forEach(g => gers.set(g, (gers.get(g) || 0) + 1));
        });

        // Compute school facets
        coursesForSchools.forEach(c => {
            const school = getSchoolFromSubject(c.subject);
            if (school) schools.set(school, (schools.get(school) || 0) + 1);
        });

        // Compute unit facets
        coursesForUnits.forEach(c => {
            const uniqueUnitRanges = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    ['1', '2', '3', '4', '5+'].forEach(r => {
                        if (checkUnits(s.units, r)) uniqueUnitRanges.add(r);
                    });
                });
            } else {
                const mainUnits = parseFloat(c.units);
                if (!isNaN(mainUnits)) {
                    ['1', '2', '3', '4', '5+'].forEach(r => {
                        if (checkUnits(mainUnits, r)) uniqueUnitRanges.add(r);
                    });
                }
            }
            uniqueUnitRanges.forEach(r => unitCounts.set(r, (unitCounts.get(r) || 0) + 1));
        });

        // Compute time facets
        coursesForTimes.forEach(c => {
            const uniqueTimeRanges = new Set<string>();
            if (c.sections && c.sections.length > 0) {
                c.sections.forEach(s => {
                    s.meetings.forEach(m => {
                        ['early-morning', 'morning', 'afternoon', 'late-afternoon', 'evening'].forEach(r => {
                            if (checkTime(m.time, r)) uniqueTimeRanges.add(r);
                        });
                    });
                });
            }
            uniqueTimeRanges.forEach(r => timeCounts.set(r, (timeCounts.get(r) || 0) + 1));
        });

        return {
            depts: Array.from(depts.entries())
                .map(([code, count]) => ({
                    code,
                    count,
                    name: deptNames.get(code) || code
                }))
                .sort((a, b) => a.code.localeCompare(b.code)),
            terms: Array.from(terms.entries()).sort((a, b) => {
                const order = ['Autumn', 'Winter', 'Spring', 'Summer'];
                const [semA, yearA] = a[0].split(' ');
                const [semB, yearB] = b[0].split(' ');
                if (yearA !== yearB) return yearA.localeCompare(yearB);
                return order.indexOf(semA) - order.indexOf(semB);
            }),
            formats: Array.from(formats.entries()).sort((a, b) => b[1] - a[1]), // Sort by count desc
            statuses: Array.from(statuses.entries()).sort((a, b) => b[1] - a[1]),
            levels: Array.from(levels.entries()).sort((a, b) => b[1] - a[1]),
            gers: Array.from(gers.entries()).sort((a, b) => a[0].localeCompare(b[0])),
            unitCounts,
            timeCounts,
            schools,
        };
    }, [courses, excludedWords, selectedDepts, selectedTerms, selectedFormats, selectedStatus, selectedLevels, selectedGers, selectedSchools, unitRanges, timeRanges, query, hideConflicts, cartItems]);

    const filteredDepts = useMemo(() => {
        if (!deptQuery) return facets.depts;
        const lower = deptQuery.toLowerCase();
        return facets.depts.filter(d => {
            if (d.code.toLowerCase().includes(lower)) return true;
            const words = d.name.toLowerCase().split(/[\s-]+/);
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
            <div className="p-6 pb-4 border-b border-border/40">
                <h2 className="text-sm font-semibold text-foreground/80 tracking-wide uppercase">Filters</h2>
                <div className="mt-4 flex items-center space-x-2">
                    <input 
                        type="checkbox" 
                        id="hideConflicts"
                        checked={hideConflicts}
                        onChange={(e) => setHideConflicts(e.target.checked)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary accent-primary"
                    />
                    <label htmlFor="hideConflicts" className="text-sm text-foreground/80 font-medium cursor-pointer">
                        Hide Conflicting Classes
                    </label>
                </div>
            </div>
            <SimpleScrollArea className="flex-1 px-4 py-4 space-y-6">

                {/* Exclude Keywords */}
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Exclude Keywords</h3>
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
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Term</h3>
                    <div className="space-y-1">
                        {facets.terms.map(([term, count]) => (
                            <CheckboxItem
                                key={term}
                                label={term}
                                count={count}
                                checked={selectedTerms.includes(term)}
                                onChange={() => toggleFilter(term, selectedTerms, setSelectedTerms)}
                            />
                        ))}
                    </div>
                </div>

                {/* Departments */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Departments</h3>
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
                                <DialogTitle>Select Departments</DialogTitle>
                            </DialogHeader>
                            <div className="p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search departments..."
                                        className="pl-9"
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
                                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="h-px bg-border/40" />

                {/* Format (Component) */}
                <FilterSection title="Format">
                    {facets.formats.map(([fmt, count]) => (
                        <CheckboxItem
                            key={fmt}
                            label={fmt} // e.g. "Lecture", "Seminar"
                            count={count}
                            checked={selectedFormats.includes(fmt)}
                            onChange={() => toggleFilter(fmt, selectedFormats, setSelectedFormats)}
                        />
                    ))}
                </FilterSection>
                
                {/* Class Status */}
                <FilterSection title="Class Status">
                    {facets.statuses.map(([status, count]) => (
                        <CheckboxItem
                            key={status}
                            label={status}
                            count={count}
                            checked={selectedStatus.includes(status)}
                            onChange={() => toggleFilter(status, selectedStatus, setSelectedStatus)}
                        />
                    ))}
                </FilterSection>

                {/* Class Level */}
                <FilterSection title="Class Level">
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

                {/* Units */}
                <FilterSection title="Number of Units">
                    {[
                        { val: '1', label: '1 Unit' },
                        { val: '2', label: '2 Units' },
                        { val: '3', label: '3 Units' },
                        { val: '4', label: '4 Units' },
                        { val: '5+', label: '5+ Units' }
                    ].map(opt => (
                        <CheckboxItem
                            key={opt.val}
                            label={opt.label}
                            count={facets.unitCounts.get(opt.val) || 0}
                            checked={unitRanges.includes(opt.val)}
                            onChange={() => toggleFilter(opt.val, unitRanges, setUnitRanges)}
                        />
                    ))}
                </FilterSection>

                {/* Start Time */}
                <FilterSection title="Start Time">
                     {[
                         { val: 'early-morning', label: 'Early Morning (< 10 AM)' },
                         { val: 'morning', label: 'Late Morning (10-12 PM)' },
                         { val: 'afternoon', label: 'Early Afternoon (12-2 PM)' },
                         { val: 'late-afternoon', label: 'Late Afternoon (2-5 PM)' },
                         { val: 'evening', label: 'Evening (5 PM+)' }
                     ].map(opt => (
                        <CheckboxItem
                            key={opt.val}
                            label={opt.label}
                            count={facets.timeCounts.get(opt.val) || 0}
                            checked={timeRanges.includes(opt.val)}
                            onChange={() => toggleFilter(opt.val, timeRanges, setTimeRanges)}
                        />
                     ))}
                </FilterSection>

                {/* GERs */}
                <FilterSection title="General Education Requirements">
                    {facets.gers.map(([ger, count]) => (
                        <CheckboxItem
                            key={ger}
                            label={ger}
                            count={count}
                            checked={selectedGers.includes(ger)}
                            onChange={() => toggleFilter(ger, selectedGers, setSelectedGers)}
                        />
                    ))}
                </FilterSection>

                {/* School */}
                <FilterSection title="School">
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

            </SimpleScrollArea>
        </div>
    );
}
