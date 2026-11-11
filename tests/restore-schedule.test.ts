import { describe, expect, it } from 'vitest'
import { diffLines, main, parseArgs } from '../scripts/restore-schedule.mjs'

const USER = '11111111-2222-4333-8444-555555555555'
const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' } as unknown as NodeJS.ProcessEnv

type Req = { method: string; url: string; body: unknown }

/** A stand-in for PostgREST holding one saved row and its history. */
function fakeDb(opts: { current?: Record<string, unknown> | null; patchMatches?: boolean } = {}) {
  const current =
    opts.current === undefined
      ? { updated_at: '2026-11-10T23:58:01.123456+00:00', schedule: [], plans: null, ignored_exam_clashes: null }
      : opts.current
  const history = [
    {
      id: 7,
      saved_at: '2026-11-10T23:58:01.123456+00:00',
      reason: 'update',
      schedule: [
        { id: 'CS106A', selectedTerm: '2026-2027 Autumn', selectedSectionIds: [101] },
        { id: 'MATH51', selectedSectionId: 55 },
      ],
      plans: null,
      ignored_exam_clashes: null,
    },
    { id: 3, saved_at: '2026-10-01T10:00:00+00:00', reason: 'update', schedule: [{ id: 'PWR1' }], plans: null, ignored_exam_clashes: null },
  ]
  const requests: Req[] = []
  const fetchImpl = async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
    requests.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined })
    expect(init.headers.Authorization).toBe('Bearer service-key')
    const u = new URL(url)
    let payload: unknown = []
    if (init.method === 'GET' && u.pathname.endsWith('/user_schedules')) payload = current ? [current] : []
    else if (init.method === 'GET' && u.pathname.endsWith('/user_schedule_history')) {
      const id = u.searchParams.get('id')
      payload = id ? history.filter(h => `eq.${h.id}` === id) : history
    } else if (init.method === 'PATCH') payload = opts.patchMatches === false ? [] : [{ user_id: USER }]
    else if (init.method === 'POST') payload = [{ user_id: USER }]
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  return { fetchImpl, requests }
}

async function run(argv: string[], db = fakeDb(), answer = '') {
  const lines: string[] = []
  const asked: string[] = []
  const code = await main(argv, {
    env: ENV,
    out: (l: string) => lines.push(l),
    ask: async (q: string) => {
      asked.push(q)
      return answer
    },
    fetchImpl: db.fetchImpl,
  })
  return { code, text: lines.join('\n'), asked, writes: db.requests.filter(r => r.method !== 'GET'), requests: db.requests }
}

describe('restore-schedule arguments', () => {
  it('rejects input that is not a uuid, unknown flags, and mixed modes', () => {
    expect(() => parseArgs([])).toThrow(/user id/)
    expect(() => parseArgs(['someone@stanford.edu'])).toThrow(/user id/)
    expect(() => parseArgs([USER, '--apply'])).toThrow(/version id/)
    expect(() => parseArgs([USER, '--apply', '7;drop'])).toThrow(/version id/)
    expect(() => parseArgs([USER, '--show', '1', '--apply', '2'])).toThrow(/not both/)
    expect(() => parseArgs([USER, '--yes'])).toThrow(/--yes only/)
    expect(() => parseArgs([USER, '--write'])).toThrow(/Unknown/)
    expect(parseArgs([USER, '--apply', '7', '--yes'])).toEqual({ userId: USER, show: null, apply: 7, yes: true })
  })

  it('needs the service role key', async () => {
    await expect(main([USER], { env: {} as NodeJS.ProcessEnv, out: () => {}, fetchImpl: fakeDb().fetchImpl })).rejects.toThrow(/SERVICE_ROLE/)
  })
})

