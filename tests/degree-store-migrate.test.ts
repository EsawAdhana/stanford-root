import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A student who saved a plan on the v2 page and opens this version. Without a
 * migration, zustand drops a plan whose version it does not know, and the
 * student's next click saves an empty one over it.
 */

const saved = {
  version: 2,
  state: {
    programs: [{ code: 'ENGL-BA', subplan: 'creative-writing', optional: ['honors'] }, { code: 'PORT-MIN', secondary: true }],
    courses: [
      { id: 'transcript:ENGLISH 10A:Autumn 2024', code: 'ENGLISH 10A', term: 'Autumn 2024', units: 5, grade: 'A', source: 'transcript' },
      { id: 'm1', code: 'PORTLANG 11A', term: 'Winter 2025', units: 5, grade: 'A-', source: 'manual' },
    ],
    overrides: {
      pins: [{ course: 'm1', program: 'PORT-MIN', node: 'language-core' }],
      exclusions: [{ course: 'm1', program: 'ENGL-BA' }],
      done: ['ENGL-BA:senior-seminar'],
      paths: { 'ENGL-BA:period': 'early' },
    },
    useSchedule: false,
    generalEducation: true,
  },
}

let store: Map<string, string>

async function load() {
  vi.resetModules()
  const { useDegreeStore } = await import('@/lib/requirements/degree-store')
  await useDegreeStore.persist.rehydrate()
  return useDegreeStore
}

beforeEach(() => {
  store = new Map([['root-degree-plan', JSON.stringify(saved)]])
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
})

describe('opening a plan the v2 page saved', () => {
  it('keeps the programs, courses, settings and exclusions, and drops what v2 ids name', async () => {
    const s = (await load()).getState()
    expect(s.programs).toEqual([{ code: 'ENGL-BA' }, { code: 'PORT-MIN', secondary: true }])
    expect(s.courses.map(c => c.code)).toEqual(['ENGLISH 10A', 'PORTLANG 11A'])
    expect(s.useSchedule).toBe(false)
    expect(s.overrides).toEqual({ pins: [], exclusions: [{ course: 'm1', program: 'ENGL-BA' }], done: [], paths: {} })
  })

  it('saves it back as a version 1 plan, so the next click keeps the courses', async () => {
    const useDegreeStore = await load()
    useDegreeStore.getState().addProgram('CS-MIN')
    const written = JSON.parse(store.get('root-degree-plan')!)
    expect(written.version).toBe(1)
    expect(written.state.courses).toHaveLength(2)
    expect(written.state.programs.map((p: { code: string }) => p.code)).toEqual(['ENGL-BA', 'PORT-MIN', 'CS-MIN'])
  })

  it('leaves a version 1 plan exactly as it was', async () => {
    store.set('root-degree-plan', JSON.stringify({ ...saved, version: 1 }))
    const s = (await load()).getState()
    expect(s.programs).toEqual(saved.state.programs)
    expect(s.overrides).toEqual(saved.state.overrides)
  })
})
