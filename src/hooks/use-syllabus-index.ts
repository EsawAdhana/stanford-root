'use client';

import { useEffect, useState } from 'react';
import type { SyllabusIndex } from '@/lib/syllabus';

let indexPromise: Promise<SyllabusIndex | null> | null = null;

/**
 * Fetched on first use rather than with the catalog: it is only needed on a
 * course detail view, and a failed fetch degrades to a disabled button rather
 * than to a broken link, which is the same thing the index would say for most
 * courses anyway.
 */
export function loadIndex(): Promise<SyllabusIndex | null> {
    if (!indexPromise) {
        indexPromise = fetch('/syllabi/index.json')
            .then(res => {
                if (!res.ok) throw new Error(`syllabi index ${res.status}`);
                return res.json();
            })
            .then((data: SyllabusIndex | null) => {
                if (!data || !data.courses) throw new Error('syllabi index malformed');
                return data;
            })
            .catch(() => {
                // Null for now, but not remembered: the next course page
                // fetches again instead of disabling every syllabus button
                // for the rest of the session.
                indexPromise = null;
                return null;
            });
    }
    return indexPromise;
}

/**
 * The syllabus availability index. `loaded` distinguishes "still fetching" from
 * "fetched and this course has nothing", so the button can hold a neutral
 * pending state instead of flashing from disabled to enabled.
 */
export function useSyllabusIndex(): { index: SyllabusIndex | null; loaded: boolean } {
    const [state, setState] = useState<{ index: SyllabusIndex | null; loaded: boolean }>({
        index: null,
        loaded: false,
    });

    useEffect(() => {
        let cancelled = false;
        loadIndex().then(index => { if (!cancelled) setState({ index, loaded: true }); });
        return () => { cancelled = true; };
    }, []);

    return state;
}
