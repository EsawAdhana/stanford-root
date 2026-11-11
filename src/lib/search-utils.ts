import type { Course } from '@/types/course';
import { getAlternateCourseCodesFromTitle, normalizeCourseId } from '@/lib/utils';

const nameTokens = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s,.]+/).filter(Boolean);

/**
 * Whether a multi-word query names this instructor, in either order and with or
 * without the comma: "Mehran Sahami", "sahami mehran" and "Sahami, Mehran" all
 * name "Sahami, Mehran". Catalog entries often carry only an initial
 * ("Sahami, M."), so a query word also matches an initial it starts with, but
 * at least one word has to match a whole name, or "mehran sahami" would match
 * every "Smith, M. S.".
 */
export function queryNamesInstructor(query: string, instructor: string): boolean {
    const words = nameTokens(query);
    if (words.length < 2) return false;
    const parts = nameTokens(instructor);
    const used = new Set<number>();
    let wholeNames = 0;
    for (const word of words) {
        let at = parts.findIndex((p, i) => !used.has(i) && p === word);
        if (at >= 0) wholeNames++;
        else at = parts.findIndex((p, i) => !used.has(i) && p.length === 1 && word.startsWith(p));
        if (at < 0) return false;
        used.add(at);
    }
    return wholeNames > 0;
}

/**
 * "CS-106A" and "cs.106a" mean "CS 106A": a hyphen, dot, underscore or slash
 * between a subject and its number reads as a space. Only at that join, so
 * "data-driven" and "e.g." stay as typed.
 */
export function normalizeSearchQuery(query: string): string {
    return query.replace(/^(\s*[A-Za-z&]+)\s*[-.\u2010-\u2014_/]+\s*(?=\d)/, '$1 ');
}

/**
 * For a query shaped like one course code ("cs106a", "CS 106", "cs-106a"), how
 * closely each course's code matches it: 0 for the course itself, 1 for codes
 * that start with the query, 2 for everything else the search found (titles,
 * cross-listings). The list sorts by this first, so "cs106a" leads with CS 106A
 * instead of CS 100ACE. Null for any other query, which keeps the chosen sort.
 */
export function codeMatchRank(query: string): ((course: Course) => number) | null {
    const compact = normalizeSearchQuery(query).toLowerCase().replace(/\s+/g, '');
    if (!/^[a-z&]+\d+[a-z]*$/.test(compact)) return null;
    return course => {
        const code = `${course.subject}${course.code}`.toLowerCase().replace(/\s+/g, '');
        if (code === compact) return 0;
        if (code.startsWith(compact)) return 1;
        return 2;
    };
}

/**
 * Filters a list of courses based on a search query.
 * This function encapsulates the core text-matching logic used across the application.
 *
 * @param courses The array of courses to search through.
 * @param query The search string provided by the user.
 * @returns A new array of filtered courses.
 */
export function searchCourses(courses: Course[], query: string): Course[] {
    if (!query) return courses;
    query = normalizeSearchQuery(query);

    let result = courses;
    const lowerQuery = query.toLowerCase().trim();
    const compactQuery = lowerQuery.replace(/\s+/g, '');
    const parts = lowerQuery.split(/\s+/).filter(Boolean);

    const allSubjects = new Set(courses.map(c => c.subject));

    let subject = parts[0]?.toUpperCase() || '';
    let remainingQuery = parts.slice(1).join(' ');

    // Support searches like "cs106a" (combined subject and code) as well as "cs 106a"
    if (parts.length === 1 && compactQuery) {
        const m = compactQuery.match(/^([a-z&]+)(\d.*)$/i);
        if (m) {
            const maybeSubject = m[1].toUpperCase();
            if (allSubjects.has(maybeSubject)) {
                subject = maybeSubject;
                remainingQuery = m[2] || '';
            }
        }
    }

    const queryNorm = normalizeCourseId(compactQuery);

    const isSubjectSearch = Boolean(subject) && allSubjects.has(subject);

    if (isSubjectSearch) {
        result = result.filter(c => c.subject === subject);

        if (remainingQuery) {
            const remainingLower = remainingQuery.toLowerCase().trim();
            const remainingCompact = remainingLower.replace(/\s+/g, '');
            result = result.filter(c => {
                const codeCompact = (c.code || '').toLowerCase().replace(/\s+/g, '');
                if (codeCompact.includes(remainingCompact)) return true;
                if ((c.title || '').toLowerCase().includes(remainingLower)) return true;
                // Match when query is an alternate code in this course's title (e.g. "238v" and title has "(CS 238V)")
                if (queryNorm) {
                    const alts = getAlternateCourseCodesFromTitle(c.title || '');
                    if (alts.some(alt => alt === queryNorm)) return true;
                }
                return false; /* No instructor search under explicit subject */
            });
        }
    } else {
        result = result.filter(c => {
            const subjectCodeSpaced = `${c.subject} ${c.code}`.toLowerCase();
            const subjectCodeCompact = `${c.subject}${c.code}`.toLowerCase().replace(/\s+/g, '');
            const codeCompact = (c.code || '').toLowerCase().replace(/\s+/g, '');

            if (subjectCodeSpaced.startsWith(lowerQuery)) return true;
            if (subjectCodeCompact.startsWith(compactQuery)) return true;
            if (codeCompact.includes(compactQuery)) return true;
            if ((c.title || '').toLowerCase().includes(lowerQuery)) return true;
            if (queryNorm) {
                const alts = getAlternateCourseCodesFromTitle(c.title || '');
                if (alts.some(alt => alt === queryNorm)) return true;
            }
            if (c.instructors && c.instructors.some(i => i.toLowerCase().includes(lowerQuery) || queryNamesInstructor(lowerQuery, i))) return true;
            return false;
        });
    }

    return result;
}

/**
 * The exclude list after the student types a keyword and presses Enter, or null
 * when there is nothing to add. Exclusion ignores case, so "intro" and "INTRO"
 * are one keyword and one chip, not two.
 */
export function addExcludedKeyword(words: string[], input: string): string[] | null {
    const word = input.trim();
    if (!word) return null;
    const lower = word.toLowerCase();
    if (words.some(w => w.toLowerCase() === lower)) return null;
    return [...words, word];
}
