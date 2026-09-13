import { describe, it, expect, beforeEach } from 'vitest'
import {
  CACHE_MAX_COURSES,
  CACHE_TTL_MS,
  clearEvaluationCache,
  evaluationCacheSize,
  readCachedEvaluations,
  writeCachedEvaluations,
} from '@/lib/evaluation-cache'
import type { CourseEvaluation } from '@/types/course'

const evaluation = (term: string): CourseEvaluation =>
  ({ term, instructor: 'Bailey, Cynthia', courseCode: 'CS 106B', respondents: '140', questions: [], comments: [] }) as CourseEvaluation

beforeEach(() => clearEvaluationCache())

describe('evaluation cache', () => {
  it('returns null for a course it has never seen', () => {
    expect(readCachedEvaluations('CS106B')).toBeNull()
  })

  it('serves back what was written', () => {
    writeCachedEvaluations('CS106B', [evaluation('Autumn 2025')])
    expect(readCachedEvaluations('CS106B')?.map(e => e.term)).toEqual(['Autumn 2025'])
  })

  it('remembers that a course has NO evaluations', () => {
    // Most of the catalog is unrated. If an empty result is not cached, every
    // view of an unrated course re-reads Postgres to learn nothing.
    writeCachedEvaluations('AA100X', [])
    expect(readCachedEvaluations('AA100X')).toEqual([])
    expect(readCachedEvaluations('AA100X')).not.toBeNull()
  })

  it('expires exactly AT the TTL, not one tick after', () => {
    const t0 = 1_000_000
    writeCachedEvaluations('CS106B', [evaluation('Autumn 2025')], t0)
    expect(readCachedEvaluations('CS106B', t0 + CACHE_TTL_MS - 1)).not.toBeNull()
    expect(readCachedEvaluations('CS106B', t0 + CACHE_TTL_MS)).toBeNull()
  })

  it('drops the expired entry rather than leaking it', () => {
    const t0 = 1_000_000
    writeCachedEvaluations('CS106B', [evaluation('Autumn 2025')], t0)
    readCachedEvaluations('CS106B', t0 + CACHE_TTL_MS)
    expect(evaluationCacheSize()).toBe(0)
  })

  it('never holds more than CACHE_MAX_COURSES', () => {
    for (let i = 0; i < CACHE_MAX_COURSES + 25; i++) {
      writeCachedEvaluations(`C${i}`, [evaluation('Autumn 2025')])
    }
    expect(evaluationCacheSize()).toBe(CACHE_MAX_COURSES)
  })

  it('evicts the oldest, keeping the newest', () => {
    for (let i = 0; i < CACHE_MAX_COURSES + 1; i++) {
      writeCachedEvaluations(`C${i}`, [evaluation('Autumn 2025')])
    }
    expect(readCachedEvaluations('C0')).toBeNull()
    expect(readCachedEvaluations(`C${CACHE_MAX_COURSES}`)).not.toBeNull()
  })

  it('a READ protects a hot course from eviction', () => {
    // This is the case a plain insertion-order cache gets wrong. CS106B is the
    // most-viewed course in the catalog, so it is written once and then only
    // read. Without the LRU touch on read it ages out while nothing else does,
    // and the single most expensive course re-reads 556KB every time.
    writeCachedEvaluations('CS106B', [evaluation('Autumn 2025')])
    for (let i = 0; i < CACHE_MAX_COURSES - 1; i++) {
      writeCachedEvaluations(`C${i}`, [evaluation('Autumn 2025')])
    }
    expect(readCachedEvaluations('CS106B')).not.toBeNull() // touch it

    // Now push in enough to evict everything that has not been touched since.
    for (let i = 0; i < CACHE_MAX_COURSES - 1; i++) {
      writeCachedEvaluations(`D${i}`, [evaluation('Autumn 2025')])
    }
    expect(readCachedEvaluations('CS106B')).not.toBeNull()
    expect(readCachedEvaluations('C0')).toBeNull()
  })

  it('a rewrite refreshes the timestamp, so a refetched course is not instantly stale', () => {
    const t0 = 1_000_000
    writeCachedEvaluations('CS106B', [evaluation('Autumn 2025')], t0)
    writeCachedEvaluations('CS106B', [evaluation('Winter 2026')], t0 + CACHE_TTL_MS)
    expect(readCachedEvaluations('CS106B', t0 + CACHE_TTL_MS + 1)?.map(e => e.term)).toEqual(['Winter 2026'])
  })

  it('keeps courses separate', () => {
    writeCachedEvaluations('CS106B', [evaluation('Autumn 2025')])
    writeCachedEvaluations('CS229', [evaluation('Winter 2026')])
    expect(readCachedEvaluations('CS106B')?.map(e => e.term)).toEqual(['Autumn 2025'])
    expect(readCachedEvaluations('CS229')?.map(e => e.term)).toEqual(['Winter 2026'])
  })
})
