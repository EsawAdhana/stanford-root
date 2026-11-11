import { createHash } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase-admin'
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

const SCORE_COLUMNS = 'comment_hash, instructor_praise, instructor_blame, course_praise, course_blame'

/**
 * Hashes per call to comment_sentiment_for, which takes them in the POST body
 * (supabase/migrations/20261111_comment_sentiment_lookup.sql), so no URL ever
 * carries them. Supabase logs every request URL, and the old GET lookups below
 * were about 69% of the project's log volume on 2026-11-08. The cap is the
 * API's row limit, 1,000 by default: a set-returning function is cut off there
 * just like a table read, silently, so a bigger call would drop scores. Each
 * hash matches at most one row, so 1,000 hashes cannot pass it. CS 106B's
 * 1,591 comments are 2 calls instead of 22.
 */
export const RPC_CHUNK = 1000

/**
 * The old lookup, kept for while the function does not exist: PostgREST puts
 * `in` lists in the query string, so the cap is URL length, not row count. At
 * 64 hex chars plus a separator per hash, 500 builds a ~32KB URL and the
 * request comes back 400 Bad Request -- which looks like "no sentiment exists"
 * rather than like a failure. 75 keeps the URL near 5KB.
 */
export const GET_CHUNK = 75

/**
 * Chunks go out together; a cold CS 106B is 1,591 hashes, so serial would crawl.
 * Measured on that course with GET chunks: 22 requests take 806ms at 6 in
 * flight and 544ms at 12, against a 752ms base evaluations query.
 */
const LOOKUP_CONCURRENCY = 12

type LookupResult = {
  data: unknown
  error: { message: string; code?: string } | null
  status?: number
}
type Lookup = (chunk: string[]) => PromiseLike<LookupResult>

/**
 * Set once this server instance has found the function missing, so until the
 * migration is applied each lookup does not spend a failed call first.
 */
let rpcMissing = false

/** For tests: forget that the function was missing. */
export function resetSentimentLookup() {
  rpcMissing = false
}

/** PostgREST's answer when the function is not in its schema cache. */
const isMissingFunction = (result: LookupResult) =>
  result.error?.code === 'PGRST202' || result.status === 404

function chunked(hashes: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < hashes.length; i += size) chunks.push(hashes.slice(i, i + size))
  return chunks
}

/** Adds a lookup's rows to `out`; false when the lookup failed. */
function collect(result: LookupResult, out: Map<string, CommentSentiment>): boolean {
  // Sentiment is an enhancement, not the payload -- a failure here should
  // leave the comments readable rather than fail the whole request.
  if (result.error) {
    console.error('comment_sentiment lookup failed:', result.error.message)
    return false
  }
  for (const row of (result.data || []) as ScoreRow[]) {
    out.set(row.comment_hash, bucketOf(row))
  }
  return true
}

/** Runs `lookup` over every chunk, a few at a time. False when any call failed. */
async function runChunks(chunks: string[][], lookup: Lookup, out: Map<string, CommentSentiment>): Promise<boolean> {
  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: Math.min(LOOKUP_CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length && !failed) {
        if (!collect(await lookup(chunks[next++]), out)) failed = true
      }
    }),
  )
  return !failed
}

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

  // Only ever called from Stanford-gated code paths, and comment_sentiment has no
  // anon policy, so this has to be the service-role client.
  const supabase = getServiceClient()

  if (!rpcMissing) {
    const rpc: Lookup = chunk => supabase.rpc('comment_sentiment_for', { hashes: chunk })
    const [firstChunk, ...rest] = chunked(hashes, RPC_CHUNK)
    // The first call goes alone, so a missing function costs one request, not twelve.
    const first = await rpc(firstChunk)
    if (isMissingFunction(first)) {
      rpcMissing = true
    } else {
      const ok = collect(first, out) && (await runChunks(rest, rpc, out))
      return ok ? out : new Map()
    }
  }

  const ok = await runChunks(
    chunked(hashes, GET_CHUNK),
    chunk => supabase.from('comment_sentiment').select(SCORE_COLUMNS).in('comment_hash', chunk),
    out,
  )
  return ok ? out : new Map()
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
