/**
 * How many pieces the full catalog dump is served in.
 *
 * Vercel's edge cache will not store a response past a size ceiling, and the
 * whole dump is over it: measured in production, `/api/courses?full=1` is 4.15MB
 * gzipped and returned `x-vercel-cache: MISS` on every request, while the 0.65MB
 * light dump on the same deployment returned HIT. A miss means the bytes come out
 * of the function every time, which is what made Fast Origin Transfer the largest
 * line on the bill (281.7GB, $16.90, in the Aug 17 - Sep 16 cycle).
 *
 * 8 puts the largest shard at 0.56MB gzipped, under the light dump we know caches,
 * rather than just under the ceiling itself. tests/courses-route-cache.test.ts
 * fails if a shard grows past that as the catalog does.
 *
 * This file imports nothing so both the route and the browser store can use it.
 */
export const CATALOG_SHARD_COUNT = 8

/** The half-open row range shard `i` covers, for a dump of `total` rows. */
export function shardRange (i: number, total: number): [number, number] {
  const per = Math.ceil(total / CATALOG_SHARD_COUNT)
  return [i * per, Math.min((i + 1) * per, total)]
}

export function isValidShard (value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < CATALOG_SHARD_COUNT
}
