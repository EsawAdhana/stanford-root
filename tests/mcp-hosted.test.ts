import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Course, Section } from '@/types/course'

/**
 * The hosted MCP server (src/app/api/mcp) through the MCP protocol: the
 * official client speaks Streamable HTTP to the route handler itself, with the
 * catalog, the database and token verification replaced by fakes. These cases
 * try to break the contract the agent depends on.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

const W = 'Winter 2027'
const A = 'Autumn 2026'
const sec = (classId: number, term: string, component: string, days: string, time: string, extra: Partial<Section> = {}): Section => ({
  term, classId, sectionNumber: '1', component, units: '3-5', grading: 'Letter', instructionalMode: 'In Person', status: 'Open',
  enrolled: 10, capacity: 100, waitlist: 0, waitlistMax: 0, startDate: '2027-01-04', endDate: '2027-03-12',
  meetings: [{ days, time, instructors: ['Doe, Jane'] }], gers: [], ...extra,
})
const course = (id: string, subject: string, code: string, title: string, terms: string[], sections: Section[], extra: Partial<Course> = {}): Course => ({
  id, subject, code, title, description: '', units: '3-5', grading: 'Letter or Credit/No Credit', instructors: ['Doe, Jane'], terms, sections, ...extra,
})

const COURSES: Course[] = [
  course('CS161', 'CS', '161', 'Design and Analysis of Algorithms', [W], [
    sec(1933, W, 'LEC', 'Monday, Wednesday, Friday', '1:30 PM - 2:50 PM', { gers: ['WAY-FR'] }),
    sec(1934, W, 'DIS', 'Thursday', '4:30 PM - 5:20 PM', { gers: ['WAY-FR'] }),
  ], { quality: 4.07, qualityN: 300, hours: 15 }),
  course('PHIL150', 'PHIL', '150', 'Mathematical Logic', [W], [sec(1000, W, 'LEC', 'Tuesday, Thursday', '1:30 PM - 2:50 PM', { gers: ['WAY-FR'] })], { quality: 4.3, qualityN: 120, description: 'Formal systems and proofs.' }),
  course('EARTHSYS10', 'EARTHSYS', '10', 'Introduction to Earth Systems', [W], [
    sec(1200, W, 'LEC', 'Monday, Wednesday', '1:30 PM - 2:50 PM'),
    sec(1201, W, 'DIS', 'Friday', '1:30 PM - 2:20 PM', { capacity: 20, enrolled: 20 }),
  ], { description: 'Climate policy, oceans and the atmosphere.' }),
  course('CS106B', 'CS', '106B', 'Programming Abstractions', [A], [sec(500, A, 'LEC', 'Monday, Wednesday, Friday', '11:30 AM - 12:20 PM')]),
  // WAY-FR and not CS, but Mon/Wed/Fri: only the days filter keeps it out of "Tue/Thu only".
  course('MATH51', 'MATH', '51', 'Linear Algebra', [W], [sec(1100, W, 'LEC', 'Monday, Wednesday, Friday', '10:30 AM - 11:20 AM', { gers: ['WAY-FR'] })]),
]

let schedule: { id: string; selectedTerm?: string; selectedSectionIds?: number[]; optionalMeetings?: string[] }[] | null = null
let writes = 0
let browserEdit: ((s: NonNullable<typeof schedule>) => NonNullable<typeof schedule>) | null = null
const feedback: string[] = []

vi.mock('@/lib/catalog-dump', () => ({
  getAllCoursesFromDump: async () => COURSES,
  getInstructorDirectory: async () => ({ entries: [{ name: 'Jane Doe', slug: 'doe-jane', aliases: ['Doe, Jane'] }], byInitialSlug: new Map() }),
}))

vi.mock('@/lib/mcp/auth', () => ({
  AUTH_SERVER: () => 'https://proj.supabase.co/auth/v1',
  verifyToken: async (_req: Request, bearer?: string) => {
    if (bearer === 'stanford') return { token: bearer, clientId: 'c', scopes: ['email'], extra: { userId: 'u1', email: 'student@stanford.edu' } }
    if (bearer === 'gmail') return { token: bearer, clientId: 'c', scopes: ['email'], extra: { userId: 'u2', email: 'someone@gmail.com' } }
    return undefined
  },
}))

vi.mock('@/lib/mcp/data', async () => {
  const { ToolFailure } = await import('@/lib/mcp/errors')
  class ScheduleConflict extends Error {}
  const isStanford = (c: { email: string }) => c.email.endsWith('@stanford.edu')
  return {
    ScheduleConflict,
    isStanford,
    readSchedule: async () => (schedule === null ? null : JSON.parse(JSON.stringify(schedule))),
    writeSchedule: async (_c: unknown, next: NonNullable<typeof schedule>, expected: typeof schedule) => {
      if (browserEdit && schedule) { schedule = browserEdit(schedule); browserEdit = null }
      if (JSON.stringify(expected) !== JSON.stringify(schedule)) throw new ScheduleConflict()
      schedule = JSON.parse(JSON.stringify(next))
      writes++
    },
    evaluations: async (c: { email: string }) => {
      if (!isStanford(c)) throw new ToolFailure('stanford_only', 'Evaluations are only for signed-in Stanford accounts.', { retryable: false })
      return []
    },
    classYears: async () => null,
    instructorEvaluations: async () => null,
    liveSeats: async () => null,
    sendFeedback: async (_c: unknown, text: string) => { feedback.push(text) },
  }
})

const { POST } = await import('@/app/api/mcp/route')

async function connect(bearer = 'stanford') {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
    fetch: (url, init) => POST(new Request(url, init)),
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  })
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(transport)
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] }
  const text = result.content[0].text
  if (!result.isError) return { ok: JSON.parse(text) }
  // Our failures are JSON; a schema rejection is the SDK's plain-text validation message.
  try {
    return { error: JSON.parse(text).error }
  } catch {
    return { error: { code: 'validation', message: text } }
  }
}

beforeEach(() => {
  schedule = []
  writes = 0
  browserEdit = null
  feedback.length = 0
})

describe('hosted MCP server', () => {
  it('answers 401 with the resource metadata when there is no token', async () => {
    const res = await POST(new Request('http://localhost/api/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"')
  })

  it('lists the same 12 tools, with constraints and brakes in the schema', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name).sort()).toEqual(['add_to_schedule', 'export_calendar', 'get_course', 'get_course_evaluations', 'get_course_reviews',
      'get_instructor', 'get_my_schedule', 'import_calendar', 'remove_from_schedule', 'search_courses', 'send_feedback', 'set_meetings_optional'])
    const by = Object.fromEntries(tools.map(t => [t.name, t]))
    expect(by.search_courses.annotations?.readOnlyHint).toBe(true)
    expect(by.remove_from_schedule.annotations?.destructiveHint).toBe(true)
    const props = by.search_courses.inputSchema.properties as Record<string, { items?: { enum?: string[] }; maximum?: number }>
    expect(props.gers.items?.enum).toContain('WAY-FR')
    expect(props.limit.maximum).toBe(25)
    expect(client.getInstructions()).toContain('confirm_token')
  })

  it('searches with the site filters plus days and exclusions', async () => {
    const client = await connect()
    const r = await call(client, 'search_courses', { term: W, gers: ['WAY-FR'], days_only: ['Tue', 'Thu'], exclude_subjects: ['CS'] })
    expect(r.ok.matches.map((m: { course_id: string }) => m.course_id)).toEqual(['PHIL150'])
    const open = await call(client, 'search_courses', { term: W, open_seats_only: true, limit: 25 })
    expect(open.ok.matches.map((m: { course_id: string }) => m.course_id)).not.toContain('EARTHSYS10')
    const about = await call(client, 'search_courses', { query: 'climate policy' })
    expect(about.ok.matches[0].course_id).toBe('EARTHSYS10')
  })

  it('rejects bad arguments before doing anything', async () => {
    const client = await connect()
    for (const args of [{ term: 'Fall 2026' }, { limit: 500 }, { gers: ['WAY-XYZ'] }, { earliest_start: '9am' }, { extra: 1 }]) {
      const r = await call(client, 'search_courses', args)
      expect(r.error?.code, JSON.stringify(args)).toBe('validation')
    }
  })

  it('reports unknown courses, unoffered quarters and foreign sections as data', async () => {
    const client = await connect()
    expect((await call(client, 'get_course', { course_id: 'CS16' })).error).toMatchObject({ code: 'course_not_found', retryable: false })
    expect((await call(client, 'add_to_schedule', { course_id: 'CS161' })).error).toMatchObject({ code: 'not_offered', details: { offered_terms: [W] } })
    expect((await call(client, 'add_to_schedule', { course_id: 'CS161', term: W, section_ids: [500] })).error?.code).toBe('invalid_section')
    expect(writes).toBe(0)
  })

  it('adds, then removes only with a fresh preview token', async () => {
    const client = await connect()
    const added = await call(client, 'add_to_schedule', { course_id: 'CS161', term: W, section_ids: [1933] })
    expect(added.ok.action).toBe('added')
    expect(schedule).toEqual([{ id: 'CS161', selectedTerm: W, selectedSectionIds: [1933] }])
    expect((await call(client, 'remove_from_schedule', { course_id: 'CS161', dry_run: false })).error?.code).toBe('preview_required')
    const preview = await call(client, 'remove_from_schedule', { course_id: 'CS161' })
    expect(schedule).toHaveLength(1)
    const done = await call(client, 'remove_from_schedule', { course_id: 'CS161', dry_run: false, confirm_token: preview.ok.confirm_token })
    expect(done.ok.whole_course).toBe(true)
    expect(schedule).toEqual([])
  })

  it('lets a browser edit that lands mid-write survive', async () => {
    const client = await connect()
    schedule = [{ id: 'CS106B', selectedTerm: A }]
    browserEdit = s => [...s, { id: 'PHIL150', selectedTerm: W }]
    await call(client, 'add_to_schedule', { course_id: 'CS161', term: W })
    expect(schedule!.map(i => i.id)).toEqual(['CS106B', 'PHIL150', 'CS161'])
  })

  it('shows overlaps, and marks optional meetings per day', async () => {
    const client = await connect()
    schedule = [{ id: 'EARTHSYS10', selectedTerm: W, selectedSectionIds: [1200] }, { id: 'CS161', selectedTerm: W, selectedSectionIds: [1933] }]
    let mine = await call(client, 'get_my_schedule', { term: W })
    expect(mine.ok.terms[0].overlaps).toEqual([{ course_ids: ['EARTHSYS10', 'CS161'], when: 'Mon/Wed 1:30 PM-2:50 PM' }])
    await call(client, 'set_meetings_optional', { course_id: 'CS161', days: ['Mon', 'Wed'] })
    mine = await call(client, 'get_my_schedule', { term: W })
    expect(mine.ok.terms[0].overlaps).toEqual([])
    expect(mine.ok.terms[0].overlaps_if_attending_optional).toHaveLength(1)
    expect(mine.ok.terms[0].entries[1].sections[0].meetings).toEqual(['Fri 1:30 PM-2:50 PM', 'Mon/Wed 1:30 PM-2:50 PM (marked optional)'])
  })

  it('round-trips an export through import', async () => {
    const client = await connect()
    schedule = [{ id: 'CS161', selectedTerm: W, selectedSectionIds: [1933, 1934] }]
    const cal = await call(client, 'export_calendar', { term: W })
    schedule = []
    const preview = await call(client, 'import_calendar', { ics: cal.ok.ics })
    expect(preview.ok.courses).toEqual([expect.objectContaining({ course_id: 'CS161', section_ids: [1933, 1934], action: 'add' })])
    await call(client, 'import_calendar', { ics: cal.ok.ics, dry_run: false, confirm_token: preview.ok.confirm_token })
    expect(schedule).toEqual([{ id: 'CS161', selectedTerm: W, selectedSectionIds: [1933, 1934] }])
  })

  it('keeps evaluations Stanford-only and feedback behind a preview', async () => {
    const outsider = await connect('gmail')
    expect((await call(outsider, 'get_course_reviews', { course_id: 'CS161' })).error?.code).toBe('stanford_only')
    const client = await connect()
    const preview = await call(client, 'send_feedback', { text: 'Add dark mode' })
    expect(feedback).toEqual([])
    expect((await call(client, 'send_feedback', { text: 'Something else', dry_run: false, confirm_token: preview.ok.confirm_token })).error?.code).toBe('preview_required')
    await call(client, 'send_feedback', { text: 'Add dark mode', dry_run: false, confirm_token: preview.ok.confirm_token })
    expect(feedback).toEqual(['Add dark mode'])
  })
})

describe('protected resource metadata', () => {
  it('names Supabase as the authorization server', async () => {
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/api/mcp/route')
    const body = await (await GET(new Request('https://www.stanfordroot.com/.well-known/oauth-protected-resource/api/mcp'))).json()
    expect(body).toEqual({ resource: 'https://www.stanfordroot.com/api/mcp', authorization_servers: ['https://proj.supabase.co/auth/v1'] })
  })
})
