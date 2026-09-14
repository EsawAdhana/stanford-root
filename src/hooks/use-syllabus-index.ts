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
function loadIndex(): Promise<SyllabusIndex | null> {
    if (!indexPromise) {
        indexPromise = fetch('/syllabi/index.json')
            .then(res => (res.ok ? res.json() : null))
            .then((data: SyllabusIndex | null) =>
                data && data.courses ? data : null
            )
            .catch(() => null);
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
