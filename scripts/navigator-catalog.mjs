/**
 * Stanford Navigator (PeopleSoft) catalog source.
 *
 * navigator.stanford.edu searches an Algolia index of every scheduled class,
 * and hands its browser a short-lived secured key from its own /api/generate-key.
 * That key needs no login, so the same index is the fastest complete source of
 * the class schedule — a whole academic year is ~420 queries in under a minute,
 * versus ExploreCourses' 254-department XML walk plus thousands of cross-list
 * follow-ups.
 *
 * Two limits shape everything below:
 *   1. The secured key is search-only. `browse` (the export endpoint) is 403 and
 *      `paginationLimitedTo` is 1000, so every slice must be kept under 1000 hits.
 *      `subject` is not facetable; `deptName` is, so the walk shards on
 *      deptName x term and sub-shards on career, then catalog-number ranges.
 *   2. The index holds primary-component classes only. Discussions, labs and
 *      similar hang off the primary class and come from
 *      /api/classes/{strm}/{classNbr} (also public), which is fetched only for
 *      classes whose `components` list more than one component.
 */

const APP_ID = 'RXGHAPCKOF'
const SEARCH_HOST = `https://${APP_ID}-dsn.algolia.net`
const NAV_ORIGIN = 'https://navigator.stanford.edu'

/** Secured keys expire; refresh well before that rather than parsing validUntil. */
const QUERIES_PER_KEY = 80
const DETAIL_CONCURRENCY = 12

/** Attributes the catalog needs. Dropping the rest keeps 1000-hit pages small. */
const CLASS_ATTRS = [
    'subject', 'catalogNbr', 'courseCode', 'courseTitle', 'courseDescr', 'crseId',
    'termOffered', 'strm', 'acadYearLabel', 'deptName', 'acadCareerDescr',
    'classNbr', 'classSection', 'componentPrimary', 'components', 'format',
    'units', 'gradingBasisDescr', 'geRequirements', 'curatedClassList',
    'enrlCap', 'enrlTot', 'waitCap', 'waitTot', 'enrlStatDescr', 'classStatDescr',
    'instructionModeDescr', 'meetings', 'startDt', 'endDt', 'sortPrefix',
]

/**
 * PeopleSoft spells the WAYS requirements out; ExploreCourses shipped codes, and
 * the browse GER facet, its URL parameter and lib/utils.ts all speak those codes.
 * Translating here keeps every saved filter link working after the switch.
 */
const GER_CODES = {
    'Aesthetic and Interpretive Inquiry (AII)': 'WAY-A-II',
    'Applied Quantitative Reasoning (AQR)': 'WAY-AQR',
    'Creative Expression (CE)': 'WAY-CE',
    'Ethical Reasoning (ER)': 'WAY-ER',
    'Exploring Difference and Power (EDP)': 'WAY-EDP',
    'Formal Reasoning (FR)': 'WAY-FR',
    'Scientific Method and Analysis (SMA)': 'WAY-SMA',
    'Social Inquiry (SI)': 'WAY-SI',
    COLLEGE: 'College',
}

function gerCodes(requirements) {
    if (!Array.isArray(requirements)) return []
    return requirements.map(requirement => GER_CODES[requirement] ?? requirement)
}

/** PeopleSoft's placeholder instructor; ExploreCourses omits it, so we do too. */
function isPlaceholderInstructor(last, first) {
    return String(last || '').trim().toLowerCase() === 'staff'
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}

