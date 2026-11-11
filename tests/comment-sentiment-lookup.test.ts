import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sentiment lookup posts the hashes to comment_sentiment_for, and falls
 * back to the old chunked GET while that function is not deployed. The client
 * here behaves like PostgREST: a 1,000-row cap on what any call returns, and
 * PGRST202 / 404 for a function it does not know.
 */
type Row = { comment_hash: string; instructor_praise: number; instructor_blame: number; course_praise: number; course_blame: number }
type Calls = { rpc: string[][]; get: string[][] }

const MAX_ROWS = 1000
let table = new Map<string, Row>()
let calls: Calls = { rpc: [], get: [] }
let rpcBehaviour: 'ok' | 'missing-code' | 'missing-404' | 'error' | 'fail-second' = 'ok'
let getFails = false

const rowsFor = (hashes: string[]) => hashes.flatMap(h => (table.has(h) ? [table.get(h)!] : [])).slice(0, MAX_ROWS)

const client = {
    rpc: vi.fn(async (fn: string, args: { hashes: string[] }) => {
        expect(fn).toBe('comment_sentiment_for')
        calls.rpc.push(args.hashes)
        if (rpcBehaviour === 'missing-code') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }
        if (rpcBehaviour === 'missing-404') return { data: null, error: { message: 'Not Found' }, status: 404 }
        if (rpcBehaviour === 'error') return { data: null, error: { code: '57014', message: 'statement timeout' }, status: 500 }
        if (rpcBehaviour === 'fail-second' && calls.rpc.length === 2) return { data: null, error: { code: '08006', message: 'connection lost' }, status: 503 }
        return { data: rowsFor(args.hashes), error: null, status: 200 }
    }),
    from: vi.fn((name: string) => {
        expect(name).toBe('comment_sentiment')
        return {
            select: () => ({
                in: async (_col: string, hashes: string[]) => {
                    calls.get.push(hashes)
                    if (getFails) return { data: null, error: { message: 'Bad Request' }, status: 400 }
                    return { data: rowsFor(hashes), error: null, status: 200 }
                },
            }),
        }
    }),
}

vi.mock('@/lib/supabase-admin', () => ({ getServiceClient: () => client }))

const { fetchSentimentByHash, hashComment, resetSentimentLookup, RPC_CHUNK, GET_CHUNK } = await import('@/lib/comment-sentiment')

/** n distinct comments, all scored, alternating praise and blame. */
function scoredComments(n: number) {
    const texts = Array.from({ length: n }, (_, i) => `comment number ${i}`)
    table = new Map(texts.map((t, i) => {
        const praise = i % 2 === 0 ? 0.9 : 0.1
        return [hashComment(t), { comment_hash: hashComment(t), instructor_praise: praise, instructor_blame: 1 - praise, course_praise: 0, course_blame: 0 }]
    }))
    return texts
}

beforeEach(() => {
    resetSentimentLookup()
    calls = { rpc: [], get: [] }
    rpcBehaviour = 'ok'
    getFails = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('sentiment lookup through comment_sentiment_for', () => {
    it('scores CS 106B-sized course (1,591 comments) in 2 calls and no GETs', async () => {
        const texts = scoredComments(1591)
        const byHash = await fetchSentimentByHash(texts)
        expect(calls.rpc.map(c => c.length)).toEqual([1000, 591])
        expect(calls.get).toEqual([])
        expect(byHash.size).toBe(1591)
        expect(byHash.get(hashComment(texts[0]))).toBe('positive')
        expect(byHash.get(hashComment(texts[1]))).toBe('negative')
    })

    it('never asks for more rows than the API row cap returns', async () => {
        // A call bigger than the cap would come back cut at 1,000 rows, silently.
        expect(RPC_CHUNK).toBeLessThanOrEqual(MAX_ROWS)
        const texts = scoredComments(MAX_ROWS * 3 + 1)
        expect((await fetchSentimentByHash(texts)).size).toBe(MAX_ROWS * 3 + 1)
    })

    it('sends each distinct comment once, trimmed the way the labelling script hashes it', async () => {
        const [a, b] = scoredComments(2)
        await fetchSentimentByHash([a, ` ${a} `, b, a])
        expect(calls.rpc).toEqual([[hashComment(a), hashComment(b)]])
    })

    it('makes no call for a course with no comments', async () => {
        expect((await fetchSentimentByHash([])).size).toBe(0)
        expect(calls.rpc).toEqual([])
    })

    it('leaves unscored comments out rather than guessing', async () => {
        const texts = scoredComments(3)
        const byHash = await fetchSentimentByHash([...texts, 'never scored'])
        expect(byHash.size).toBe(3)
        expect(byHash.has(hashComment('never scored'))).toBe(false)
    })

    it('returns nothing, and does not fall back, when the function fails for another reason', async () => {
        const texts = scoredComments(10)
        rpcBehaviour = 'error'
        expect((await fetchSentimentByHash(texts)).size).toBe(0)
        expect(calls.get).toEqual([])
    })

    it('returns nothing rather than a partial set when a later call fails', async () => {
        const texts = scoredComments(2500)
        rpcBehaviour = 'fail-second'
        expect((await fetchSentimentByHash(texts)).size).toBe(0)
    })
})

describe('before the migration is applied', () => {
    it.each(['missing-code', 'missing-404'] as const)('falls back to the chunked GET when the function is missing (%s)', async behaviour => {
        const texts = scoredComments(1591)
        rpcBehaviour = behaviour
        const byHash = await fetchSentimentByHash(texts)
        expect(calls.rpc).toHaveLength(1)
        expect(calls.get).toHaveLength(Math.ceil(1591 / GET_CHUNK))
        expect(Math.max(...calls.get.map(c => c.length))).toBe(GET_CHUNK)
        expect(byHash.size).toBe(1591)
    })

    it('stops trying the function on this instance once it has been found missing', async () => {
        const texts = scoredComments(20)
        rpcBehaviour = 'missing-code'
        await fetchSentimentByHash(texts)
        await fetchSentimentByHash(texts)
        expect(calls.rpc).toHaveLength(1)
        expect(calls.get).toHaveLength(2)
    })

    it('keeps the old failure behaviour on the GET path', async () => {
        const texts = scoredComments(200)
        rpcBehaviour = 'missing-code'
        getFails = true
        expect((await fetchSentimentByHash(texts)).size).toBe(0)
    })
})
