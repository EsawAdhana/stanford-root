import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { CATALOG_SHARD_COUNT, shardRange } from '@/lib/catalog-shards'

// 8671 is the live course count and 8671 % 8 === 7, so the last shard is short and
// every boundary lands off a round number. A fixture that divided evenly would let
// an off-by-one through.
//
// The order is deliberately scrambled, not ascending. With an already-sorted
// fixture the reassembly test below passes even if getShards() sorts the rows,
// which is the one thing it exists to catch -- verified by injecting a sort and
// watching it stay green. 7919 is coprime with 8671 (13*23*29), so i*7919 mod 8671
// is a bijection: every row appears once, in an order nothing would produce by
// accident.
const ROWS = Array.from({ length: 8671 }, (_, i) => {
  const n = (i * 7919) % 8671
  return {
    course_id: `C${String(n).padStart(5, '0')}`,
    subject: 'CS',
    description: 'x'.repeat(40),
    sections: [{ class_nbr: n }],
  }
})

vi.mock('fs/promises', () => ({
  readFile: (p: string) =>
    Promise.resolve(JSON.stringify(String(p).includes('full.json') ? ROWS : ROWS.map(r => ({ course_id: r.course_id })))),
}))
vi.mock('@/lib/supabase-admin', () => ({
  getPublicClient: () => { throw new Error('route fell through to Supabase') },
  mergeCourseRows: (r: unknown[]) => r,
  FULL_COURSE_COLUMNS: '',
  LIGHT_COURSE_COLUMNS: '',
}))

const { GET } = await import('@/app/api/courses/route')
const get = (qs: string) => GET(new Request(`http://localhost/api/courses${qs}`))
const shard = async (i: number) => JSON.parse(await (await get(`?full=1&shard=${i}`)).text())

describe('catalog shards reassemble losslessly', () => {
  it('concatenating every shard equals the unsharded dump, in the same order', async () => {
    const whole = JSON.parse(await (await get('?full=1')).text())
    const rebuilt = (await Promise.all(
      Array.from({ length: CATALOG_SHARD_COUNT }, (_, i) => shard(i))
    )).flat()
    // Order matters: store.ts feeds this straight into the browse list, so a sort
    // or a reversed slice here would visibly reorder courses for every student.
    expect(rebuilt).toEqual(whole)
    // And prove the fixture can actually detect a sort, so this test cannot quietly
    // rot back into passing on pre-sorted input.
    const ids = rebuilt.map((r: any) => r.course_id)
    expect(ids).not.toEqual([...ids].sort())
  })

  it('covers all 8671 rows exactly once, with nothing dropped or duplicated', async () => {
    const seen: string[] = []
    for (let i = 0; i < CATALOG_SHARD_COUNT; i++) seen.push(...(await shard(i)).map((r: any) => r.course_id))
    expect(seen).toHaveLength(ROWS.length)
    expect(new Set(seen).size).toBe(ROWS.length)
  })

  it('leaves no shard empty even though the count does not divide evenly', async () => {
    const sizes: number[] = []
    for (let i = 0; i < CATALOG_SHARD_COUNT; i++) sizes.push((await shard(i)).length)
    expect(Math.min(...sizes)).toBeGreaterThan(0)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(ROWS.length)
    // 8671/8 rounds up to 1084, so seven shards of 1084 and a remainder of 1083.
    expect(sizes.slice(0, -1).every(n => n === 1084)).toBe(true)
    expect(sizes.at(-1)).toBe(1083)
  })

  it('serves every shard with the shared-cache header', async () => {
    for (let i = 0; i < CATALOG_SHARD_COUNT; i++) {
      const cc = (await get(`?full=1&shard=${i}`)).headers.get('cache-control') ?? ''
      expect(cc).not.toMatch(/no-store/)
      expect(cc).toMatch(/s-maxage=\d+/)
    }
  })

  // '' , '0x5', '1e0', ' 3' and '+3' are the ones that bit: Number() coerces every
  // one of them to a valid index, so the route answered a malformed request and
  // would have split shard 0's CDN entry across five URLs.
  it.each(['-1', '8', '99', '1.5', 'abc', '', 'NaN', '0x5', '1e0', ' 3', '+3', '00', 'Infinity'])(
    'rejects shard=%s instead of serving something wrong', async bad => {
    const res = await get(`?full=1&shard=${bad}`)
    expect(res.status).toBe(400)
  })

  it('rejects a shard request that forgot full=1 rather than silently sharding the light dump', async () => {
    expect((await get('?shard=0')).status).toBe(400)
  })

  it('still answers the unsharded ?full=1 that local tooling uses', async () => {
    const rows = JSON.parse(await (await get('?full=1')).text())
    expect(rows).toHaveLength(ROWS.length)
  })
})

describe('shard sizing against the real dump', () => {
  // The guard that matters as the catalog grows. 0.65MB gzipped is the light dump,
  // measured in production returning x-vercel-cache: HIT on this project, so it is
  // a size we know the edge cache accepts rather than a guess at the ceiling.
  const KNOWN_CACHEABLE_BYTES = 0.65 * 1024 * 1024

  it('keeps every shard of the real catalog under a size the edge cache is known to hold', () => {
    const rows = JSON.parse(readFileSync('data/catalog/full.json', 'utf8')) as unknown[]
    const sizes = Array.from({ length: CATALOG_SHARD_COUNT }, (_, i) => {
      const [from, to] = shardRange(i, rows.length)
      return gzipSync(Buffer.from(JSON.stringify(rows.slice(from, to))), { level: 6 }).length
    })
    const worst = Math.max(...sizes)
    expect(
      worst,
      `largest shard is ${(worst / 1048576).toFixed(2)}MB gzipped. Raise CATALOG_SHARD_COUNT.`
    ).toBeLessThan(KNOWN_CACHEABLE_BYTES)
  })

  it('is not sharding so finely that the requests stop being worth it', () => {
    // The other direction: 8 requests per session is fine against a 10M/mo included
    // edge-request allowance, 80 would not be.
    expect(CATALOG_SHARD_COUNT).toBeLessThanOrEqual(16)
  })
})