function escapeFilterValue(value) {
    return String(value).replace(/"/g, '\\"')
}

// ── Algolia client ───────────────────────────────────────────────────────────

export function createNavigatorClient({ onKeyRefresh } = {}) {
    let key = null
    let queriesOnKey = 0
    let queryCount = 0

    async function refreshKey() {
        const res = await fetch(`${NAV_ORIGIN}/api/generate-key`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: NAV_ORIGIN,
                referer: `${NAV_ORIGIN}/classes`,
            },
            body: '{}',
            signal: AbortSignal.timeout(30000),
        })
        if (!res.ok) throw new Error(`Navigator generate-key failed: HTTP ${res.status}`)
        const data = await res.json()
        if (!data.securedApiKey) throw new Error('Navigator generate-key returned no securedApiKey')
        key = data.securedApiKey
        queriesOnKey = 0
        onKeyRefresh?.()
    }

    async function search(body) {
        if (!key || queriesOnKey >= QUERIES_PER_KEY) await refreshKey()
        queriesOnKey++
        queryCount++

        let lastErr
        for (let attempt = 1; attempt <= 6; attempt++) {
            let res
            try {
                res = await fetch(`${SEARCH_HOST}/1/indexes/classes/query`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-algolia-application-id': APP_ID,
                        'x-algolia-api-key': key,
                    },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(30000),
                })
            } catch (err) {
                lastErr = err
                if (attempt === 6) throw err
                await sleep(400 * attempt)
                continue
            }
            if (res.ok) return res.json()
            const text = await res.text()
            // An expired key reads as 403; get a fresh one and retry the same query.
            if (res.status === 403) {
                await refreshKey()
                continue
            }
            lastErr = new Error(`Algolia ${res.status}: ${text.slice(0, 200)}`)
            if (attempt === 6 || (res.status !== 429 && res.status < 500)) throw lastErr
            await sleep(400 * attempt)
        }
        throw lastErr ?? new Error('Algolia query failed')
    }

    return { search, get queryCount() { return queryCount } }
}

// ── Sharded year walk ────────────────────────────────────────────────────────

/**
 * Every hit for one filter expression, or null when the slice exceeds the
 * 1000-hit ceiling and has to be split further.
 */
async function pullSlice(client, filters) {
    const first = await client.search({
        query: '',
        filters,
        hitsPerPage: 1000,
        attributesToRetrieve: CLASS_ATTRS,
    })
    if (first.nbHits > 1000) return { overflow: true, nbHits: first.nbHits, hits: [] }
    return { overflow: false, nbHits: first.nbHits, hits: first.hits }
}

/** Catalog-number bands, used as the last resort when a career split still overflows. */
const SORT_PREFIX_EDGES = [0, 60, 100, 130, 160, 200, 250, 300, 400, 500, 700, 1000, 100000]

async function pullShard(client, filters, { warn }) {
    const slice = await pullSlice(client, filters)
    if (!slice.overflow) return slice.hits

    // Career splits the big departments (an undergrad/grad/GSB/Law/Med divide)
    // without needing to know their catalog numbering.
    const careerFacets = await client.search({ query: '', filters, hitsPerPage: 0, facets: ['acadCareerDescr'], maxValuesPerFacet: 100 })
    const careers = Object.keys(careerFacets.facets?.acadCareerDescr || {})
    if (careers.length > 1) {
        const out = []
        for (const career of careers) {
            const sub = await pullShard(client, `${filters} AND acadCareerDescr:"${escapeFilterValue(career)}"`, { warn })
            out.push(...sub)
        }
        return out
    }

    const out = []
    for (let i = 0; i < SORT_PREFIX_EDGES.length - 1; i++) {
        const banded = `${filters} AND sortPrefix >= ${SORT_PREFIX_EDGES[i]} AND sortPrefix < ${SORT_PREFIX_EDGES[i + 1]}`
        const band = await pullSlice(client, banded)
        if (band.overflow) warn?.(`Navigator slice still over the 1000 cap: ${banded} (${band.nbHits} hits)`)
        out.push(...band.hits)
    }
    return out
}

/**
 * Every scheduled primary class for the terms given, keyed by term+classNbr.
 * Throws when the collected count misses the facet count, so a silently
 * truncated pull can never be mistaken for a complete catalog.
 */
export async function fetchYearClasses(client, { yearLabel, terms, onProgress, warn } = {}) {
    const byClass = new Map()
    let expected = 0

    for (const term of terms) {
        const termFilter = `acadYearLabel:"${escapeFilterValue(yearLabel)}" AND termOffered:"${escapeFilterValue(term)}"`
        const facets = await client.search({
            query: '',
            filters: termFilter,
            hitsPerPage: 0,
            facets: ['deptName'],
            maxValuesPerFacet: 1000,
        })
        const depts = Object.keys(facets.facets?.deptName || {})
        expected += facets.nbHits
        onProgress?.({ term, termClasses: facets.nbHits, depts: depts.length, done: 0, total: depts.length, collected: byClass.size })

        let done = 0
        for (const dept of depts) {
            const hits = await pullShard(client, `${termFilter} AND deptName:"${escapeFilterValue(dept)}"`, { warn })
            for (const hit of hits) byClass.set(`${hit.strm}|${hit.classNbr}`, hit)
            done++
            onProgress?.({ term, termClasses: facets.nbHits, depts: depts.length, done, total: depts.length, collected: byClass.size })
        }
    }

    if (byClass.size < expected) {
        throw new Error(`Navigator pull incomplete: collected ${byClass.size} of ${expected} classes`)
    }
    return { classes: [...byClass.values()], expected }
}

