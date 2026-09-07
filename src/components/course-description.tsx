'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useCourseStore } from '@/lib/store';
import { decodeHtmlEntities } from '@/lib/utils';
import { bareLinksFor } from '@/lib/course-bare-links';

/** Only auto-link course codes when nearby preceding text looks like a prereq / requirement list (not e.g. lab fees like "$MUSIC 80"). */
const COURSE_REF_CONTEXT_RE =
    /\b(?:prerequisites?|prereqs?|corequisites?|co-?\s*requisites?|recommended|recommendations?|requirements?|suggested|prior\s+courses?|concurrent\s+enrollment)\b/i

function hasCourseReferenceContext(fullText: string, matchIndex: number): boolean {
    const lookback = 480
    const start = Math.max(0, matchIndex - lookback)
    return COURSE_REF_CONTEXT_RE.test(fullText.slice(start, matchIndex))
}

/**
 * Split a description into plain-text and course-reference segments.
 *
 * A segment's `text` is ALWAYS the author's original characters — we may wrap a
 * course reference in a link, but we never rewrite the prose. Inserting the
 * subject turned "for 80 minutes" into "for CEE 80 minutes" and "12:30 PM" into
 * "12:CEE 30 PM".
 *
 * Two kinds of reference:
 *  - "CEE 107S" — subject is in the text, resolved live against the catalog.
 *  - "Prerequisite: 240" — subject is absent, so the target comes from the
 *    reviewed list in course-bare-links.json. No entry means no link; the
 *    renderer never guesses a subject for a bare number.
 */
export function buildDescriptionSegments(
    courseId: string,
    description: string,
    resolveCourseId: (subject: string, code: string) => string | undefined,
    bareLinksOverride?: Map<number, [number, string]>,
    /**
     * Whether a course id is still in the catalog. Stanford unschedules courses, and a
     * reviewed bare link then points at a page that renders "Course Not Found" -- CS 224V
     * linked a bare "180" to LINGUIST 180 for exactly that reason. A subject-qualified
     * reference already degrades to plain text when absent, because resolveCourseId
     * returns undefined; this gives the bare-number path the same guard instead of
     * trusting the frozen target forever. Omitted means "don't check", which keeps the
     * unit tests that pass a stub resolver working.
     */
    courseExists?: (courseId: string) => boolean,
): Array<{ text: string; courseId?: string }> {
    if (!description) return [];

    const decodedText = decodeHtmlEntities(description);
    const bareLinks = bareLinksOverride ?? bareLinksFor(courseId, decodedText);
    const courseRegex = /\b(?:([A-Z]{2,4})\s*(\d{1,3}[A-Z]?)|(\d{2,3}[A-Z]?))\b/g;

    const segments: Array<{ text: string; courseId?: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = courseRegex.exec(decodedText)) !== null) {
        const precedingText = decodedText.substring(0, match.index);
        if (precedingText.endsWith('&#') || (match[3] && precedingText.match(/&#\d*$/))) {
            continue;
        }

        let courseId: string | undefined;
        if (match[3]) {
            const reviewed = bareLinks.get(match.index);
            const spanMatches = reviewed && reviewed[0] === match[0].length;
            const targetLives = spanMatches && (!courseExists || courseExists(reviewed[1]));
            courseId = targetLives ? reviewed[1] : undefined;
        } else {
            const resolved = resolveCourseId(match[1], match[2]);
            courseId = resolved && hasCourseReferenceContext(decodedText, match.index) ? resolved : undefined;
        }
        if (!courseId) continue;

        if (match.index > lastIndex) {
            segments.push({ text: decodedText.substring(lastIndex, match.index) });
        }
        segments.push({ text: match[0], courseId });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < decodedText.length) {
        segments.push({ text: decodedText.substring(lastIndex) });
    }

    return segments;
}

interface CourseDescriptionProps {
    /** Catalog id of the course being displayed; keys the reviewed bare-number links. */
    courseId: string;
    description: string;
    className?: string;
}

export function CourseDescription({ courseId, description, className }: CourseDescriptionProps) {
    const courses = useCourseStore(s => s.courses);

    const courseMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const c of courses) {
            map.set(`${c.subject}|${c.code}`, c.id);
        }
        return map;
    }, [courses]);

    const courseIds = useMemo(() => new Set(courses.map(c => c.id)), [courses]);

    const renderedParts = useMemo(() => {
        if (!description) return null;
        const segments = buildDescriptionSegments(
            courseId,
            description,
            (subject, code) => courseMap.get(`${subject}|${code}`),
            undefined,
            id => courseIds.has(id),
        );
        return segments.map((seg, i) =>
            seg.courseId
                ? (
                    <Link
                        key={`${i}-${seg.text}`}
                        href={`/${encodeURIComponent(seg.courseId)}`}
                        className="text-primary font-bold hover:underline"
                        onClick={(e) => { e.stopPropagation(); }}
                    >
                        {seg.text}
                    </Link>
                )
                : seg.text
        );
    }, [courseId, description, courseMap, courseIds]);

    if (!renderedParts) return null;

    return (
        <div className={className}>
            <p className="text-muted-foreground text-[15px] leading-relaxed font-normal">
                {renderedParts}
            </p>
        </div>
    )
}
