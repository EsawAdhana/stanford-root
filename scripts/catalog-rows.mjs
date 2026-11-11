/**
 * Deciding which course rows the nightly refresh actually has to write.
 *
 * Until 2026-11-11 every run upserted all ~9,000 scraped rows and re-cleared
 * ~2,500 stale ones, although on Nov 9 to Nov 10 only ~617 rows really changed.
 * Each needless write leaves a dead row version and its TOAST chunks behind,
 * which is most of what drained the free plan's Disk IO budget. Two things made
 * unchanged rows look changed: sections and instructors came back in whatever
 * order the concurrent Navigator reads finished, and nothing compared the
 * result with what the table already held.
 */

/** The columns scrape-sections.mjs writes; everything else on a row belongs to other scripts. */
export const SCRAPED_FIELDS = ['course_id', 'subject', 'code', 'title', 'description', 'units', 'grading', 'instructors', 'sections', 'terms']

const naturalOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' })

/** JSON with every object's keys sorted, so two values that differ only in key order are equal. */
export function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item === undefined ? null : item)).join(',')}]`
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
        return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

function compareSections(termKey) {
    return (a, b) =>
        termKey(a.term) - termKey(b.term) ||
        naturalOrder.compare(String(a.term ?? ''), String(b.term ?? '')) ||
        naturalOrder.compare(String(a.sectionNumber ?? ''), String(b.sectionNumber ?? '')) ||
        // A section with units is the primary class; it led its discussions before.
        Number(!a.units) - Number(!b.units) ||
        naturalOrder.compare(String(a.component ?? ''), String(b.component ?? '')) ||
        (Number(a.classId) || 0) - (Number(b.classId) || 0) ||
        naturalOrder.compare(stableStringify(a), stableStringify(b))
}

/**
 * One fixed order for a course's sections and instructors, whatever order the
 * reads finished in. Sections go by term (chronological), then section number
 * (the order the course page already shows them in), the primary class before
 * the discussions that share its number, then component and class number.
 * Instructors keep exactly the set the row had, ordered by where they first
 * teach in those sections; any name no meeting carries goes last, alphabetically.
 * Mutates and returns the course.
 */
export function canonicalizeCourse(course, { termKey }) {
    const sections = [...(course.sections || [])].sort(compareSections(termKey))
    course.sections = sections
    const firstSeen = new Map()
    for (const section of sections) {
        for (const meeting of section.meetings || []) {
            for (const name of meeting.instructors || []) {
                if (!firstSeen.has(name)) firstSeen.set(name, firstSeen.size)
            }
        }
    }
    const rank = name => firstSeen.has(name) ? firstSeen.get(name) : Number.MAX_SAFE_INTEGER
    course.instructors = [...(course.instructors || [])].sort((a, b) => rank(a) - rank(b) || naturalOrder.compare(a, b))
    return course
}

/**
 * The scraped rows that differ from the last committed dump in any column the
 * scrape writes. A row the dump does not have (new, or cleared last time) is
 * always written. The dump is the table as the last successful run left it, so
 * a row equal to it is already in the table.
 */
export function rowsToWrite(courses, previousRows) {
    const previousById = new Map((previousRows || []).map(row => [row.course_id, row]))
    const fingerprint = row => stableStringify(SCRAPED_FIELDS.map(field => row[field] ?? null))
    return courses.filter(course => {
        const previous = previousById.get(course.course_id)
        return !previous || fingerprint(previous) !== fingerprint(course)
    })
}

/**
 * Rows the scrape no longer returns that still hold a schedule. A stale row
 * whose terms are already empty and that the last dump did not carry was
 * cleared on an earlier night; clearing it again rewrites the same empty value.
 * The dump check catches a row whose terms are empty but whose sections are not,
 * since the dump keeps every row that has sections.
 */
export function staleIdsToClear(existingRows, incomingIds, previousRows) {
    const inLastDump = new Set((previousRows || []).map(row => row.course_id))
    return existingRows
        .filter(row => !incomingIds.has(row.course_id))
        .filter(row => (row.terms || []).length > 0 || inLastDump.has(row.course_id))
        .map(row => row.course_id)
}