// ── Non-primary sections ─────────────────────────────────────────────────────

/** One class's full detail record, or null when Navigator has no record for it. */
export async function fetchClassDetail(strm, classNbr) {
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await fetch(`${NAV_ORIGIN}/api/classes/${strm}/${classNbr}`, {
                headers: { accept: 'application/json', referer: `${NAV_ORIGIN}/classes` },
                signal: AbortSignal.timeout(30000),
            })
            if (res.status === 404) return null
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const text = await res.text()
            if (!text.trim()) return null
            return JSON.parse(text)
        } catch (err) {
            if (attempt === 4) throw err
            await sleep(500 * attempt)
        }
    }
    return null
}

/**
 * Seats for a cross-listed meeting, keyed `${strm}|${classNbr}` for every listing
 * in it. Each listing has its own cap, but the room has one: CS 140M (11/30) and
 * EE 186 (39/50) share a lecture capped at 50, which is full with 24 waitlisted
 * while EE 186 still reads "Open". Enrolled and waitlist add across listings,
 * caps do not, so only this record says whether the class has a seat.
 * Kept in sync with parseNavigatorSeat in src/lib/seats.ts.
 */
export function combinedSeatsFrom(strm, detail) {
    const out = new Map()
    for (const group of Array.isArray(detail?.combinedSections) ? detail.combinedSections : []) {
        const members = Array.isArray(group?.sections) ? group.sections : []
        const capacity = parseInt(group.combinedEnrlCap, 10) || 0
        if (members.length < 2 || capacity <= 0) continue
        const combined = {
            enrolled: parseInt(group.combinedEnrlTot, 10) || 0,
            capacity,
            waitlist: parseInt(group.combinedWaitTot, 10) || 0,
            waitlistMax: parseInt(group.combinedWaitCap, 10) || 0,
        }
        for (const member of members) {
            const classNbr = parseInt(member?.cmbndclassClassNbr, 10)
            if (classNbr) out.set(`${strm}|${classNbr}`, combined)
        }
    }
    return out
}

async function eachWithConcurrency(targets, concurrency, fn) {
    let next = 0
    async function worker() {
        while (next < targets.length) await fn(targets[next++])
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker))
}

/**
 * Discussions/labs for every hit that lists more than one component. Public,
 * unauthenticated, ~4KB each; a class the detail API does not know gets [] and
 * keeps its primary section from the index. The same record carries the
 * combined-section seats, so those are kept too.
 */
export async function fetchAllRelatedClasses(hits, { onProgress, warn, concurrency = DETAIL_CONCURRENCY } = {}) {
    const targets = hits.filter(hit => (hit.components || []).length > 1)
    const byClass = new Map()
    const combinedByClass = new Map()
    let done = 0

    await eachWithConcurrency(targets, concurrency, async hit => {
        try {
            const detail = await fetchClassDetail(hit.strm, hit.classNbr)
            byClass.set(`${hit.strm}|${hit.classNbr}`, Array.isArray(detail?.relatedClasses) ? detail.relatedClasses : [])
            for (const [key, combined] of combinedSeatsFrom(hit.strm, detail)) combinedByClass.set(key, combined)
        } catch (err) {
            warn?.(`related classes failed for ${hit.courseCode} ${hit.termOffered}: ${err.message}`)
        }
        done++
        if (done % 50 === 0 || done === targets.length) onProgress?.({ done, total: targets.length })
    })
    return { relatedByClass: byClass, combinedByClass, targets: targets.length }
}

