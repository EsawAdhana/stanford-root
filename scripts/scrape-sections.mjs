/**
 * Scrape section data from Stanford Navigator (PeopleSoft, via its public
 * Algolia index) and update Supabase.
 *
 * Navigator replaced ExploreCourses as the source on 2026-08-25: it is the same
 * PeopleSoft data Axess enrols from, it is ~4x faster to pull, and it carries
 * meeting days, times, dates, instruction mode and GERs that the XML either
 * mangles or leaves blank. The ExploreCourses walk is still here behind
 * --with-explorecourses, because EC publishes a few dozen catalog listings that
 * Navigator has no class record for (see --compare-sources).
 *
 * Usage:
 *   node --env-file=.env.local scripts/scrape-sections.mjs                        # full run from Navigator
 *   node --env-file=.env.local scripts/scrape-sections.mjs --dry-run              # fetch and compare only
 *   node --env-file=.env.local scripts/scrape-sections.mjs --with-explorecourses  # also merge EC-only courses
 *   node --env-file=.env.local scripts/scrape-sections.mjs --compare-sources      # diff Navigator vs EC, no writes
 *   node --env-file=.env.local scripts/scrape-sections.mjs --out catalog.json      # write rows to a file, not Supabase
 *   node --env-file=.env.local scripts/scrape-sections.mjs --academic-year 20262027
 *   node --env-file=.env.local scripts/scrape-sections.mjs --resume               # only rows on a different year
 *   node --env-file=.env.local scripts/scrape-sections.mjs --course CS106B        # single course
 *   node --env-file=.env.local scripts/scrape-sections.mjs --prior-years          # record which courses the 3 previous catalogs offered
 *   node --env-file=.env.local scripts/scrape-sections.mjs --rebuild-prior        # re-derive all 3 prior years from Navigator (see the warning on recordPriorOfferings)
 */

import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'
import {
    backfillMissingGrading,
    buildCourses,
    combinedSeatsFrom,
    mergeCrossListTitle,
    createNavigatorClient,
    crossListsByCrseId,
    decodeEntities,
    fetchAllRelatedClasses,
    fetchClassDetail,
    fetchCombinedSeats,
    fetchYearClasses,
} from './navigator-catalog.mjs'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** SUNet → full "Last, First" for people ExploreCourses only stores as an initial. */
const INSTRUCTOR_OVERRIDES = JSON.parse(
    readFileSync(join(__dirname, 'instructor-name-overrides.json'), 'utf8')
)

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CATALOG_CONCURRENCY = 6
const BASE_URL = 'https://explorecourses.stanford.edu/search'
const BROWSE_URL = 'https://explorecourses.stanford.edu/browse'

// How many past catalogs `--prior-years` records, and where it stores them.
// dump-catalog.mjs reads this file to flag courses as new.
const PRIOR_YEAR_COUNT = 3
const PRIOR_OFFERINGS_PATH = join(__dirname, 'prior-offerings.json')

// NQTR attribute value → human-readable term.
// Derived from the active academic year so it self-rolls every year and never
// needs manual edits. Only used as a fallback when a section lacks a <term>
// element; the primary parser (parseSectionTerm) handles the authoritative year.
function buildNqtrMap(now = new Date()) {
    // Academic year starts in Autumn. Sep-Dec → AY starts this calendar year;
    // Jan-Aug → AY started the previous calendar year.
    const ayStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
    return {
        AUT: `Autumn ${ayStart}`,
        FAL: `Autumn ${ayStart}`,
        WIN: `Winter ${ayStart + 1}`,
        SPR: `Spring ${ayStart + 1}`,
        SUM: `Summer ${ayStart + 1}`,
    }
}
const NQTR_MAP = buildNqtrMap()

// Chronological term sort: by calendar year, then season-within-year
// (Winter < Spring < Summer < Autumn). Keeps `terms[0]` sensible downstream.
const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Autumn: 3, Fall: 3 }
function termSortKey(term) {
    const parts = (term || '').trim().split(/\s+/)
    const season = parts[0] || ''
    const year = parseInt(parts[parts.length - 1], 10) || 0
    return year * 10 + (SEASON_ORDER[season] ?? 0)
}
function sortTerms(terms) {
    return [...terms].sort((a, b) => termSortKey(a) - termSortKey(b))
}

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2)
    const opts = {
        course: null,
        dryRun: false,
        resume: false,
        withExploreCourses: false,
        compareSources: false,
        out: null,
        priorYears: false,
        rebuildPrior: false,
        academicYear: defaultAcademicYear(),
    }
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') opts.dryRun = true
        if (args[i] === '--resume') opts.resume = true
        if (args[i] === '--with-explorecourses') opts.withExploreCourses = true
        if (args[i] === '--compare-sources') opts.compareSources = true
        if (args[i] === '--out' && args[i + 1]) opts.out = args[i + 1]
        if (args[i] === '--prior-years') opts.priorYears = true
        if (args[i] === '--rebuild-prior') { opts.priorYears = true; opts.rebuildPrior = true }
        if (args[i] === '--course' && args[i + 1]) opts.course = args[i + 1].trim().toUpperCase()
        if (args[i] === '--academic-year' && /^\d{8}$/.test(args[i + 1] || '')) {
            opts.academicYear = args[i + 1]
        }
    }
    return opts
}

function academicYearLabel(academicYear) {
    // "20262027" → "2026-2027"
    return `${academicYear.slice(0, 4)}-${academicYear.slice(4)}`
}

