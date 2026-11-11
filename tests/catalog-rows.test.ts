import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalizeCourse, rowsToWrite, staleIdsToClear } from '../scripts/catalog-rows.mjs'
import { termSortKey } from '../scripts/scrape-sections.mjs'

/**
 * The nightly refresh writes only rows that differ from the last dump. The
 * fixtures are one night's dump (keys in the order Postgres jsonb returns them,
 * plus the ratings and isNew the dump adds) and the next night's scrape (keys
 * in the order the scraper builds them, sections and instructors shuffled).
 */
type Row = { course_id: string; sections: any[]; instructors: string[]; terms: string[]; [k: string]: any }
const fixture = (name: string): Row[] =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures/catalog-rows', name), 'utf8'))
const canon = (rows: Row[]) => rows.map(row => canonicalizeCourse(structuredClone(row), { termKey: termSortKey }))
const ids = (rows: Row[]) => rows.map(row => row.course_id)

describe('which scraped rows the refresh writes', () => {
    it('writes the changed seat count and the new course, and nothing that only came back in another order', () => {
        const written = rowsToWrite(canon(fixture('scraped.json')), fixture('previous-dump.json'))
        // CS106B: same content, sections, instructors and object keys all in a different order.
        // MATH51: one more student enrolled. AMSTUD167A: identical. PHYS41: not in the last dump.
        expect(ids(written)).toEqual(['MATH51', 'PHYS41'])
    })

    it('writes nothing when the scrape returns exactly what the dump holds', () => {
        const dump = fixture('previous-dump.json')
        expect(rowsToWrite(canon(dump), dump)).toEqual([])
    })

    it('writes a row whose only change is a section added, removed, or a field cleared', () => {
        const previous = canon(fixture('previous-dump.json'))
        const added = canon(fixture('previous-dump.json'))
        added[1].sections.push({ ...added[1].sections[0], classId: 2002, sectionNumber: '2' })
        const removed = canon(fixture('previous-dump.json'))
        removed[0].sections.pop()
        const cleared = canon(fixture('previous-dump.json'))
        cleared[2].description = null
        const nested = canon(fixture('previous-dump.json'))
        nested[0].sections[0].meetings[0].location = 'Gates B01'
        expect(ids(rowsToWrite(added, previous))).toEqual(['MATH51'])
        expect(ids(rowsToWrite(removed, previous))).toEqual(['CS106B'])
        // An empty description is not the same as none at all.
        cleared[2].description = ''
        expect(rowsToWrite(cleared, previous)).toEqual([])
        cleared[2].description = null
        expect(ids(rowsToWrite(cleared, previous))).toEqual(['AMSTUD167A'])
        expect(ids(rowsToWrite(nested, previous))).toEqual(['CS106B'])
    })

    it('ignores the columns other scripts own (ratings, isNew)', () => {
        const dump = fixture('previous-dump.json')
        const scraped = canon(dump).map(({ quality, hours, isNew, rating_breakdown, ...row }) => row)
        expect(rowsToWrite(scraped as Row[], dump)).toEqual([])
    })

    it('writes everything when there is no previous dump to compare with', () => {
        const scraped = canon(fixture('scraped.json'))
        expect(rowsToWrite(scraped, [])).toHaveLength(scraped.length)
    })

    it('rewrites a row whose order differed in a dump written before the order was fixed, once', () => {
        const oldOrder = fixture('previous-dump.json')
        oldOrder[0].sections.reverse()
        const scraped = canon(fixture('scraped.json'))
        expect(ids(rowsToWrite(scraped, oldOrder))).toEqual(['CS106B', 'MATH51', 'PHYS41'])
        expect(ids(rowsToWrite(canon(fixture('scraped.json')), scraped))).toEqual([])
    })
})