/**
 * Combined-section seats for cross-listed classes the related-class pass did not
 * already read. One record names every listing in the meeting, so a class whose
 * sibling was read is skipped: about one request per shared meeting, not per
 * listing. Cross-listed here means sharing a crseId, which is what PeopleSoft
 * combines; the undergrad/grad twins ExploreCourses pairs by title come along
 * whenever either twin is read.
 */
export async function fetchCombinedSeats(hits, combinedByClass = new Map(), { onProgress, warn, concurrency = DETAIL_CONCURRENCY } = {}) {
    const listings = new Map()
    for (const hit of hits) {
        const id = courseIdFor(hit.subject, hit.catalogNbr)
        if (!id || !hit.crseId) continue
        const key = `${hit.strm}|${hit.crseId}`
        if (!listings.has(key)) listings.set(key, new Set())
        listings.get(key).add(id)
    }
    const read = new Set()
    const targets = hits.filter(hit =>
        (listings.get(`${hit.strm}|${hit.crseId}`)?.size ?? 0) > 1 &&
        !combinedByClass.has(`${hit.strm}|${hit.classNbr}`)
    )
    let done = 0
    let requests = 0

    await eachWithConcurrency(targets, concurrency, async hit => {
        const key = `${hit.strm}|${hit.classNbr}`
        if (!combinedByClass.has(key) && !read.has(key)) {
            read.add(key)
            requests++
            try {
                const detail = await fetchClassDetail(hit.strm, hit.classNbr)
                for (const [member, combined] of combinedSeatsFrom(hit.strm, detail)) combinedByClass.set(member, combined)
            } catch (err) {
                warn?.(`combined seats failed for ${hit.courseCode} ${hit.termOffered}: ${err.message}`)
            }
        }
        done++
        if (done % 50 === 0 || done === targets.length) onProgress?.({ done, total: targets.length })
    })
    return { combinedByClass, requests }
}

// ── Shaping into catalog rows ────────────────────────────────────────────────

function courseIdFor(subject, catalogNbr) {
    const s = String(subject || '').replace(/\s+/g, '')
    const c = String(catalogNbr || '').replace(/\s+/g, '')
    if (!s || !c) return null
    return `${s}${c}`.toUpperCase()
}

/**
 * ExploreCourses shape: "3-5", or "3" for a fixed-unit course.
 *
 * Takes every class of the course, not just one: the units a course can be
 * taken for vary by term (HISTORY 3F is 3-5 across the year but 3 in Autumn),
 * and `difficulty` is hours divided by the top of this range, so a per-term
 * value would move the number on the course card.
 */
function unitsLabel(...unitLists) {
    const values = unitLists
        .flatMap(units => (Array.isArray(units) ? units : [units]))
        .map(u => (u == null || u === '' ? NaN : Number(u)))
        .filter(u => Number.isFinite(u) && u !== 0)
    if (!values.length) return '0'
    const low = Math.min(...values)
    const high = Math.max(...values)
    const fmt = n => String(n).replace(/\.0$/, '')
    return low === high ? fmt(low) : `${fmt(low)}-${fmt(high)}`
}

function instructorName(last, first, overrides, sunetId) {
    const sunet = String(sunetId || '').toLowerCase()
    if (sunet && overrides[sunet]) return overrides[sunet]
    // Names are HTML-escaped upstream too, and an apostrophe is common enough in
    // a surname that one leaked through as "O&#039;Carroll, Liam" on STATS 229.
    // This is the choke point for both primary and related-class meetings.
    const l = decodeEntities(last).trim()
    const f = decodeEntities(first).trim()
    if (isPlaceholderInstructor(l, f)) return ''
    if (l && f) return `${l}, ${f}`
    return l || ''
}

/**
 * A meeting whose start equals its end is PeopleSoft's placeholder for "no
 * meeting pattern" — 2,681 of them in 2026-2027, all at noon with no days and no
 * room, and all carrying the instructor of an independent-study section. Keeping
 * the time would put a phantom noon block on the calendar and let the time
 * filter match a class that never meets, so only the time is dropped.
 */
function meetingTime(start, end) {
    if (!start || !end || start === end) return ''
    return `${start} – ${end}`
}

/**
 * Drop keys the app never reads or that carry no information. Every visitor
 * downloads full.json, so an empty string on 65k sections is 65k wasted keys.
 * Kept in sync with scripts/prune-catalog-dump.mjs.
 */