function termsForAcademicYear(academicYear) {
    const start = parseInt(academicYear.slice(0, 4), 10)
    return [
        `Autumn ${start}`,
        `Winter ${start + 1}`,
        `Spring ${start + 1}`,
        `Summer ${start + 1}`,
    ]
}

/** "20262027" → ["20232024", "20242025", "20252026"] (oldest first). */
function priorAcademicYears(academicYear, count = PRIOR_YEAR_COUNT) {
    const start = parseInt(academicYear.slice(0, 4), 10)
    return Array.from({ length: count }, (_, i) => {
        const y = start - count + i
        return `${y}${y + 1}`
    })
}

function defaultAcademicYear(now = new Date()) {
    // Stanford publishes the next catalog during summer. Trying it early is safe:
    // full-catalog validation aborts before writes if the API has not published data.
    const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
    return `${start}${start + 1}`
}

// ── XML Parsing ───────────────────────────────────────────────────────────────

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    isArray: (name) => ['school', 'department', 'course', 'section', 'schedule', 'instructor', 'attribute', 'day'].includes(name),
    textNodeName: '_text',
})

function ensureArray(val) {
    if (!val) return []
    return Array.isArray(val) ? val : [val]
}

function textVal(v) {
    if (v == null || v === '') return ''
    if (typeof v === 'object' && '_text' in v) return String(v._text ?? '').trim()
    return String(v).trim()
}

function parseDays(schedule) {
    // Days are represented as child elements inside <days>. fast-xml-parser
    // captures these differently depending on content — we check common keys.
    const days = schedule?.days
    if (!days) return ''
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const found = dayNames.filter(d => days[d] !== undefined)
    if (found.length > 0) return found.join(', ')
    // Fallback — sometimes returned as a plain string, and then it arrives with
    // the newlines and tabs ExploreCourses indents its markup with:
    // "Monday\n\t\t\t...\n\t\t\tWednesday". Collapse that to the same
    // comma-joined shape Navigator sends, so one day format reaches the client.
    if (typeof days === 'string') {
        return days.split(/\s*[\n\r]+\s*|\s*,\s*/).map(d => d.trim()).filter(Boolean).join(', ')
    }
    return ''
}

function parseGers(courseNode, sectionNode) {
    const gers = new Set()
    // Course-level <gers>
    const courseGers = courseNode?.gers
    if (typeof courseGers === 'string' && courseGers.trim()) {
        courseGers.split(',').forEach(g => { const t = g.trim(); if (t) gers.add(t) })
    }
    // Section-level attributes (WAY-*, GER-*)
    const attrs = ensureArray(sectionNode?.attributes?.attribute)
    for (const attr of attrs) {
        const name = attr?.name || ''
        const desc = attr?.description || ''
        if (name.startsWith('WAY') || name.startsWith('GER') || name === 'WIM') {
            gers.add(desc || name)
        }
    }
    return Array.from(gers)
}

function parseSectionTerm(sectionNode) {
    // 1. Try direct <term> element first (e.g. "2025-2026 Autumn")
    const rawTerm = sectionNode?.term
    if (rawTerm && typeof rawTerm === 'string') {
        const parts = rawTerm.trim().split(/\s+/)
        if (parts.length === 2 && parts[0].includes('-')) {
            const years = parts[0].split('-')
            const quarter = parts[1]
            if (quarter === 'Autumn' || quarter === 'Fall') return `Autumn ${years[0]}`
            if (quarter === 'Winter') return `Winter ${years[1]}`
            if (quarter === 'Spring') return `Spring ${years[1]}`
            if (quarter === 'Summer') return `Summer ${years[1]}`
        }
        return rawTerm
    }

    // 2. Fallback to NQTR attribute
    const attrs = ensureArray(sectionNode?.attributes?.attribute)
    for (const attr of attrs) {
        if (attr?.name === 'NQTR' || attr?._name === 'NQTR') {
            const val = attr?.value || attr?._value || ''
            return NQTR_MAP[val] || val
        }
    }
    return ''
}

/**
 * ExploreCourses puts the abbreviated form in <name> ("Zou, J.") and the real
 * person in <firstName>/<lastName> (plus <sunet>). Prefer the full name so
 * instructor pages don't collide on shared initials. A handful of people still
 * only have an initial in <firstName>; override those by SUNet.
 */
function instructorFullName(node) {
    const sunet = textVal(node?.sunet).toLowerCase()
    if (sunet && INSTRUCTOR_OVERRIDES[sunet]) return INSTRUCTOR_OVERRIDES[sunet]
    // Escaped the same way Navigator escapes them — see instructorName there.
    const first = decodeEntities(textVal(node?.firstName))
    const last = decodeEntities(textVal(node?.lastName))
    if (first && last) return `${last}, ${first}`
    return decodeEntities(textVal(node?.name))
}

/** Strips ExploreCourses' seconds from a list of times, and refuses a range
 *  that is missing one end — "12:00 PM" with no start renders as a phantom
 *  meeting on the calendar. */