describe('a fixed order for sections and instructors', () => {
    it('orders sections by term, then section number, component and class number', () => {
        const [cs] = canon(fixture('scraped.json'))
        expect(cs.sections.map(s => `${s.term} ${s.component} ${s.sectionNumber}`)).toEqual([
            'Autumn 2026 LEC 1', 'Autumn 2026 DIS 2', 'Winter 2027 LEC 1',
        ])
        expect(cs.instructors).toEqual(['Bailey, Cynthia', 'Szumlanski, Sean'])
    })

    it('gives the same order whatever order the reads finished in', () => {
        const scraped = fixture('scraped.json')
        const reversed = scraped.map(row => ({ ...structuredClone(row), sections: [...row.sections].reverse(), instructors: [...row.instructors].reverse() }))
        expect(JSON.stringify(canon(reversed))).toBe(JSON.stringify(canon(scraped)))
    })

    it('sorts section 10 after section 2, Winter before Spring, and keeps sections that tie on every key', () => {
        const course = {
            course_id: 'X1', instructors: [], terms: [],
            sections: [
                { term: 'Spring 2027', sectionNumber: '1', component: 'LEC', classId: 9 },
                { term: 'Winter 2027', sectionNumber: '10', component: 'DIS', classId: 3 },
                { term: 'Winter 2027', sectionNumber: '2', component: 'DIS', classId: 4 },
                { term: 'Winter 2027', sectionNumber: '2', component: 'DIS', classId: 4, meetings: [{ days: 'Monday' }] },
                { term: 'Winter 2027', sectionNumber: undefined, component: 'INS' },
            ],
        }
        const sorted = canonicalizeCourse(structuredClone(course), { termKey: termSortKey }).sections
        expect(sorted.map((s: any) => `${s.term}|${s.sectionNumber}|${s.classId}`)).toEqual([
            'Winter 2027|undefined|undefined', 'Winter 2027|2|4', 'Winter 2027|2|4', 'Winter 2027|10|3', 'Spring 2027|1|9',
        ])
        expect(sorted).toHaveLength(5)
        const again = canonicalizeCourse({ ...structuredClone(course), sections: [...course.sections].reverse() }, { termKey: termSortKey }).sections
        expect(JSON.stringify(again)).toBe(JSON.stringify(sorted))
    })

    it('keeps exactly the instructors the row had, including ones no meeting names and none it lacked', () => {
        const course = {
            course_id: 'X2', terms: [],
            instructors: ['Zed, Z', 'Staff, A', 'Bee, B'],
            sections: [
                { term: 'Winter 2027', sectionNumber: '1', meetings: [{ instructors: ['Bee, B', 'Unlisted, U'] }] },
            ],
        }
        // AMSTUD 167A in the real dump: meetings name an instructor the row's list does not.
        expect(canonicalizeCourse(course, { termKey: termSortKey }).instructors).toEqual(['Bee, B', 'Staff, A', 'Zed, Z'])
    })
})

describe('which stale rows the refresh clears', () => {
    const existing = [
        { course_id: 'CS106B', terms: ['Autumn 2026'] },
        { course_id: 'HIST1', terms: ['Spring 2027'] }, // dropped from the scrape today
        { course_id: 'OLD1', terms: [] }, // cleared on an earlier night
        { course_id: 'ODD1', terms: [] }, // empty terms but still in the dump, so it has sections
        { course_id: 'NULLTERMS', terms: null },
    ]
    const incoming = new Set(['CS106B', 'MATH51'])

    it('clears only rows that still hold a schedule', () => {
        const dump = [...fixture('previous-dump.json'), { course_id: 'ODD1', sections: [{}] }]
        expect(staleIdsToClear(existing, incoming, dump)).toEqual(['HIST1', 'ODD1'])
    })

    it('never clears a row the scrape returned', () => {
        expect(staleIdsToClear(existing, new Set(['HIST1', 'ODD1', 'OLD1', 'NULLTERMS', 'CS106B']), fixture('previous-dump.json'))).toEqual([])
    })
})