function withoutEmptyKeys(obj) {
    for (const [key, value] of Object.entries(obj)) {
        if (value === '' || value == null || (Array.isArray(value) && value.length === 0)) delete obj[key]
    }
    return obj
}

function primaryMeetings(hit, overrides) {
    return (hit.meetings || []).map(meeting => withoutEmptyKeys({
        days: (meeting.daysOfWeekList || []).join(', ') || meeting.daysOfWeek || '',
        time: meetingTime(meeting.startTime, meeting.endTime),
        location: meeting.facilityDescr || meeting.room || '',
        instructors: (meeting.instructors || [])
            .map(i => instructorName(i.lastName, i.firstName, overrides, i.sunetId))
            .filter(Boolean),
    }))
}

const RELATED_DAY_KEYS = [
    ['relatedClassMon', 'Monday'],
    ['relatedClassTues', 'Tuesday'],
    ['relatedClassWed', 'Wednesday'],
    ['relatedClassThur', 'Thursday'],
    ['relatedClassFri', 'Friday'],
    ['relatedClassSat', 'Saturday'],
    ['relatedClassSun', 'Sunday'],
]

function relatedMeetings(related, overrides) {
    return (related.relatedClassMeetings || []).map(meeting => withoutEmptyKeys({
        days: RELATED_DAY_KEYS.filter(([key]) => meeting[key] === 'Y').map(([, name]) => name).join(', '),
        time: meetingTime(
            (meeting.relatedClassStartTime || '').replace(/^0/, ''),
            (meeting.relatedClassEndTime || '').replace(/^0/, ''),
        ),
        location: meeting.relatedClassRoomDescr || meeting.relatedClassRoom || '',
        instructors: (meeting.relatedClassInstructors || [])
            .map(i => instructorName(i.relatedClassInstrLastName, i.relatedClassInstrFirstName, overrides))
            .filter(Boolean),
    }))
}

function primarySection(hit, overrides, combinedByClass) {
    const capacity = parseInt(hit.enrlCap, 10) || 0
    const enrolled = parseInt(hit.enrlTot, 10) || 0
    const combined = combinedByClass.get(`${hit.strm}|${hit.classNbr}`)
    return {
        term: hit.termOffered || '',
        classId: parseInt(hit.classNbr, 10) || 0,
        sectionNumber: String(parseInt(hit.classSection, 10) || hit.classSection || ''),
        component: hit.componentPrimary || '',
        units: unitsLabel(hit.units),
        grading: hit.gradingBasisDescr || '',
        instructionalMode: hit.instructionModeDescr || '',
        status: hit.enrlStatDescr || hit.classStatDescr || '',
        enrolled,
        capacity,
        waitlist: parseInt(hit.waitTot, 10) || 0,
        waitlistMax: parseInt(hit.waitCap, 10) || 0,
        startDate: hit.startDt || '',
        endDate: hit.endDt || '',
        meetings: primaryMeetings(hit, overrides),
        ...(gerCodes(hit.geRequirements).length ? { gers: gerCodes(hit.geRequirements) } : {}),
        ...(combined ? { combined } : {}),
    }
}

function relatedSection(hit, related, overrides) {
    const capacity = parseInt(related.relatedClassCapacityEnrollment, 10) || 0
    const enrolled = parseInt(related.relatedClassTotalEnrollment, 10) || 0
    return {
        term: hit.termOffered || '',
        classId: parseInt(related.relatedClassNbr, 10) || 0,
        sectionNumber: String(parseInt(related.relatedClassSection, 10) || related.relatedClassSection || ''),
        component: related.relatedClassComponent || '',
        // Non-primary sections carry no units of their own, matching ExploreCourses.
        units: '',
        grading: hit.gradingBasisDescr || '',
        instructionalMode: hit.instructionModeDescr || '',
        status: related.relatedClassEnrollmentStatusDescr || related.relatedClassStatusDescr || '',
        enrolled,
        capacity,
        waitlist: parseInt(related.relatedClassTotalWaitlist, 10) || 0,
        waitlistMax: parseInt(related.relatedClassCapacityWaitlist, 10) || 0,
        startDate: hit.startDt || '',
        endDate: hit.endDt || '',
        meetings: relatedMeetings(related, overrides),
        ...(gerCodes(hit.geRequirements).length ? { gers: gerCodes(hit.geRequirements) } : {}),
    }
}

