'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    buildInstructorDirectory,
    parseInstructorDump,
    findInstructorsByExactName,
    type InstructorDirectory,
    type InstructorDump,
    type InstructorEntry,
} from '@/lib/instructors';

let dumpPromise: Promise<InstructorDump | null> | null = null;

/**
 * Loaded on first use rather than with the catalog — most sessions never search a name.
 * Null when the download failed, which is not remembered, so the next call tries again.
 */
export function loadDump(): Promise<InstructorDump | null> {
    if (!dumpPromise) {
        dumpPromise = fetch('/catalog/instructors.json')
            .then(res => {
                if (!res.ok) throw new Error(`instructors.json ${res.status}`);
                return res.json();
            })
            .then(parseInstructorDump)
            .catch(() => {
                // Not remembered: the next search fetches again instead of
                // finding no one for the rest of the session.
                dumpPromise = null;
                return null;
            });
    }
    return dumpPromise;
}

export function useInstructorSearch(query: string): InstructorEntry[] {
    const [directory, setDirectory] = useState<InstructorDirectory | null>(null);
    const trimmed = query.trim();
    const shouldLoad = trimmed.length >= 2;

    useEffect(() => {
        if (!shouldLoad || directory) return;
        let cancelled = false;
        // Keyed on the query too: after a failed download, the next keystroke
        // retries (a download already in flight is shared, not repeated).
        loadDump().then(dump => {
            if (cancelled || !dump) return;
            setDirectory(buildInstructorDirectory(dump.names));
        });
        return () => { cancelled = true; };
    }, [shouldLoad, directory, trimmed]);

    return useMemo(
        () => (directory ? findInstructorsByExactName(directory, trimmed) : []),
        [directory, trimmed]
    );
}

/** Course-scoped initial→named slug map from the instructors dump. Empty until loaded. */
export function useCourseInstructorLinks(courseId?: string): Record<string, string> {
    const [links, setLinks] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!courseId) {
            setLinks({});
            return;
        }
        let cancelled = false;
        loadDump().then(dump => {
            if (!cancelled) setLinks(dump?.courseLinks[courseId] ?? {});
        });
        return () => { cancelled = true; };
    }, [courseId]);

    return links;
}
