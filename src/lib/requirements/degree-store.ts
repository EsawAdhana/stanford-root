import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import { EMPTY_OVERRIDES, type AuditOverrides, type ProgramChoice, type StudentCourse } from './types'

/**
 * A student's degree plan: the programs they track, the courses they have
 * taken or plan to (beyond what is on their schedule), and their manual
 * adjustments to the audit.
 *
 * Kept in this browser only. A transcript holds grades, and nothing here
 * needs a server: the audit runs on the page against the published Bulletin
 * data.
 */
type DegreeState = {
  programs: ProgramChoice[]
  courses: StudentCourse[]
  overrides: AuditOverrides
  /** Count the courses on the schedule as in progress or planned. */
  useSchedule: boolean
  /** Undergraduate general education: shown when an undergraduate program is tracked, unless turned off. */
  generalEducation: boolean

  addProgram: (code: string) => void
  updateProgram: (code: string, patch: Partial<ProgramChoice>) => void
  removeProgram: (code: string) => void
  /** Courses from the transcript replace the previous import; hand-added ones stay. */
  importTranscript: (courses: Omit<StudentCourse, 'id' | 'source'>[]) => void
  addCourse: (course: Omit<StudentCourse, 'id' | 'source'>) => void
  updateCourse: (id: string, patch: Partial<StudentCourse>) => void
  removeCourse: (id: string) => void
  pin: (course: string, program: string, node: string) => void
  unpin: (course: string, program: string, node?: string) => void
  setExcluded: (course: string, program: string, excluded: boolean) => void
  setDone: (key: string, done: boolean) => void
  setPath: (key: string, child: string | undefined) => void
  setUseSchedule: (on: boolean) => void
  setGeneralEducation: (on: boolean) => void
  clearAll: () => void
}

const initial = {
  programs: [] as ProgramChoice[],
  courses: [] as StudentCourse[],
  overrides: EMPTY_OVERRIDES,
  useSchedule: true,
  generalEducation: true,
}

export const useDegreeStore = create<DegreeState>()(
  persist(
    (set) => ({
      ...initial,

      addProgram: (code) => set(s => (s.programs.some(p => p.code === code) ? s : { programs: [...s.programs, { code }] })),
      updateProgram: (code, patch) => set(s => ({ programs: s.programs.map(p => (p.code === code ? { ...p, ...patch } : p)) })),
      removeProgram: (code) => set(s => ({
        programs: s.programs.filter(p => p.code !== code),
        // Moves inside a removed program would come back with it; drop them.
        overrides: {
          ...s.overrides,
          pins: s.overrides.pins.filter(p => p.program !== code),
          exclusions: s.overrides.exclusions.filter(e => e.program !== code),
          done: s.overrides.done.filter(k => !k.startsWith(`${code}:`)),
          paths: Object.fromEntries(Object.entries(s.overrides.paths).filter(([k]) => !k.startsWith(`${code}:`))),
        },
      })),

      importTranscript: (incoming) => set(s => {
        const kept = s.courses.filter(c => c.source !== 'transcript')
        // Ids come from code and term, so moves made against last quarter's
        // transcript still apply after importing this quarter's.
        const seen = new Map<string, number>()
        const added = incoming.map(c => {
          const base = `transcript:${c.code}:${c.term}`
          const n = seen.get(base) ?? 0
          seen.set(base, n + 1)
          return { ...c, id: n ? `${base}:${n}` : base, source: 'transcript' as const }
        })
        const ids = new Set([...kept, ...added].map(c => c.id))
        return { courses: [...kept, ...added], overrides: pruneOverrides(s.overrides, ids) }
      }),
      addCourse: (course) => set(s => ({ courses: [...s.courses, { ...course, id: uuid(), source: 'manual' }] })),
      updateCourse: (id, patch) => set(s => ({ courses: s.courses.map(c => (c.id === id ? { ...c, ...patch, id } : c)) })),
      removeCourse: (id) => set(s => {
        const courses = s.courses.filter(c => c.id !== id)
        return { courses, overrides: pruneOverrides(s.overrides, new Set(courses.map(c => c.id)), id) }
      }),

      pin: (course, program, node) => set(s => {
        // A course sits in one place per program: a new move replaces the old one.
        const pins = s.overrides.pins.filter(p => !(p.course === course && p.program === program))
        const exclusions = s.overrides.exclusions.filter(e => !(e.course === course && e.program === program))
        return { overrides: { ...s.overrides, pins: [...pins, { course, program, node }], exclusions } }
      }),
      unpin: (course, program, node) => set(s => ({
        overrides: {
          ...s.overrides,
          pins: s.overrides.pins.filter(p => !(p.course === course && p.program === program && (!node || p.node === node))),
        },
      })),
      setExcluded: (course, program, excluded) => set(s => {
        const exclusions = s.overrides.exclusions.filter(e => !(e.course === course && e.program === program))
        const pins = excluded ? s.overrides.pins.filter(p => !(p.course === course && p.program === program)) : s.overrides.pins
        return { overrides: { ...s.overrides, pins, exclusions: excluded ? [...exclusions, { course, program }] : exclusions } }
      }),
      setDone: (key, done) => set(s => {
        const rest = s.overrides.done.filter(k => k !== key)
        return { overrides: { ...s.overrides, done: done ? [...rest, key] : rest } }
      }),
      setPath: (key, child) => set(s => {
        const paths = { ...s.overrides.paths }
        if (child) paths[key] = child
        else delete paths[key]
        return { overrides: { ...s.overrides, paths } }
      }),
      setUseSchedule: (on) => set({ useSchedule: on }),
      setGeneralEducation: (on) => set({ generalEducation: on }),
      clearAll: () => set({ ...initial }),
    }),
    {
      name: 'root-degree-plan',
      version: 1,
      migrate: (persisted, version) => migrateDegreePlan(persisted, version) as DegreeState,
    },
  ),
)

/**
 * A plan saved by the v2 page keys subplans, optional sections and moves by
 * the Bulletin's own ids, where this version numbers them in build order
 * ("b6", "r12"). Those ids point at nothing here, so they go; programs,
 * courses and exclusions, which name only courses and programs, stay.
 */
export function migrateDegreePlan(persisted: unknown, version: number) {
  const state = (persisted ?? {}) as { programs?: ProgramChoice[]; overrides?: AuditOverrides }
  if (version <= 1) return state
  return {
    ...state,
    programs: (state.programs ?? []).map(p => ({ code: p.code, secondary: p.secondary, exploring: p.exploring })),
    overrides: { ...EMPTY_OVERRIDES, exclusions: state.overrides?.exclusions ?? [] },
  }
}

/**
 * Drop moves and exclusions for course attempts that no longer exist. Schedule
 * courses have ids of their own ("schedule:CS106B:Autumn 2026") that are not
 * in `ids`, so those are kept.
 */
function pruneOverrides(o: AuditOverrides, ids: Set<string>, removed?: string): AuditOverrides {
  const keep = (id: string) => id !== removed && (ids.has(id) || id.startsWith('schedule:'))
  return { ...o, pins: o.pins.filter(p => keep(p.course)), exclusions: o.exclusions.filter(e => keep(e.course)) }
}