/**
 * "CS 137A" sorts before "CS 240", and "CSRE 55F" before "CSRE 155F" — the order
 * ExploreCourses used inside its cross-list parentheticals.
 */
function compareDisplayCodes(a, b) {
    const parse = code => {
        const [subject, rest = ''] = code.split(' ')
        const digits = parseInt(rest, 10)
        return [subject, Number.isNaN(digits) ? 0 : digits, rest.replace(/^\d+/, '')]
    }
    const [subjectA, numberA, suffixA] = parse(a)
    const [subjectB, numberB, suffixB] = parse(b)
    return subjectA.localeCompare(subjectB) || numberA - numberB || suffixA.localeCompare(suffixB)
}

/**
 * Navigator hits (+ their related classes) as catalog rows, one per course code.
 * Cross-listed codes are separate rows, exactly as ExploreCourses published them.
 *
 * Each title keeps the "(AA 228, EE 160A)" suffix ExploreCourses appended, built
 * from PeopleSoft's crseId instead of a regex over EC's own titles. It is not
 * decoration: dump-catalog.mjs reads those codes to judge isNew across a whole
 * cross-list group, and the course page renders them as the course's other
 * codes. Navigator's own courseTitle carries no such suffix.
 */
/**
 * Navigator serves course text HTML-escaped, so a handful of descriptions
 * reach us as "the Registrar&#39;s Office" and "&lt;i&gt;The No. 1 Ladies&#39;
 * Detective Agency". Nothing downstream renders raw HTML, so the escaping is
 * pure noise on the page. `&amp;` is decoded last, otherwise "&amp;lt;"
 * would round-trip into a real "<".
 */