function dropSeconds(times) {
    if (times.length < 2) return []
    return times.map(t => String(t).replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1'))
}

function parseSection(sectionNode, courseNode) {
    const schedules = ensureArray(sectionNode?.schedules?.schedule)

    const meetings = schedules.map(sched => ({
        days: parseDays(sched),
        // ExploreCourses prints seconds on every time ("10:30:00 AM"), Navigator
        // does not. Drop them here so the dump has one time format. Only the
        // seconds group is matched — stripping every ":00" would turn "3:00:00
        // PM" into "3 PM". A start with no end (CS195 sends one) is dropped
        // rather than published as a half-range.
        time: dropSeconds([sched?.startTime, sched?.endTime].filter(Boolean)).join(' – '),
        location: sched?.location || '',
        instructors: ensureArray(sched?.instructors?.instructor).map(instructorFullName).filter(Boolean),
    }))

    return {
        term: parseSectionTerm(sectionNode),
        classId: parseInt(sectionNode?.classId, 10) || 0,
        sectionNumber: String(sectionNode?.sectionNumber || ''),
        component: sectionNode?.component || '',
        // ExploreCourses puts section units in a single <units> element (e.g. "3" or "1-3"),
        // not minUnits/maxUnits — reading the wrong field left every section's units blank.
        units: textVal(sectionNode?.units) || '',
        grading: courseNode?.grading || '',
        ...(textVal(sectionNode?.classLevel) ? { classLevel: textVal(sectionNode.classLevel) } : {}),
        instructionalMode: sectionNode?.instructionalMode || '',
        status: sectionNode?.enrollStatus || '',
        enrolled: parseInt(sectionNode?.currentClassSize, 10) || 0,
        capacity: parseInt(sectionNode?.maxClassSize, 10) || 0,
        waitlist: parseInt(sectionNode?.currentWaitlistSize, 10) || 0,
        waitlistMax: parseInt(sectionNode?.maxWaitlistSize, 10) || 0,
        startDate: sectionNode?.startDate || '',
        endDate: sectionNode?.endDate || '',
        meetings,
        gers: parseGers(courseNode, sectionNode),
    }
}

// ── XML Fetch & Parse ─────────────────────────────────────────────────────────

async function fetchXml(url) {
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Cookie': 'jsenabled=1',
                },
                signal: AbortSignal.timeout(30000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return await res.text()
        } catch (e) {
            lastErr = e
            if (attempt === 2) throw e instanceof Error ? e : new Error(String(e))
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('No XML response')
}

function parseCourseNode(courseNode) {
    const subject = textVal(courseNode?.subject).replace(/\s+/g, '')
    const code = textVal(courseNode?.code).replace(/\s+/g, '')
    if (!subject || !code) return null

    const sections = ensureArray(courseNode?.sections?.section).map(section => parseSection(section, courseNode))
    const uniqueSections = []
    const seen = new Set()
    for (const section of sections) {
        const key = section.classId || `${section.term}:${section.sectionNumber}:${section.component}`
        if (seen.has(key)) continue
        seen.add(key)
        uniqueSections.push(section)
    }

    const instructors = Array.from(new Set(
        uniqueSections.flatMap(section => section.meetings.flatMap(meeting => meeting.instructors))
    ))

    return {
        course_id: `${subject}${code}`.toUpperCase(),
        subject,
        code,
        title: decodeEntities(textVal(courseNode?.title)),
        // The XML double-escapes some entities into "&#QUOT 039;", which no
        // generic decoder handles, so those two shapes are repaired before
        // decodeEntities takes the ordinary ones.
        description: decodeEntities(
            textVal(courseNode?.description)
                .replace(/&#[A-Z]+\s+039;/g, "'")
                .replace(/&#[A-Z]+\s+034;/g, '"')
        ),
        units: [textVal(courseNode?.unitsMin), textVal(courseNode?.unitsMax)]
            .filter(value => value && value !== '0')
            .join('-') || textVal(courseNode?.unitsMin),
        grading: textVal(courseNode?.grading),
        instructors,
        sections: uniqueSections,
        terms: sortTerms(Array.from(new Set(uniqueSections.map(section => section.term).filter(Boolean)))),
    }
}

function mergeCatalogCourse(existing, incoming) {
    if (!existing) return incoming
    const sections = [...existing.sections, ...incoming.sections]
    const seen = new Set()
    const uniqueSections = sections.filter(section => {
        const key = section.classId || `${section.term}:${section.sectionNumber}:${section.component}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
    return {
        ...existing,
        title: existing.title || incoming.title,
        description: existing.description || incoming.description,
        units: existing.units || incoming.units,
        grading: existing.grading || incoming.grading,
        instructors: Array.from(new Set([...existing.instructors, ...incoming.instructors])),
        sections: uniqueSections,
        terms: sortTerms(Array.from(new Set(uniqueSections.map(section => section.term).filter(Boolean)))),
    }
}

/**
 * Subjects that offer Active courses but are missing from ExploreCourses /browse
 * (so the department walk never hits them). Keep short; cross-list follow-up
 * below also pulls siblings referenced from titles.
 */
const ORPHAN_SUBJECTS = ['PHOTON', 'TRAM']

/** "Foo (CS 238, EE 160A)" / "(MS&E 256)" → ["CS238", "EE160A"] / ["MS&E256"]. */
function extractCrossListedIds(title) {
    const ids = []
    for (const match of String(title || '').matchAll(/\(([^)]+)\)/g)) {
        const inner = match[1]
        if (!/[A-Z]{2,}(?:&[A-Z]+)?\s+\d/i.test(inner)) continue
        for (const code of inner.matchAll(/([A-Z]{2,}(?:&[A-Z]+)?)\s+(\d+[A-Z]*)/gi)) {
            ids.push(`${code[1]}${code[2]}`.toUpperCase().replace(/\s+/g, ''))
        }
    }
    return ids
}

function splitCourseId(courseId) {
    const id = String(courseId || '').toUpperCase().replace(/\s+/g, '')
    const match = id.match(/^([A-Z&]+)(\d.*)$/)
    if (!match) return null
    return { subject: match[1], code: match[2] }
}

async function fetchDepartmentCourses(department, academicYear) {
    const params = new URLSearchParams({
        view: 'xml-20200810',
        academicYear,
        q: department,
        [`filter-departmentcode-${department}`]: 'on',
        'filter-coursestatus-Active': 'on',
    })
    const parsed = parser.parse(await fetchXml(`${BASE_URL}?${params}`))
    return ensureArray((parsed?.xml ?? parsed)?.courses?.course)
}

/** Subject search without a browse department code (PHOTON / TRAM orphans). */
async function fetchSubjectCourses(subject, academicYear) {
    const params = new URLSearchParams({
        view: 'xml-20200810',
        academicYear,
        q: subject,
        'filter-coursestatus-Active': 'on',
    })
    const parsed = parser.parse(await fetchXml(`${BASE_URL}?${params}`))
    const target = subject.toUpperCase().replace(/\s+/g, '')
    return ensureArray((parsed?.xml ?? parsed)?.courses?.course).filter(node => {
        const s = textVal(node?.subject).replace(/\s+/g, '').toUpperCase()
        return s === target
    })
}

function ingestCourseNodes(catalog, nodes) {
    let added = 0
    for (const node of nodes) {
        const course = parseCourseNode(node)
        if (!course) continue
        const before = catalog.has(course.course_id)
        catalog.set(course.course_id, mergeCatalogCourse(catalog.get(course.course_id), course))
        if (!before) added++
    }
    return added
}

/**
 * Pull courses ExploreCourses lists only as cross-list siblings, or under
 * subjects absent from /browse, so the catalog is not limited to browse depts.
 */
async function fetchOrphanAndCrossListed(catalog, academicYear, browseDepartments) {
    const browseSet = new Set(browseDepartments.map(d => d.toUpperCase()))

    // 1) Known orphan subjects (not in /browse at all).
    const orphanSubjects = ORPHAN_SUBJECTS.filter(s => !browseSet.has(s))
    for (let i = 0; i < orphanSubjects.length; i += CATALOG_CONCURRENCY) {
        const batch = orphanSubjects.slice(i, i + CATALOG_CONCURRENCY)
        const results = await Promise.all(batch.map(subject => fetchSubjectCourses(subject, academicYear)))
        for (const nodes of results) ingestCourseNodes(catalog, nodes)
    }
    if (orphanSubjects.length) {
        console.log(`Fetched ${orphanSubjects.length} orphan subjects: ${orphanSubjects.join(', ')}`)
    }

    // 2) Cross-list IDs named in titles but missing / unscheduled in the catalog.
    const missingIds = new Set()
    for (const course of catalog.values()) {
        for (const id of extractCrossListedIds(course.title)) {
            const existing = catalog.get(id)
            if (!existing || existing.sections.length === 0) missingIds.add(id)
        }
    }

    const missing = [...missingIds]
    let fetched = 0
    for (let i = 0; i < missing.length; i += CATALOG_CONCURRENCY) {
        const batch = missing.slice(i, i + CATALOG_CONCURRENCY)
        const results = await Promise.all(batch.map(async id => {
            const parts = splitCourseId(id)
            if (!parts) return null
            try {
                return await fetchSections(parts.subject, parts.code, academicYear)
            } catch (err) {
                console.warn(`  ⚠ cross-list fetch failed for ${id}: ${err.message}`)
                return null
            }
        }))
        for (const course of results) {
            if (!course) continue
            catalog.set(course.course_id, mergeCatalogCourse(catalog.get(course.course_id), course))
            fetched++
        }
        process.stdout.write(`\rFetched cross-list ${Math.min(i + CATALOG_CONCURRENCY, missing.length)}/${missing.length}`)
    }
    if (missing.length) process.stdout.write('\n')
    console.log(`Cross-list follow-up: ${missing.length} candidates, ${fetched} scheduled courses merged`)
}

async function fetchCatalog(academicYear) {
    const browseUrl = `${BROWSE_URL}?view=xml-20200810&academicYear=${academicYear}`
    const browse = parser.parse(await fetchXml(browseUrl))
    const schools = ensureArray(browse?.schools?.school)
    const departments = Array.from(new Set(
        schools.flatMap(school => ensureArray(school?.department))
            .map(department => textVal(department?._name || department?.name))
            .filter(Boolean)
    ))

    if (departments.length < 100) {
        throw new Error(`Catalog validation failed: found only ${departments.length} departments`)
    }

    const catalog = new Map()
    for (let i = 0; i < departments.length; i += CATALOG_CONCURRENCY) {
        const batch = departments.slice(i, i + CATALOG_CONCURRENCY)
        const results = await Promise.all(batch.map(department => fetchDepartmentCourses(department, academicYear)))

        for (const nodes of results) ingestCourseNodes(catalog, nodes)
        process.stdout.write(`\rFetched ${Math.min(i + CATALOG_CONCURRENCY, departments.length)}/${departments.length} departments`)
    }
    process.stdout.write('\n')

    await fetchOrphanAndCrossListed(catalog, academicYear, departments)

    const scheduledCourses = Array.from(catalog.values()).filter(course => course.sections.length > 0)
    if (scheduledCourses.length < 5000) {
        throw new Error(`Catalog validation failed: found only ${scheduledCourses.length} scheduled courses; no database writes made`)
    }
    return { departments, courses: scheduledCourses }
}

/**
 * Which courses each of the previous PRIOR_YEAR_COUNT catalogs scheduled, so
 * dump-catalog.mjs can tell a genuinely new course from one that simply never
 * collects evaluations. Past catalogs never change, so years already on disk
 * are reused instead of refetched.
 *
 * The years on disk were recorded from ExploreCourses, which counts ~250 more
 * ids per year than Navigator: almost all of them cross-list codes EC named in
 * a course title but never scheduled (of 248 such ids for 2025-2026, 235 have
 * no sections in ExploreCourses either, and 0 are in Navigator that year).
 * Dropping an id from this file turns a long-running course into a "new" one on
 * the browse page, so a year is only ever added to, never replaced — even under
 * --rebuild-prior. That keeps isNew stable across the source switch.
 */
async function recordPriorOfferings(opts) {
    const years = priorAcademicYears(opts.academicYear)
    const cached = existsSync(PRIOR_OFFERINGS_PATH)
        ? JSON.parse(readFileSync(PRIOR_OFFERINGS_PATH, 'utf8'))
        : {}

    const offerings = {}
    for (const year of years) {
        const known = new Set(cached[year] || [])
        if (known.size && !opts.rebuildPrior) {
            offerings[year] = [...known].sort()
            console.log(`${academicYearLabel(year)}: ${known.size} scheduled courses (cached)`)
            continue
        }
        console.log(`Fetching ${academicYearLabel(year)} catalog from Navigator...`)
        const client = createNavigatorClient()
        const yearLabel = academicYearLabel(year)
        const terms = termsForAcademicYear(year)
        const { classes } = await fetchYearClasses(client, {
            yearLabel,
            terms,
            warn: message => console.warn(`  \u26a0 ${message}`),
            onProgress: ({ term, done, total, collected }) => {
                process.stdout.write(`\r  ${term}: ${done}/${total} depts, ${collected} classes`)
                if (done === total) process.stdout.write('\n')
            },
        })

        // Cross-list siblings count as offered: which sibling carries the
        // sections moves between years (CS 224U was scheduled as SYMSYS 195U),
        // and a course taught under any of its codes was taught. PeopleSoft's
        // crseId groups those codes exactly, where ExploreCourses only hinted
        // at them inside course titles.
        const ids = new Set(known)
        const before = ids.size
        for (const group of crossListsByCrseId(classes).values()) {
            for (const id of group) ids.add(id)
        }
        offerings[year] = [...ids].sort()
        console.log(
            `${academicYearLabel(year)}: ${offerings[year].length} scheduled courses`
            + (before ? ` (${before} already recorded, ${offerings[year].length - before} added)` : '')
        )
    }

    if (opts.dryRun) {
        console.log('Dry run - not writing prior-offerings.json')
        console.log(JSON.stringify(Object.fromEntries(Object.entries(offerings).map(([y, ids]) => [y, ids.length])), null, 2))
        return
    }
    writeFileSync(PRIOR_OFFERINGS_PATH, `${JSON.stringify(offerings)}\n`)
    console.log(`Wrote ${PRIOR_OFFERINGS_PATH}`)
}

async function fetchSections(subject, code, academicYear) {
    const query = `${subject}${code}`.replace(/\s+/g, '')
    const params = new URLSearchParams({
        q: query,
        view: 'xml-20200810',
        academicYear,
        'filter-coursestatus-Active': 'on',
    })
    const xml = await fetchXml(`${BASE_URL}?${params}`)
    try {
        const parsed = parser.parse(xml)
        // Root tag is <xml>, not <courses>
        const root = parsed?.xml ?? parsed
        const courses = ensureArray(root?.courses?.course)

        if (courses.length === 0) return null

        // Find all exact course matches (sometimes split across multiple course entries)
        const normalizedTarget = `${subject.replace(/\s+/g, '').toUpperCase()}${code.replace(/\s+/g, '').toUpperCase()}`
        const matchedCourses = courses.filter(c => {
            const s = String(c?.subject || '').replace(/\s+/g, '').toUpperCase()
            const cd = String(c?.code || '').replace(/\s+/g, '').toUpperCase()
            return `${s}${cd}` === normalizedTarget
        })

        if (matchedCourses.length === 0) return null

        return matchedCourses
            .map(parseCourseNode)
            .filter(Boolean)
            .reduce(mergeCatalogCourse, null)
    } catch (e) {
        // Corrupt/partial XML is transient — throw so the course is retried next run, not marked done
        throw new Error(`XML parse error for ${subject}${code}: ${e.message}`)
    }
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function isStatementTimeout(err) {
    const code = err?.code ?? err?.details
    const msg = (err?.message || '').toLowerCase()
    const details = String(err?.details || '').toLowerCase()
    return code === '57014' || msg.includes('timeout') || msg.includes('canceling statement')
}

function isTransientDbError(err) {
    if (isStatementTimeout(err)) return true
    const msg = `${err?.message || ''} ${err?.details || ''}`.toLowerCase()
    return (
        msg.includes('fetch failed') ||
        msg.includes('socket') ||
        msg.includes('econnreset') ||
        msg.includes('und_err') ||
        msg.includes('upstream request timeout') ||
        msg.includes('connection')
    )
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}

/** Retry transient DB timeouts / dropped sockets (common on large `courses` writes). */
async function withRetries(fn, { label = 'query', maxAttempts = 6 } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { data, error } = await fn()
        if (!error) return { data, error: null }
        lastErr = error
        if (!isTransientDbError(error) || attempt === maxAttempts) return { data, error }
        const wait = Math.min(8000, 800 * attempt)
        console.warn(`  ⚠ ${label} failed (attempt ${attempt}/${maxAttempts}): ${error.message || error.code}; retrying in ${wait}ms…`)
        await sleep(wait)
    }
    return { data: null, error: lastErr }
}

/**
 * Load all course ids in small pages. Keyset pagination + order avoids heavy OFFSET scans;
 * narrow select keeps payload small under Supabase statement limits.
 */
async function loadCourses(supabase) {
    const rows = []
    const PAGE = 300
    let lastCourseId = null

    while (true) {
        const cursor = lastCourseId
        const { data, error } = await withRetries(() => {
            let q = supabase
                .from('courses')
                .select('course_id, subject, code, terms')
                .order('course_id', { ascending: true })
                .limit(PAGE)
            if (cursor != null) q = q.gt('course_id', cursor)
            return q
        }, { label: 'loadCourses page' })
        if (error) throw error
        if (!data || data.length === 0) break

        rows.push(...data)
        lastCourseId = data[data.length - 1].course_id
        if (data.length < PAGE) break
    }

    return rows
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function upsertCatalog(supabase, rows) {
    const batchSize = 20
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        const { error } = await withRetries(
            () => supabase.from('courses').upsert(batch, { onConflict: 'course_id' }),
            { label: `upsert batch ${Math.floor(i / batchSize) + 1}` }
        )
        if (error) throw error
        process.stdout.write(`\rUpserted ${Math.min(i + batchSize, rows.length)}/${rows.length} courses`)
    }
    process.stdout.write('\n')
}

async function updateCatalog(supabase, rows) {
    const concurrency = 10
    for (let i = 0; i < rows.length; i += concurrency) {
        const batch = rows.slice(i, i + concurrency)
        const results = await Promise.all(batch.map(({ course_id, ...fields }) =>
            withRetries(
                () => supabase.from('courses').update(fields).eq('course_id', course_id),
                { label: `update ${course_id}` }
            )
        ))
        const error = results.find(result => result.error)?.error
        if (error) throw error
        process.stdout.write(`\rUpdated ${Math.min(i + concurrency, rows.length)}/${rows.length} courses`)
    }
    process.stdout.write('\n')
}

async function clearStaleCourses(supabase, courseIds) {
    const batchSize = 200
    for (let i = 0; i < courseIds.length; i += batchSize) {
        const batch = courseIds.slice(i, i + batchSize)
        const { error } = await withRetries(
            () => supabase.from('courses').update({ sections: [], terms: [] }).in('course_id', batch),
            { label: `clear stale batch ${Math.floor(i / batchSize) + 1}` }
        )
        if (error) throw error
    }
}

// ── Navigator catalog (PeopleSoft via Algolia) ──────────────────────────────

/**
 * The whole scheduled catalog for an academic year, straight from Navigator.
 * ~420 Algolia queries plus one detail call per multi-component class, which is
 * where discussions and labs come from — the index itself holds only primary
 * classes.
 */
async function fetchNavigatorCatalog(academicYear) {
    const yearLabel = academicYearLabel(academicYear)
    const terms = termsForAcademicYear(academicYear)
    const client = createNavigatorClient()
    const warn = message => console.warn(`  \u26a0 ${message}`)

    const { classes, expected } = await fetchYearClasses(client, {
        yearLabel,
        terms,
        warn,
        onProgress: ({ term, done, total, collected }) => {
            process.stdout.write(`\rNavigator ${term}: ${done}/${total} depts, ${collected} classes`)
            if (done === total) process.stdout.write('\n')
        },
    })
    console.log(`Navigator: ${classes.length} primary classes (facet count ${expected}), ${client.queryCount} queries`)

    const { relatedByClass, combinedByClass: relatedCombined, targets } = await fetchAllRelatedClasses(classes, {
        warn,
        onProgress: ({ done, total }) => {
            process.stdout.write(`\rNavigator related sections: ${done}/${total} classes`)
            if (done === total) process.stdout.write('\n')
        },
    })
    const relatedCount = [...relatedByClass.values()].reduce((n, list) => n + list.length, 0)
    console.log(`Navigator: ${relatedCount} non-primary sections from ${targets} multi-component classes`)

    const { combinedByClass, requests: combinedRequests } = await fetchCombinedSeats(classes, relatedCombined, {
        warn,
        onProgress: ({ done, total }) => {
            process.stdout.write(`\rNavigator combined seats: ${done}/${total} cross-listed classes`)
            if (done === total) process.stdout.write('\n')
        },
    })
    console.log(`Navigator: shared seats for ${combinedByClass.size} cross-listed classes, ${combinedRequests} extra detail reads`)

    const courses = buildCourses(classes, relatedByClass, {
        instructorOverrides: INSTRUCTOR_OVERRIDES,
        sortTerms,
        combinedByClass,
    })
    const filled = await backfillMissingGrading(courses, classes, { warn })
    if (filled) console.log(`Navigator: filled grading for ${filled} courses from the class detail API`)
    if (courses.length < 5000) {
        throw new Error(`Navigator validation failed: found only ${courses.length} courses; no database writes made`)
    }
    return { courses, classes, crossLists: crossListsByCrseId(classes) }
}

/** One course, straight from Navigator — the --course path. */
async function fetchNavigatorCourse(subject, code, academicYear) {
    const client = createNavigatorClient()
    const yearLabel = academicYearLabel(academicYear)
    const target = `${subject}${code}`.replace(/\s+/g, '').toUpperCase()
    const res = await client.search({
        query: `${subject} ${code}`,
        filters: `acadYearLabel:"${yearLabel}"`,
        restrictSearchableAttributes: ['courseCode'],
        hitsPerPage: 200,
    })
    const hits = (res.hits || []).filter(hit =>
        `${hit.subject}${hit.catalogNbr}`.replace(/\s+/g, '').toUpperCase() === target
    )
    if (!hits.length) return null
    const { relatedByClass, combinedByClass } = await fetchAllRelatedClasses(hits)
    // The search returned only this code's classes, so read each one's record
    // for its shared seats rather than looking for siblings in the hits.
    for (const hit of hits) {
        if (combinedByClass.has(`${hit.strm}|${hit.classNbr}`)) continue
        const detail = await fetchClassDetail(hit.strm, hit.classNbr)
        for (const [key, combined] of combinedSeatsFrom(hit.strm, detail)) combinedByClass.set(key, combined)
    }
    const [course] = buildCourses(hits, relatedByClass, { instructorOverrides: INSTRUCTOR_OVERRIDES, sortTerms, combinedByClass })
    return course || null
}

/**
 * Diff Navigator against ExploreCourses for one year, without writing anything.
 * The point is the two gap lists: EC still publishes a few dozen listings
 * Navigator has no class for, and Navigator schedules courses EC never lists.
 */
async function compareSources(opts) {
    const { courses: navCourses } = await fetchNavigatorCatalog(opts.academicYear)
    const { courses: ecCourses } = await fetchCatalog(opts.academicYear)

    const navById = new Map(navCourses.map(c => [c.course_id, c]))
    const ecById = new Map(ecCourses.map(c => [c.course_id, c]))
    const navOnly = navCourses.filter(c => !ecById.has(c.course_id)).map(c => c.course_id).sort()
    const ecOnly = ecCourses.filter(c => !navById.has(c.course_id)).map(c => c.course_id).sort()

    const sectionDiffs = []
    for (const [id, nav] of navById) {
        const ec = ecById.get(id)
        if (!ec) continue
        const navSections = new Set(nav.sections.map(s => s.classId))
        const ecSections = new Set(ec.sections.map(s => s.classId))
        const missing = [...ecSections].filter(x => !navSections.has(x)).length
        const extra = [...navSections].filter(x => !ecSections.has(x)).length
        if (missing || extra) sectionDiffs.push({ course_id: id, navOnlySections: extra, ecOnlySections: missing })
    }
    sectionDiffs.sort((a, b) => (b.ecOnlySections + b.navOnlySections) - (a.ecOnlySections + a.navOnlySections))

    console.log(JSON.stringify({
        academicYear: opts.academicYear,
        navigatorCourses: navCourses.length,
        exploreCoursesCourses: ecCourses.length,
        navigatorOnly: navOnly.length,
        exploreCoursesOnly: ecOnly.length,
        coursesWithSectionDiffs: sectionDiffs.length,
        navigatorOnlyIds: navOnly,
        exploreCoursesOnlyIds: ecOnly,
        worstSectionDiffs: sectionDiffs.slice(0, 25),
    }, null, 2))
}

/** A meeting the calendar can place: it names at least one weekday. */
function hasPlaceableMeeting(section) {
    return (section.meetings || []).some(meeting => /mon|tue|wed|thu|fri/i.test(meeting.days || ''))
}

/**
 * Merge whatever ExploreCourses has that Navigator does not: whole courses,
 * individual classes, and meeting patterns.
 *
 * PeopleSoft withholds a scattering of classes from Navigator (CS 347's Spring
 * lecture and its nine discussions, for one) and publishes 38 more with no
 * meeting pattern at all even though ExploreCourses prints days and times for
 * them, so course-level merging alone would not close the gap.
 */
function mergeExploreCoursesGaps(navCourses, ecCourses) {
    const merged = new Map(navCourses.map(course => [course.course_id, course]))
    let addedCourses = 0
    let addedSections = 0
    let addedMeetings = 0
    let addedGers = 0
    let addedCrossLists = 0

    for (const ecCourse of ecCourses) {
        const nav = merged.get(ecCourse.course_id)
        if (!nav || (nav.terms || []).length === 0) {
            merged.set(ecCourse.course_id, ecCourse)
            addedCourses++
            continue
        }

        // ExploreCourses names cross-list siblings PeopleSoft does not group.
        // Keeping them matters: isNew is judged across the whole parenthetical.
        const mergedTitle = mergeCrossListTitle(nav.title, ecCourse.title)
        if (mergedTitle !== nav.title) {
            nav.title = mergedTitle
            addedCrossLists++
        }

        const byClassId = new Map(nav.sections.map(section => [section.classId, section]))
        const extra = []
        for (const ecSection of ecCourse.sections) {
            if (!ecSection.classId) continue
            const navSection = byClassId.get(ecSection.classId)
            if (!navSection) {
                extra.push(ecSection)
                continue
            }
            // Navigator wins on everything it knows; it only borrows what it
            // has none of. Meeting patterns are missing on 38 courses, and the
            // "Language" requirement on 67 language courses — PeopleSoft simply
            // does not carry that attribute, where ExploreCourses does.
            if (!hasPlaceableMeeting(navSection) && hasPlaceableMeeting(ecSection)) {
                navSection.meetings = ecSection.meetings
                addedMeetings++
            }
            if (!(navSection.gers || []).length && (ecSection.gers || []).length) {
                navSection.gers = ecSection.gers
                addedGers++
            }
        }
        if (!extra.length) continue

        const sections = [...nav.sections, ...extra]
        merged.set(ecCourse.course_id, {
            ...nav,
            sections,
            terms: sortTerms(Array.from(new Set(sections.map(section => section.term).filter(Boolean)))),
            instructors: Array.from(new Set([
                ...nav.instructors,
                ...extra.flatMap(section => section.meetings.flatMap(meeting => meeting.instructors)),
            ])),
        })
        addedSections += extra.length
    }

    return { courses: [...merged.values()], addedCourses, addedSections, addedMeetings, addedGers, addedCrossLists }
}

async function loadCourseTermsMap(supabase) {
    const rows = await loadCourses(supabase)
    return new Map(rows.map(row => [row.course_id, row]))
}

async function listBrowseSubjects(academicYear) {
    const browseUrl = `${BROWSE_URL}?view=xml-20200810&academicYear=${academicYear}`
    const browse = parser.parse(await fetchXml(browseUrl))
    const schools = ensureArray(browse?.schools?.school)
    const departments = Array.from(new Set(
        schools.flatMap(school => ensureArray(school?.department))
            .map(department => textVal(department?._name || department?.name))
            .filter(Boolean)
    ))
    return Array.from(new Set([...departments, ...ORPHAN_SUBJECTS])).sort()
}

async function main() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Missing env vars. Run with: node --env-file=.env.local scripts/scrape-sections.mjs')
        process.exit(1)
    }

    // Check fast-xml-parser is available
    try { await import('fast-xml-parser') } catch {
        console.error('Missing dependency: run  npm install fast-xml-parser  then retry.')
        process.exit(1)
    }

    const opts = parseArgs()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

    if (opts.course) {
        const normalized = opts.course.replace(/\s+/g, '')
        const subject = normalized.match(/^[A-Z&]+/)?.[0] || ''
        const code = normalized.slice(subject.length)
        const course = opts.withExploreCourses
            ? await fetchSections(subject, code, opts.academicYear)
            : await fetchNavigatorCourse(subject, code, opts.academicYear)
        if (!course) throw new Error(`Course ${opts.course} not found for ${opts.academicYear}`)
        console.log(JSON.stringify(course, null, opts.dryRun ? 2 : 0))
        if (!opts.dryRun) {
            await upsertCatalog(supabase, [course])
        }
        return
    }

    if (opts.priorYears) {
        await recordPriorOfferings(opts)
        return
    }

    if (opts.compareSources) {
        await compareSources(opts)
        return
    }

    console.log(`Fetching Stanford catalog for ${opts.academicYear} from Navigator...`)
    const { courses: navCourses } = await fetchNavigatorCatalog(opts.academicYear)
    let courses = navCourses
    let departmentCount = null

    if (opts.withExploreCourses) {
        console.log('Filling Navigator holes from ExploreCourses...')
        try {
            const { departments, courses: ecCourses } = await fetchCatalog(opts.academicYear)
            departmentCount = departments.length
            const gaps = mergeExploreCoursesGaps(navCourses, ecCourses)
            courses = gaps.courses
            console.log(`Merged ${gaps.addedCourses} ExploreCourses-only courses, ${gaps.addedSections} sections, ${gaps.addedMeetings} meeting patterns, ${gaps.addedGers} GER sets and ${gaps.addedCrossLists} cross-list titles`)
        } catch (err) {
            console.warn(`  ⚠ ExploreCourses gap-fill skipped: ${err.message}`)
        }
    }

    if (opts.out) {
        writeFileSync(opts.out, JSON.stringify(courses))
        console.log(`Wrote ${courses.length} courses to ${opts.out}; no database writes made.`)
        return
    }

    console.log('Loading current Supabase course IDs...')
    const existingRows = await loadCourses(supabase)
    const existingById = new Map(existingRows.map(row => [row.course_id, row]))
    const existingIds = new Set(existingById.keys())
    const incomingIds = new Set(courses.map(course => course.course_id))
    const newCourses = courses.filter(course => !existingIds.has(course.course_id))
    const staleIds = existingRows.filter(row => !incomingIds.has(row.course_id)).map(row => row.course_id)
    const scheduled = courses.filter(course => course.sections.length > 0).length
    const terms = sortTerms(Array.from(new Set(courses.flatMap(course => course.terms))))

    console.log(JSON.stringify({
        academicYear: opts.academicYear,
        source: opts.withExploreCourses ? 'navigator+explorecourses' : 'navigator',
        departments: departmentCount,
        courses: courses.length,
        scheduled,
        newCourses: newCourses.length,
        staleCourses: staleIds.length,
        terms,
        sampleNewCourseIds: newCourses.slice(0, 20).map(course => course.course_id),
        dryRun: opts.dryRun,
    }, null, 2))

    if (opts.dryRun) return

    const rowsToUpsert = opts.resume
        ? courses.filter(course => JSON.stringify(course.terms) !== JSON.stringify(existingById.get(course.course_id)?.terms || []))
        : courses
    if (opts.resume) console.log(`Resume mode: ${rowsToUpsert.length}/${courses.length} course rows still need the new year.`)
    if (opts.resume) await updateCatalog(supabase, rowsToUpsert)
    else await upsertCatalog(supabase, rowsToUpsert)
    await clearStaleCourses(supabase, staleIds)
    console.log(`Done. Refreshed ${courses.length} courses; cleared ${staleIds.length} stale schedules.`)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