describe('restore-schedule', () => {
  it('lists versions newest first with course counts and writes nothing', async () => {
    const r = await run([USER])
    expect(r.code).toBe(0)
    expect(r.text).toMatch(/Saved now: 0 courses/)
    expect(r.text).toMatch(/^7 +2026-11-10T23:58:01\.123456\+00:00 +update +2$/m)
    expect(r.text).toMatch(/^3 +2026-10-01T10:00:00\+00:00 +update +1$/m)
    expect(r.writes).toEqual([])
    expect(r.requests.every(q => q.url.includes(`user_id=eq.${USER}`))).toBe(true)
  })

  it('--show prints the difference and writes nothing', async () => {
    const r = await run([USER, '--show', '7'])
    expect(r.text).toContain('+ CS106A  2026-2027 Autumn  sections 101')
    expect(r.text).toContain('+ MATH51  sections 55')
    expect(r.writes).toEqual([])
    expect(r.asked).toEqual([])
  })

  it('--apply asks first and writes nothing on a wrong answer', async () => {
    const r = await run([USER, '--apply', '7'], fakeDb(), 'yes')
    expect(r.asked).toHaveLength(1)
    expect(r.code).toBe(1)
    expect(r.text).toMatch(/Nothing was written/)
    expect(r.writes).toEqual([])
  })

  it('--apply with the typed confirmation writes only if the row is unchanged since it was read', async () => {
    const r = await run([USER, '--apply', '7'], fakeDb(), 'restore 7')
    expect(r.code).toBe(0)
    expect(r.writes).toHaveLength(1)
    const w = r.writes[0]
    expect(w.method).toBe('PATCH')
    expect(w.url).toContain(`user_id=eq.${USER}`)
    expect(w.url).toContain(`updated_at=eq.${encodeURIComponent('2026-11-10T23:58:01.123456+00:00')}`)
    expect(w.body).toEqual({
      schedule: [
        { id: 'CS106A', selectedTerm: '2026-2027 Autumn', selectedSectionIds: [101] },
        { id: 'MATH51', selectedSectionId: 55 },
      ],
      plans: null,
      ignored_exam_clashes: null,
    })
  })

  it('reports and stops when the row changed in between', async () => {
    const r = await run([USER, '--apply', '7', '--yes'], fakeDb({ patchMatches: false }))
    expect(r.asked).toEqual([])
    expect(r.code).toBe(1)
    expect(r.text).toMatch(/changed after it was read/)
  })

  it('inserts the row when it no longer exists', async () => {
    const r = await run([USER, '--apply', '3', '--yes'], fakeDb({ current: null }))
    expect(r.code).toBe(0)
    expect(r.writes.map(w => w.method)).toEqual(['POST'])
    expect(r.writes[0].body).toMatchObject({ user_id: USER, schedule: [{ id: 'PWR1' }] })
  })

  it('does not write when the version matches the saved row', async () => {
    const same = { updated_at: 'x', schedule: [{ id: 'PWR1' }], plans: null, ignored_exam_clashes: null }
    const r = await run([USER, '--apply', '3', '--yes'], fakeDb({ current: same }))
    expect(r.text).toMatch(/Nothing to write/)
    expect(r.writes).toEqual([])
  })

  it('refuses a version that does not belong to the user', async () => {
    await expect(run([USER, '--apply', '999', '--yes'])).rejects.toThrow(/No version 999/)
  })
})

describe('diffLines', () => {
  it('shows added, removed and changed courses and other fields', () => {
    const lines = diffLines(
      { schedule: [{ id: 'A', selectedSectionIds: [2] }, { id: 'B' }], plans: { b: [] }, ignored_exam_clashes: null },
      { schedule: [{ id: 'A', selectedSectionIds: [1] }, { id: 'C' }], plans: null, ignored_exam_clashes: null },
    )
    expect(lines).toEqual(['~ A  sections 2   (now: A  sections 1)', '+ B', '- C', '~ plans: null -> {"b":[]}'])
  })

  it('copes with a missing row and non-array schedules', () => {
    expect(diffLines({ schedule: { bad: true } }, null)).toEqual([])
    expect(diffLines({ schedule: [{ id: 'A' }] }, undefined)).toEqual(['+ A'])
  })
})
