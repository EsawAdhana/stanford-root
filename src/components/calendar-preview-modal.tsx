'use client';

import React, { useCallback, useId, useMemo, useState, useEffect, useRef } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/lib/cart-store';
import { useCourseStore, getCoursesById } from '@/lib/store';
import { parseMeetingTimes, parseTimeRange, timeToMinutes, isMeetingOptional, stripSeconds, parseDays, isScheduledForTerm } from '@/lib/schedule-utils';
import { cn, decodeHtmlEntities, parseUnitsOptions } from '@/lib/utils';
import { AlertTriangle, CalendarPlus, Calendar, Clock, MapPin, X } from 'lucide-react';
import type { Course, Section } from '@/types/course';
import { DAYS, HOUR_HEIGHT, DEFAULT_START_MINUTES, DEFAULT_END_MINUTES, getCalendarColorClasses, layoutDayEvents, ALL_DAYS, visibleDays, type CalendarDay } from '@/lib/calendar-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type CalendarEvent = {
    id: string;
    courseId: string;
    courseCode: string;
    title: string;
    day: CalendarDay;
    start: number; // minutes from midnight
    end: number;
    startTime: string;
    endTime: string;
    location?: string;
    isPreview: boolean;
    /** Meeting the user hid on their schedule — excluded from conflict detection. */
    isOptional?: boolean;
};