export function decodeEntities(text) {
    return String(text || "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
}

export function buildCourses(hits, relatedByClass = new Map(), { instructorOverrides = {}, sortTerms = t => t, combinedByClass = new Map() } = {}) {
    const byCourse = new Map()
    const displayCode = new Map()
    for (const hit of hits) {
        const id = courseIdFor(hit.subject, hit.catalogNbr)
        if (!id) continue
        if (!byCourse.has(id)) byCourse.set(id, [])
        byCourse.get(id).push(hit)
        displayCode.set(id, `${String(hit.subject).trim()} ${String(hit.catalogNbr).trim()}`)
    }

    // A course id can sit in more than one crseId group across a year (a code
    // gets reused, or a cross-list is rebuilt mid-year), so collect siblings
    // from every group the id appears in.
    const siblingsById = new Map()
    for (const group of crossListsByCrseId(hits).values()) {
        if (group.size < 2) continue
        for (const id of group) {
            if (!siblingsById.has(id)) siblingsById.set(id, new Set())
            for (const other of group) if (other !== id) siblingsById.get(id).add(other)
        }
    }

    const courses = []
    for (const [id, courseHits] of byCourse) {
        const sections = []
        const seen = new Set()
        for (const hit of courseHits) {
            for (const section of [
                primarySection(hit, instructorOverrides, combinedByClass),
                ...(relatedByClass.get(`${hit.strm}|${hit.classNbr}`) || []).map(r => relatedSection(hit, r, instructorOverrides)),
            ]) {
                const key = section.classId || `${section.term}:${section.sectionNumber}:${section.component}`
                if (seen.has(key)) continue
                seen.add(key)
                sections.push(section)
            }
        }
        if (!sections.length) continue

        // Titles and descriptions can differ per term; the latest term wins. Any
        // single class can also be missing a field the others have (GENE 278's
        // Winter and Spring classes carry no grading basis, its Autumn one
        // does), and a course with no grading is dropped from browse — so fall
        // back to the newest class that does have the field.
        const byRecency = [...courseHits].sort((a, b) => String(b.strm).localeCompare(String(a.strm)))
        const latest = byRecency[0]
        const newest = field => byRecency.find(hit => hit[field] != null && hit[field] !== '')?.[field]
        const siblings = [...(siblingsById.get(id) || [])]
            .map(sibling => displayCode.get(sibling))
            .filter(Boolean)
            .sort(compareDisplayCodes)
        const title = decodeEntities(newest('courseTitle') || '')
        courses.push({
            course_id: id,
            subject: String(latest.subject).replace(/\s+/g, ''),
            code: String(latest.catalogNbr).replace(/\s+/g, ''),
            title: siblings.length ? `${title} (${siblings.join(', ')})` : title,
            description: decodeEntities(newest('courseDescr') || ''),
            units: unitsLabel(...courseHits.map(hit => hit.units)),
            grading: newest('gradingBasisDescr') || '',
            // `m.instructors` is omitted when a meeting has none, so default before flattening.
            instructors: Array.from(new Set(sections.flatMap(s => s.meetings.flatMap(m => m.instructors || [])))),
            sections,
            terms: sortTerms(Array.from(new Set(sections.map(s => s.term).filter(Boolean)))),
        })
    }
    return courses
}

/**
 * crseId → the set of course codes PeopleSoft schedules it under. Exact
 * cross-listing, where ExploreCourses only hints at it inside course titles.
 */
export function crossListsByCrseId(hits) {
    const groups = new Map()
    for (const hit of hits) {
        const id = courseIdFor(hit.subject, hit.catalogNbr)
        if (!id || !hit.crseId) continue
        if (!groups.has(hit.crseId)) groups.set(hit.crseId, new Set())
        groups.get(hit.crseId).add(id)
    }
    return groups
}

/**
 * A handful of classes reach the index with no gradingBasisDescr (4 courses in
 * 2026-2027). A course with no grading is dropped from browse by
 * lib/course-filter.ts, so fill it from the class detail record, which does
 * carry sectionGradingBasisDescr, before the course disappears.
 */
export async function backfillMissingGrading(courses, hits, { warn } = {}) {
    const classByCourse = new Map()
    for (const hit of hits) {
        const id = courseIdFor(hit.subject, hit.catalogNbr)
        if (id && !classByCourse.has(id)) classByCourse.set(id, hit)
    }

    let filled = 0
    for (const course of courses) {
        if (course.grading) continue
        const hit = classByCourse.get(course.course_id)
        if (!hit) continue
        let detail = null
        try {
            detail = await fetchClassDetail(hit.strm, hit.classNbr)
        } catch (err) {
            warn?.(`grading lookup failed for ${course.course_id}: ${err.message}`)
            continue
        }
        const grading = detail?.sectionGradingBasisDescr || ''
        if (!grading) continue
        course.grading = grading
        for (const section of course.sections) section.grading ||= grading
        filled++
    }
    return filled
}

const CROSS_LIST_SUFFIX = /\s*\(([^)]+)\)\s*$/

/** "Black Ecologies (AFRICAAM 240C, ENGLISH 246)" -> ["AFRICAAM 240C", "ENGLISH 246"]. */
function crossListSuffix(title) {
    const match = String(title || '').match(CROSS_LIST_SUFFIX)
    if (!match) return []
    const codes = [...match[1].matchAll(/([A-Z]{2,}(?:&[A-Z]+)?)\s+(\d+[A-Z]*)/g)].map(m => `${m[1]} ${m[2]}`)
    // Only treat the parenthetical as a code list if that is all it holds.
    return codes.join(', ') === match[1].trim() ? codes : []
}

/**
 * Union the cross-list codes in two titles, keeping the Navigator base title.
 *
 * PeopleSoft's crseId does not group an undergraduate code with its graduate
 * twin (ENGLISH 168B and ENGLISH 268A are separate crseIds), but
 * ExploreCourses' title parenthetical does — and dump-catalog.mjs judges isNew
 * across whatever that parenthetical names, so dropping EC's extra codes turns
 * six long-running courses into "new" ones.
 */
export function mergeCrossListTitle(navTitle, ecTitle) {
    const extra = crossListSuffix(ecTitle)
    if (!extra.length) return navTitle
    const base = String(navTitle || '').replace(CROSS_LIST_SUFFIX, '')
    const codes = [...new Set([...crossListSuffix(navTitle), ...extra])].sort(compareDisplayCodes)
    if (!codes.length) return navTitle
    return `${base} (${codes.join(', ')})`
}
