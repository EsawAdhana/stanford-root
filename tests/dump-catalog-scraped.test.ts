import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalogDump, jsonbKeyOrder } from '../scripts/dump-catalog.mjs'

/**
 * The nightly dump builds the scraped columns from the rows the scrape just
 * wrote (--scraped) and reads only ratings, titles and cross-listings from the
 * table. These tests hold it to the dump it replaced: the same bytes, from the
 * same inputs, with far less read.
 */
type Row = Record<string, any>
const fixture = (name: string): Row[] =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures/catalog-rows', name), 'utf8'))

/** Read-only supabase-js stand-in over in-memory tables that logs every select. */
function mockClient(tables: Record<string, Row[]>) {
    const reads: { table: string; columns: string[]; rows: number }[] = []
    const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0)
    const from = (table: string) => {
        const q: any = { columns: [] as string[], orders: [] as string[], filters: [] as ((r: Row) => boolean)[], lim: null, rng: null }
        const api: any = {
            select(cols: string) { q.columns = cols.split(',').map(c => c.trim()); return api },
            order(col: string) { q.orders.push(col); return api },
            limit(n: number) { q.lim = n; return api },
            gt(col: string, v: any) { q.filters.push((r: Row) => r[col] > v); return api },
            range(a: number, b: number) { q.rng = [a, b]; return api },
            upsert() { throw new Error('read-only') },
            update() { throw new Error('read-only') },
            then(resolve: (v: any) => void) {
                let rows = (tables[table] || []).filter(r => q.filters.every((f: any) => f(r)))
                rows = [...rows].sort((a, b) => q.orders.reduce((c: number, o: string) => c || cmp(a[o], b[o]), 0))
                if (q.rng) rows = rows.slice(q.rng[0], q.rng[1] + 1)
                if (q.lim != null) rows = rows.slice(0, q.lim)
                const data = rows.map(r => Object.fromEntries(q.columns.map((c: string) => [c, r[c] ?? null])))
                reads.push({ table, columns: q.columns, rows: data.length })
                resolve({ data: structuredClone(data), error: null })
            },
        }
        return api
    }
    return { client: { from }, reads }
}

/** The courses table as Postgres holds it: jsonb keys reordered, plus rows the scrape has dropped. */
function table() {
    const live: Row[] = fixture('previous-dump.json').map(({ isNew, ...row }) => ({ ...row, sections: jsonbKeyOrder(row.sections) }))
    // Abbreviated in the table and the scrape alike; the dump expands it from the overrides.
    live[1].instructors = ['Heller, H']
    live[1].sections[0].meetings[0].instructors = ['Heller, H']
    live[0].quality = 0
    const stale = [
        { course_id: 'AAA1', title: 'Retired (MATH 51)', grading: 'Letter', instructors: [], terms: [], sections: [], cross_list_with: [] },
        { course_id: 'ZZZ9', title: 'Retired', grading: 'TBD', instructors: [], terms: [], sections: [], cross_list_with: ['CS106B'] },
    ]
    return [...live, ...stale]
}

/** The scrape's own rows: the scraped columns only, keys in build order, rows in another order. */
function scrapeOf(rows: Row[]) {
    const fields = ['terms', 'sections', 'instructors', 'grading', 'units', 'description', 'title', 'code', 'subject', 'course_id']
    const reverseKeys = (v: any): any => Array.isArray(v) ? v.map(reverseKeys)
        : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverseKeys(v[k])])) : v
    return rows.filter(r => r.sections.length).reverse()
        .map(r => Object.fromEntries(fields.map(f => [f, f === 'sections' ? reverseKeys(r[f]) : structuredClone(r[f])])))
}

const evaluations = [
    { id: 7, course_id: 'MATH51', instructor: 'Vakil, Ravi', term: 'Autumn 2024', comments: ['never read'] },
    { id: 2, course_id: 'CS106B', instructor: 'Bailey, Cynthia', term: 'Winter 2025', comments: ['never read'] },
    { id: 9, course_id: 'CS106B', instructor: 'Szumlanski, Sean', term: 'Spring 2019', comments: ['never read'] },
    { id: 4, course_id: null, instructor: 'Nobody, N', term: 'Autumn 2025' },
    { id: 1, course_id: 'GONE1', instructor: null, term: 'Autumn 2025' },
]