type LaidOutEvent = CalendarEvent & {
    colIndex: number;
    colCount: number;
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface CalendarPreviewModalProps {
    course: Course;
    section: Section;
    term: string;
    isOpen: boolean;
    onClose: () => void;
    /** Called with selectedUnits when section has variable units (e.g. 3-4). */
    onConfirm: (selectedUnits?: number) => void;
    /** Pre-selected units from parent (e.g. from section card or cart). */
    initialSelectedUnits?: number;
}

/**
 * Grid columns for the time rail plus 5 to 7 days. Every day fits the dialog
 * width; phones get a narrower rail (desktop keeps 52px). Written out in full
 * so Tailwind sees each class.
 */
const GRID_COLUMNS: Record<number, string> = {
    5: 'grid-cols-[30px_repeat(5,minmax(0,1fr))] sm:grid-cols-[52px_repeat(5,minmax(0,1fr))]',
    6: 'grid-cols-[30px_repeat(6,minmax(0,1fr))] sm:grid-cols-[52px_repeat(6,minmax(0,1fr))]',
    7: 'grid-cols-[30px_repeat(7,minmax(0,1fr))] sm:grid-cols-[52px_repeat(7,minmax(0,1fr))]',
};

/** Day labels for phones narrower than the xs breakpoint. */
export const SHORT_DAY_LABELS: Record<CalendarDay, string> = {
    Mon: 'M', Tue: 'Tu', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa', Sun: 'Su',
};

/** Why Add to Calendar is disabled, shown beside the units row; null when it is enabled. */
export function addBlockedReason(hasVariableUnits: boolean, selectedUnits: number | undefined): string | null {
    return hasVariableUnits && selectedUnits === undefined ? 'Pick units to add this class.' : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarPreviewModal({
    course,
    section,
    term,
    isOpen,
    onClose,
    onConfirm,
    initialSelectedUnits,
}: CalendarPreviewModalProps) {
    const items = useCartStore(s => s.items);
    const courses = useCourseStore(s => s.courses);

    // Section may have 0, empty, or invalid units; use course as fallback (e.g. section "0" vs course "4")
    const sectionOpts = parseUnitsOptions(section.units ?? '');
    const courseOpts = parseUnitsOptions(course.units ?? '');
    const secHasValidUnits = sectionOpts.length > 0 && Math.max(0, ...sectionOpts) > 0;
    const unitOptions = sectionOpts.length > 1 ? sectionOpts : courseOpts.length > 1 ? courseOpts : (secHasValidUnits ? sectionOpts : courseOpts);
    const hasVariableUnits = unitOptions.length > 1;

    const [selectedUnits, setSelectedUnits] = useState<number | undefined>(() =>
        initialSelectedUnits !== undefined && unitOptions.includes(initialSelectedUnits) ? initialSelectedUnits : undefined
    );

    useEffect(() => {
        if (initialSelectedUnits !== undefined && unitOptions.includes(initialSelectedUnits)) {
            setSelectedUnits(initialSelectedUnits);
        }
    }, [initialSelectedUnits, unitOptions.join(',')]);

    // Existing cart items for this term (excluding this course), merged with full course data for sections
    const existingItems = useMemo(() => {
        const filtered = items.filter(c => isScheduledForTerm(c, term) && c.id !== course.id);
        const byId = getCoursesById(courses);
        return filtered.map(item => {
            const fullCourse = byId.get(item.id);
            if (fullCourse?.sections && fullCourse.sections.length > 0) {
                return { ...fullCourse, ...item, sections: fullCourse.sections };
            }
            return item;
        });
    }, [items, term, course.id, courses]);

    // Build calendar events from existing cart items
    const existingEvents = useMemo<CalendarEvent[]>(() => {
        const out: CalendarEvent[] = [];
        existingItems.forEach(c => {
            const meetings = parseMeetingTimes(c, term);
            meetings.forEach(m => {
                if (!m.startTime || !m.endTime) return;
                const start = timeToMinutes(m.startTime);
                const end = timeToMinutes(m.endTime);
                if (!start || !end || end <= start) return;
                (m.days || []).forEach(day => {
                    if (!ALL_DAYS.some(d => d.key === day)) return;
                    out.push({
                        id: `${c.id}-${day}-${start}`,
                        courseId: c.id,
                        courseCode: `${c.subject} ${c.code}`,
                        title: decodeHtmlEntities(c.title),
                        day: day as CalendarEvent['day'],
                        start,
                        end,
                        startTime: m.startTime,
                        endTime: m.endTime,
                        location: m.location,
                        isPreview: false,
                        isOptional: isMeetingOptional(c, day, m.startTime, m.endTime),
                    });
                });
            });
        });
        return out;
    }, [existingItems, term]);

    // Build preview (ghost) events from the candidate section
    const previewEvents = useMemo<CalendarEvent[]>(() => {
        const out: CalendarEvent[] = [];
        const meetings = section.meetings || [];
        meetings.forEach(m => {
            if (!m.time) return;
            const range = parseTimeRange(m.time);
            if (!range?.startTime) return;
            const startTime = range.startTime;
            const endTime = range.endTime
            if (!startTime || !endTime) return;
            const start = timeToMinutes(startTime);
            const end = timeToMinutes(endTime);
            if (!start || !end || end <= start) return;

            // parseDays is the single normalizer; a local copy of it here was
            // how weekend sections got dropped from the preview.
            const rawDays = parseDays(m.days || '') as CalendarEvent['day'][];

            rawDays.forEach(day => {
                out.push({
                    id: `preview-${day}-${start}`,
                    courseId: course.id,
                    courseCode: `${course.subject} ${course.code}`,
                    title: decodeHtmlEntities(course.title),
                    day,
                    start,
                    end,
                    startTime,
                    endTime,
                    location: m.location,
                    isPreview: true,
                });
            });
        });
        return out;
    }, [section, course]);

    const allEvents = useMemo(() => [...existingEvents, ...previewEvents], [existingEvents, previewEvents]);

    // Detect conflicts: preview events overlapping with existing events
    const conflictingCourses = useMemo(() => {
        const names = new Set<string>();
        previewEvents.forEach(pv => {
            existingEvents.forEach(ex => {
                if (ex.isOptional) return; // hidden meetings don't count as conflicts (matches browse)
                if (ex.day === pv.day && ex.start < pv.end && ex.end > pv.start) {
                    names.add(ex.courseCode);
                }
            });
        });
        return Array.from(names);
    }, [previewEvents, existingEvents]);

    // Calendar range
    const { startMinutes, endMinutes, hours } = useMemo(() => {
        const minStart = allEvents.length
            ? allEvents.reduce((m, e) => Math.min(m, e.start), Infinity)
            : DEFAULT_START_MINUTES;
        const maxEnd = allEvents.length
            ? allEvents.reduce((m, e) => Math.max(m, e.end), 0)
            : DEFAULT_END_MINUTES;
        const start = Math.min(DEFAULT_START_MINUTES, Math.floor(minStart / 60) * 60);
        const end = Math.max(DEFAULT_END_MINUTES, Math.ceil(maxEnd / 60) * 60);
        const hrs = Array.from(
            { length: (end - start) / 60 + 1 },
            (_, i) => start / 60 + i
        );
        return { startMinutes: start, endMinutes: end, hours: hrs };
    }, [allEvents]);

    // Events laid out per day
    const eventsByDay = useMemo(() => {
        const byDay = {} as Record<CalendarEvent['day'], LaidOutEvent[]>;
        ALL_DAYS.forEach(({ key }) => {
            byDay[key] = layoutDayEvents(allEvents.filter(e => e.day === key));
        });
        return byDay;
    }, [allEvents]);

    // Saturday/Sunday columns appear only when this term's schedule uses them.
    const columns = useMemo(() => visibleDays(allEvents.map(e => e.day)), [allEvents]);
    const gridColumns = GRID_COLUMNS[columns.length] ?? GRID_COLUMNS[7];

    const gridHeight = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;

    const dayHeaderRef = useRef<HTMLDivElement>(null);

    // On a short phone the calendar shows only a few hours, so an afternoon
    // class would open out of sight. Scroll the class's first meeting into view
    // when it is not already, leaving half an hour of context above it.
    const firstPreview = useMemo(
        () => previewEvents.reduce<CalendarEvent | null>((m, e) => (!m || e.start < m.start ? e : m), null),
        [previewEvents]
    );
    // A callback ref, because Radix mounts the portal a render after this
    // component, so an effect here would still see no element.
    const scrollRef = useCallback((el: HTMLDivElement | null) => {
        if (!el || !firstPreview) return;
        const topPx = ((firstPreview.start - startMinutes) / 60) * HOUR_HEIGHT;
        const bottomPx = ((firstPreview.end - startMinutes) / 60) * HOUR_HEIGHT;
        const headerPx = dayHeaderRef.current?.offsetHeight ?? 0;
        if (headerPx + bottomPx > el.clientHeight) {
            el.scrollTop = Math.max(0, topPx - HOUR_HEIGHT / 2);
        }
    }, [firstPreview, startMinutes]);
    // The scheduled blocks are colored per course, so the legend borrows the
    // color of one that is actually drawn instead of a fixed light blue.
    const scheduledSwatch = useMemo(() => {
        const shown = existingEvents.find(e => !e.isOptional) ?? existingEvents[0];
        return shown ? getCalendarColorClasses(shown.courseId) : null;
    }, [existingEvents]);
    const blockedReason = addBlockedReason(hasVariableUnits, selectedUnits);
    const blockedReasonId = useId();

    // Modal, so Radix puts up the overlay and locks the page behind it. It was
    // non-modal with a wheel handler that handed scrolling to the page, which
    // left the course page scrolled somewhere else once the preview closed.
    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
            {/* Capped to the dynamic viewport height: the header and the Cancel/Add
                footer stay put and only the calendar scrolls, so a short phone
                never pushes the title or the Add button off screen. */}
            <DialogContent aria-modal="true" className="flex flex-col max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] sm:w-full max-w-4xl p-0 gap-0 overflow-hidden rounded-2xl" hideClose>
                {/* The shared dialog's close button is a bare 16px icon; this one
                    is a 36px target that sits clear of the title. */}
                <DialogClose asChild>
                    <Button variant="ghost" size="icon" className="absolute right-2 top-2 sm:right-3 sm:top-3 z-10 h-9 w-9 text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </Button>
                </DialogClose>
                <DialogHeader className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-border/40">
                    <DialogTitle className="text-base font-semibold flex items-center gap-2 pr-9">
                        <CalendarPlus size={16} className="text-primary shrink-0" />
                        Preview: {course.subject} {course.code} — {term}
                    </DialogTitle>
                    {/* The meeting days, time and room double as the dialog's description. */}
                    <DialogDescription asChild className="text-xs">
                        <div className="text-xs text-muted-foreground mt-1 flex flex-col gap-1.5">
                            {section.meetings?.[0] ? (
                                <>
                                    <div className="flex items-center gap-1.5 capitalize">
                                        <Calendar size={14} strokeWidth={2.5} className="text-foreground shrink-0" />
                                        <span>{(() => {
                                            const days = (section.meetings[0].days || '').toLowerCase().split(/[,\s]+/);
                                            return days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');
                                        })()}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Clock size={14} strokeWidth={2.5} className="text-foreground shrink-0" />
                                        <span>{section.meetings[0].time ? stripSeconds(section.meetings[0].time) : 'TBA'}</span>
                                    </div>
                                    {section.meetings[0].location && section.meetings[0].location !== 'TBA' && (
                                        <div className="flex items-center gap-1.5">
                                            <MapPin size={14} strokeWidth={2.5} className="text-foreground shrink-0" />
                                            <span className="truncate">{section.meetings[0].location}</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <Clock size={14} strokeWidth={2.5} className="text-foreground shrink-0" />
                                    <span>Time TBA</span>
                                </div>
                            )}
                        </div>
                    </DialogDescription>
                </DialogHeader>

                {/* Conflict warning */}
                {conflictingCourses.length > 0 && (
                    <div className="shrink-0 mx-4 sm:mx-6 mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-2">
                        <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                            Overlaps with{' '}
                            {conflictingCourses.map((c, i) => (
                                <span key={c}>
                                    <span className="font-bold">{c}</span>
                                    {i < conflictingCourses.length - 2 ? ', ' : i < conflictingCourses.length - 1 ? ' and ' : ''}
                                </span>
                            ))}
                        </p>
                    </div>
                )}

                {/* Scrollable body */}
                <div
                    ref={scrollRef}
                    className="min-h-0 flex-1 overflow-y-auto max-h-[60vh]"
                >
                    <div className="px-2 sm:px-4 pb-2">
                        <div>
                            {/* Day header, pinned while the hours scroll under it */}
                            <div ref={dayHeaderRef} className={cn("grid sticky top-0 z-30 bg-background pt-3 border-b border-border/40 mb-0", gridColumns)}>
                                <div className="p-1" />
                                {columns.map(d => (
                                    <div key={d.key} className="py-1.5 text-[10px] font-semibold text-muted-foreground text-center uppercase tracking-wide">
                                        <span className="xs:hidden">{SHORT_DAY_LABELS[d.key]}</span>
                                        <span className="hidden xs:inline">{d.label}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Grid body */}
                            <div
                                className={cn("grid relative", gridColumns)}
                                style={{ height: `${gridHeight}px`, '--start-minutes': startMinutes } as React.CSSProperties}
                            >
                                {/* Time rail */}
                                <div className="relative border-r border-border/30 bg-background/50">
                                    {hours.map((h, idx) => (
                                        <div
                                            key={h}
                                            className="absolute left-0 right-0"
                                            style={{ top: `${idx * HOUR_HEIGHT}px` }}
                                        >
                                            {idx !== hours.length - 1 && (
                                                <div className="absolute right-0 top-0 pr-0.5 sm:pr-1 text-right text-5xs sm:text-4xs text-muted-foreground whitespace-nowrap mt-1">
                                                    {`${((h + 11) % 12) + 1}${h >= 12 ? 'p' : 'a'}`}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Day columns */}
                                {columns.map(({ key }) => (
                                    <div key={key} className="relative border-r last:border-r-0 border-border/20 bg-background/30">
                                        {eventsByDay[key].map(ev => {
                                            const colWidth = 100 / ev.colCount;
                                            const leftPct = ev.colIndex * colWidth;
                                            const gutter = 2;
                                            const topPx = ((ev.start - startMinutes) / 60) * HOUR_HEIGHT;
                                            const heightPx = Math.max(18, ((ev.end - ev.start) / 60) * HOUR_HEIGHT);

                                            if (ev.isPreview) {
                                                return (
                                                    <div
                                                        key={ev.id}
                                                        className={cn(
                                                            'absolute rounded-md border-2 border-dashed px-1 py-0.5 overflow-hidden z-20',
                                                            'bg-primary/10 border-primary/50 text-primary'
                                                        )}
                                                        style={{
                                                            top: `${topPx}px`,
                                                            height: `${heightPx}px`,
                                                            left: `calc(${leftPct}% + ${gutter}px)`,
                                                            width: `calc(${colWidth}% - ${gutter * 2}px)`,
                                                        }}
                                                    >
                                                        <div className="text-[10px] font-bold leading-tight truncate">{ev.courseCode}</div>
                                                        <div className="text-[9px] opacity-70 truncate hidden sm:block">{ev.location || 'TBA'}</div>
                                                    </div>
                                                );
                                            }

                                            const colorClasses = getCalendarColorClasses(ev.courseId);
                                            return (
                                                <div
                                                    key={ev.id}
                                                    className={cn(
                                                        'absolute rounded-md border px-1 py-0.5 overflow-hidden z-10 shadow-sm',
                                                        colorClasses,
                                                        ev.isOptional && 'opacity-55 border-dashed grayscale'
                                                    )}
                                                    style={{
                                                        top: `${topPx}px`,
                                                        height: `${heightPx}px`,
                                                        left: `calc(${leftPct}% + ${gutter}px)`,
                                                        width: `calc(${colWidth}% - ${gutter * 2}px)`,
                                                    }}
                                                >
                                                    <div className="text-[10px] font-semibold leading-tight truncate">{ev.courseCode}</div>
                                                    <div className="text-[9px] opacity-75 truncate hidden sm:block">{ev.location || 'TBA'}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}

                                {/* Horizontal hour lines */}
                                <div className="absolute inset-0 pointer-events-none col-span-6">
                                    {hours.map((_, idx) => (
                                        <div
                                            key={idx}
                                            className="absolute left-0 right-0 border-t border-border/30"
                                            style={{ top: `${idx * HOUR_HEIGHT}px` }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* end scrollable body */}

                {/* Legend */}
                <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-6 py-2 text-xs text-muted-foreground border-t border-border/30">
                    <div className="flex items-center gap-1.5">
                        <div className="h-3 w-4 rounded-sm bg-primary/10 border-2 border-dashed border-primary/50" />
                        <span>This class (preview)</span>
                    </div>
                    {scheduledSwatch && (
                        <div className="flex items-center gap-1.5">
                            <div className={cn('h-3 w-4 rounded-sm border', scheduledSwatch)} />
                            <span>Already scheduled</span>
                        </div>
                    )}
                </div>

                {/* Units selector when section has variable units */}
                {hasVariableUnits && (
                    <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-border/30">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="text-sm font-semibold text-muted-foreground">Units:</span>
                            <div className="flex items-center gap-2">
                                <div className={cn("grid gap-1.5", unitOptions.length <= 3 ? "grid-cols-3" : unitOptions.length === 4 ? "grid-cols-4" : "grid-cols-5")}>
                                    {unitOptions.map((u) => (
                                        <button
                                            key={u}
                                            type="button"
                                            onClick={() => setSelectedUnits(prev => prev === u ? undefined : u)}
                                            className={cn(
                                                // 40px on phones and touch screens, the old 36 by 32 elsewhere.
                                                "flex items-center justify-center w-9 h-8 max-sm:w-10 max-sm:h-10 [@media(pointer:coarse)]:w-10 [@media(pointer:coarse)]:h-10 font-bold rounded-md transition-all text-sm",
                                                selectedUnits === u
                                                    ? "bg-primary text-primary-foreground shadow-sm"
                                                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                            )}
                                        >
                                            {u}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-tight shrink-0">units</span>
                            </div>
                        </div>
                        {blockedReason && (
                            <p id={blockedReasonId} className="mt-2 text-xs text-muted-foreground">{blockedReason}</p>
                        )}
                    </div>
                )}

                <DialogFooter className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-border/40 flex flex-row items-center justify-between sm:justify-between gap-3">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onClose}
                        className="h-10 sm:h-9"
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="h-10 sm:h-9 gap-1.5"
                        disabled={blockedReason !== null}
                        aria-describedby={blockedReason ? blockedReasonId : undefined}
                        onClick={() => { onConfirm(hasVariableUnits ? selectedUnits : undefined); onClose(); }}
                    >
                        <CalendarPlus size={13} />
                        Add to Calendar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog >
    );
}
