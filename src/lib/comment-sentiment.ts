import { createHash } from 'node:crypto'
import { getPublicClient } from '@/lib/supabase-admin'
import type { CommentSentiment, CourseEvaluation } from '@/types/course'

/**
 * Reads the sentiment scores that `scripts/label-comment-sentiment.mjs` writes.
 *
 * The table is keyed by a hash of the comment text, not by (course, term, index),
 * because half the corpus is repeated strings -- 289,766 appearances across only
 * 145,500 distinct comments. Hash the same way the script does: sha256 of the
 * trimmed raw text, before any HTML-entity decoding.
 */

type ScoreRow = {
  comment_hash: string
  instructor_praise: number
  instructor_blame: number
  course_praise: number
  course_blame: number
}

/**
 * Jev answers praise and blame as separate questions, so a comment can be high
 * on both (genuinely mixed) or low on both (advice -- no verdict either way).
 * Collapsing them here rather than in the query keeps the cutoff in one place.
 */
/**
 * One cutoff for both sides, deliberately.
 *
 * Dropping the praise side to 0.5 was tried and reverted. It does move 1,197
 * short positives out of the advice bucket, but it costs more than it buys:
 * the negative bucket shrinks 11.4%, and 829 comments scoring 0.90+ on blame --
 * "This is a terrible class. Monika is BY FAR the worst lecturer I have had at
 * Stanford" among them -- stop reading as negative because a stray clause
 * registers faint praise. A hand audit of the moves also found about half the
 * advice-to-positive ones wrong in the other direction, turning plain
 * instructions ("plan ahead and start assignments early") into praise.
 *
 * The short-positive problem is real but it is a length effect, not a threshold
 * effect, so a global cutoff is the wrong instrument for it.
 */
const THRESHOLD = 0.6

export function bucketOf(row: ScoreRow): CommentSentiment {
  const praised = Math.max(row.instructor_praise, row.course_praise) >= THRESHOLD
  const blamed = Math.max(row.instructor_blame, row.course_blame) >= THRESHOLD
  if (praised && !blamed) return 'positive'
  if (blamed && !praised) return 'negative'
  if (praised && blamed) return 'mixed'
  return 'advice'
}

export const hashComment = (text: string) =>
  createHash('sha256').update(text.trim()).digest('hex')

/**
 * PostgREST puts `in` lists in the query string, so the cap is URL length, not
 * row count. At 64 hex chars plus a separator per hash, 500 builds a ~32KB URL
 * and the request comes back 400 Bad Request -- which looks like "no sentiment
 * exists" rather than like a failure. 75 keeps the URL near 5KB.
 */
const CHUNK = 75

/**
 * Chunks go out together; a cold CS 106B is 1,591 hashes, so serial would crawl.
 * Measured on that course: 22 requests take 806ms at 6 in flight and 544ms at
 * 12, against a 752ms base evaluations query. Widening the chunk instead would
 * cut the request count but push the URL back toward the length that made
 * PostgREST 400 in the first place, so the concurrency is the safer dial.
 */
const LOOKUP_CONCURRENCY = 12

/**
 * Looks up every distinct comment in one pass and returns hash -> bucket.
 * Comments scored after the caller's data was written simply come back absent,
 * which the UI shows as unfiltered rather than as a zero.
 */
export async function fetchSentimentByHash(
  texts: string[],
): Promise<Map<string, CommentSentiment>> {
  const out = new Map<string, CommentSentiment>()
  const hashes = [...new Set(texts.map(hashComment))]
  if (hashes.length === 0) return out

  const supabase = getPublicClient()
  const chunks: string[][] = []
  for (let i = 0; i < hashes.length; i += CHUNK) chunks.push(hashes.slice(i, i + CHUNK))

  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: Math.min(LOOKUP_CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length && !failed) {
        const { data, error } = await supabase
          .from('comment_sentiment')
          .select('comment_hash, instructor_praise, instructor_blame, course_praise, course_blame')
          .in('comment_hash', chunks[next++])

        // Sentiment is an enhancement, not the payload -- a failure here should
        // leave the comments readable rather than fail the whole request.
        if (error) {
          console.error('comment_sentiment lookup failed:', error.message)
          failed = true
          return
        }
        for (const row of (data || []) as ScoreRow[]) {
          out.set(row.comment_hash, bucketOf(row))
        }
      }
    }),
  )
  return failed ? new Map() : out
}

/**
 * Fills in `commentSentiment` on each evaluation, in place, with one round trip
 * for the whole batch. Call it on freshly fetched rows before they are cached,
 * so the scores ride along in the cache instead of being re-queried per request.
 */
export async function attachSentiment(evaluations: CourseEvaluation[]): Promise<void> {
  const texts = evaluations.flatMap(e => e.comments)
  if (texts.length === 0) return

  const byHash = await fetchSentimentByHash(texts)
  if (byHash.size === 0) return

  for (const e of evaluations) {
    e.commentSentiment = e.comments.map(c => byHash.get(hashComment(c)) ?? null)
  }
}
