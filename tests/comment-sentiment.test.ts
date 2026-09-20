import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { bucketOf, hashComment } from '@/lib/comment-sentiment'

const scores = (ip: number, ib: number, cp: number, cb: number) => ({
  comment_hash: 'x',
  instructor_praise: ip,
  instructor_blame: ib,
  course_praise: cp,
  course_blame: cb,
})

describe('bucketOf', () => {
  it('reads praise with no blame as positive', () => {
    expect(bucketOf(scores(0.98, 0.02, 0.74, 0.04))).toBe('positive')
  })

  it('reads blame with no praise as negative', () => {
    expect(bucketOf(scores(0.02, 0.97, 0.04, 0.9))).toBe('negative')
  })

  it('reads high on both as mixed, not as an average', () => {
    // "Good class - difficult to figure out what to study for": both are real.
    expect(bucketOf(scores(0.92, 0.88, 0.77, 0.91))).toBe('mixed')
  })

  it('reads low on both as advice, not as neutral-positive', () => {
    // "Start every single PSET early" -- no verdict in either direction.
    expect(bucketOf(scores(0.07, 0.08, 0.06, 0.05))).toBe('advice')
  })

  it('takes the stronger of instructor and course on each side', () => {
    // Silent on the instructor, warm about the course, and vice versa.
    expect(bucketOf(scores(0.03, 0.02, 0.95, 0.06))).toBe('positive')
    expect(bucketOf(scores(0.99, 0.01, 0.08, 0.03))).toBe('positive')
    // Praise for the teacher, criticism of the course, is mixed either way round.
    expect(bucketOf(scores(0.96, 0.03, 0.12, 0.93))).toBe('mixed')
  })

  it('treats the cutoff as inclusive and holds the boundary', () => {
    expect(bucketOf(scores(0.6, 0, 0, 0))).toBe('positive')
    expect(bucketOf(scores(0.59, 0, 0, 0))).toBe('advice')
    expect(bucketOf(scores(0, 0.6, 0, 0))).toBe('negative')
    expect(bucketOf(scores(0, 0.59, 0, 0))).toBe('advice')
    expect(bucketOf(scores(0.6, 0.6, 0, 0))).toBe('mixed')
  })

  it('covers all four buckets and returns nothing else', () => {
    // praise and blame have to move independently, or the sweep only ever
    // reaches the two buckets where they are equal.
    const seen = new Set<string>()
    for (let praise = 0; praise <= 1.0001; praise += 0.1) {
      for (let blame = 0; blame <= 1.0001; blame += 0.1) {
        seen.add(bucketOf(scores(praise, blame, 0, 0)))
      }
    }
    expect([...seen].sort()).toEqual(['advice', 'mixed', 'negative', 'positive'])
  })
})

describe('hashComment', () => {
  /**
   * This is a contract with scripts/label-comment-sentiment.mjs, which writes
   * the table. If the two ever hash differently, nothing errors -- every lookup
   * just misses and the UI silently shows no sentiment at all, which is how the
   * first broken version of this got all the way to a browser.
   */
  const asTheScriptDoes = (text: string) =>
    createHash('sha256').update(text.trim()).digest('hex')

  it('matches the backfill script byte for byte', () => {
    for (const text of ['Take it!', '  padded  ', 'Ünïcödé — em dash', '"quoted" & <escaped>']) {
      expect(hashComment(text)).toBe(asTheScriptDoes(text))
    }
  })

  it('trims, so the same comment stored with stray whitespace still matches', () => {
    expect(hashComment('  Take it!  ')).toBe(hashComment('Take it!'))
  })

  it('does not decode HTML entities, because the stored text is not decoded', () => {
    expect(hashComment('a &amp; b')).not.toBe(hashComment('a & b'))
  })
})