describe('dump built from the scrape rows', () => {
    it('is byte for byte the dump built from the table', async () => {
        const fromTable = mockClient({ courses: table(), evaluations })
        const fromScrape = mockClient({ courses: table(), evaluations })
        const old = await buildCatalogDump(fromTable.client)
        const scraped = await buildCatalogDump(fromScrape.client, { scraped: scrapeOf(table()) })
        expect(scraped.fullJson).toBe(old.fullJson)
        expect(scraped.lightJson).toBe(old.lightJson)
        expect(scraped.instructorsJson).toBe(old.instructorsJson)
        // And the dump really did its work: ratings kept, the zero rating cleared, the name expanded.
        const math = JSON.parse(scraped.fullJson).find((r: Row) => r.course_id === 'MATH51')
        expect(math.quality).toBe(4)
        expect(math.instructors).toEqual(['Heller, H. Craig'])
        expect(math.sections[0].meetings[0].instructors).toEqual(['Heller, H. Craig'])
        expect(JSON.parse(scraped.fullJson).find((r: Row) => r.course_id === 'CS106B').quality).toBeNull()
        expect(JSON.parse(scraped.fullJson).map((r: Row) => r.course_id)).toEqual(['AMSTUD167A', 'CS106B', 'HIST1', 'MATH51'])
    })

    it('never reads sections from the table, and reads no evaluation comments either way', async () => {
        const { client, reads } = mockClient({ courses: table(), evaluations })
        await buildCatalogDump(client, { scraped: scrapeOf(table()) })
        const columns = reads.flatMap(r => r.columns)
        expect(columns).not.toContain('sections')
        expect(columns).not.toContain('description')
        expect(columns).not.toContain('comments')
        expect(reads.filter(r => r.table === 'evaluations')).toHaveLength(1)
    })

    it('reads each evaluation once, paging on id, however many pages there are', async () => {
        const many = Array.from({ length: 2500 }, (_, i) => ({ id: 2500 - i, course_id: `C${i % 40}`, instructor: `Person, P${i % 7}`, term: 'Autumn 2025' }))
        const { client, reads } = mockClient({ courses: table(), evaluations: many })
        await buildCatalogDump(client, { scraped: scrapeOf(table()) })
        const pages = reads.filter(r => r.table === 'evaluations')
        expect(pages.map(p => p.rows)).toEqual([1000, 1000, 500])
    })

    it('refuses a scrape row the table does not have instead of dumping something the table lacks', async () => {
        const { client } = mockClient({ courses: table(), evaluations })
        const extra = [...scrapeOf(table()), { ...scrapeOf(table())[0], course_id: 'NEW1' }]
        await expect(buildCatalogDump(client, { scraped: extra })).rejects.toThrow(/NEW1/)
    })

    it('shows the scrape, not the table, when the two differ', async () => {
        const { client } = mockClient({ courses: table(), evaluations })
        const scrape = scrapeOf(table())
        const math = scrape.find(r => r.course_id === 'MATH51')!
        math.sections[0].enrolled = 199
        const dump = await buildCatalogDump(client, { scraped: scrape })
        expect(JSON.parse(dump.fullJson).find((r: Row) => r.course_id === 'MATH51').sections[0].enrolled).toBe(199)
    })
})

describe('jsonb key order', () => {
    it('puts shorter keys first, then bytewise, at every depth', () => {
        const ordered = jsonbKeyOrder({ waitlist: 1, term: 'x', units: '', meetings: [{ location: 'a', days: 'b', time: 'c' }], gers: [], b: undefined })
        expect(JSON.stringify(ordered)).toBe('{"gers":[],"term":"x","units":"","meetings":[{"days":"b","time":"c","location":"a"}],"waitlist":1}')
    })
})
