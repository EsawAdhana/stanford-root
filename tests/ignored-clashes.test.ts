import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canonical } from './helpers/user-schedules-table'

/**
 * Ignored finals clashes, driven through the real module against an in-memory
 * user_schedules row. `hasColumn` off stands for production before the
 * migration that adds ignored_exam_clashes; `row` null for a student whose
 * schedule has not been saved yet.
 */

const MON = '2026-12-07@1140:CS145+CS329X'
const THU = '2026-12-10@1140:CS146S+CS329M'
const A26 = 'Autumn 2026'
const W27 = 'Winter 2027'

let row: { ignored_exam_clashes: unknown } | null = null
let hasColumn = true
let offline = false

const maybeSingle = vi.fn(async () => {
  if (offline) return { data: null, error: { message: 'Failed to fetch' } }
  if (!hasColumn) return { data: null, error: { code: '42703', message: 'column user_schedules.ignored_exam_clashes does not exist' } }
  return { data: row ? { ignored_exam_clashes: structuredClone(row.ignored_exam_clashes) } : null, error: null }
})
const update = vi.fn(async (values: { ignored_exam_clashes: unknown }) => {
  if (offline) return { error: { message: 'Failed to fetch' } }
  if (row) row = { ...row, ...structuredClone(values) }
  return { error: null }
})

/**
 * The conditional write: lands only while the column still holds `expected`,
 * compared the way Postgres compares jsonb.
 */
function writeIf(values: { ignored_exam_clashes: unknown }, expected: unknown) {
  return {
    select: async () => {
      if (offline) return { data: null, error: { message: 'Failed to fetch' } }
      if (!row || canonical(row.ignored_exam_clashes ?? null) !== canonical(expected)) return { data: [], error: null }
      const { error } = await update(values)
      return error ? { data: null, error } : { data: [{ user_id: USER }], error: null }
    },
  }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: (values: { ignored_exam_clashes: unknown }) => ({
        eq: () => ({
          is: (_column: string, _value: null) => writeIf(values, null),
          eq: (_column: string, json: string) => writeIf(values, JSON.parse(json)),
        }),
      }),
    }),
  },
}))

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  } as Storage
}

/** One device across page loads: its storage survives, module state does not. */
function makeDevice() {
  const storage = makeStorage()
  return {
    async load() {
      vi.resetModules()
      ;(globalThis as { localStorage?: Storage }).localStorage = storage
      return import('@/lib/ignored-clashes')
    },
  }
}

const USER = 'user-1'

beforeEach(() => {
  row = { ignored_exam_clashes: null }
  hasColumn = true
  offline = false
  maybeSingle.mockClear()
  update.mockClear()
})

describe('reading a stored list', () => {
  it('keeps string signatures per term, once each', async () => {
    const { readIgnoredClashes } = await makeDevice().load()
    expect(readIgnoredClashes({ [A26]: [MON, MON, THU] })).toEqual({ [A26]: [MON, THU] })
  })

  it('drops anything malformed instead of failing', async () => {
    const { readIgnoredClashes } = await makeDevice().load()
    expect(readIgnoredClashes(null)).toEqual({})
    expect(readIgnoredClashes('x')).toEqual({})
    expect(readIgnoredClashes([MON])).toEqual({})
    expect(readIgnoredClashes({ [A26]: 'x', [W27]: [7, '', MON] })).toEqual({ [W27]: [MON] })
  })

  it('merges two lists per term without repeats', async () => {
    const { mergeIgnoredClashes } = await makeDevice().load()
    expect(mergeIgnoredClashes({ [A26]: [MON] }, { [A26]: [MON, THU], [W27]: [MON] })).toEqual({ [A26]: [MON, THU], [W27]: [MON] })
  })
})

describe('ignoring on this device', () => {
  it('holds across a reload while signed out, with no request', async () => {
    const laptop = makeDevice()
    let lib = await laptop.load()
    await lib.ignoreExamClash(null, A26, MON)
    lib = await laptop.load()
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [MON] })
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it('clears on sign-out', async () => {
    const lib = await makeDevice().load()
    await lib.ignoreExamClash(null, A26, MON)
    lib.clearIgnoredClashes()
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({})
  })

  it('drops an account read that finishes after sign-out', async () => {
    row = { ignored_exam_clashes: { [A26]: [MON] } }
    const lib = await makeDevice().load()
    let release: () => void = () => {}
    maybeSingle.mockImplementationOnce(async () => {
      await new Promise<void>(r => { release = r })
      return { data: { ignored_exam_clashes: { [A26]: [MON] } }, error: null }
    })
    const sync = lib.syncIgnoredClashes(USER)
    lib.clearIgnoredClashes() // signs out while the read is out
    release()
    await sync
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({})
    expect(update).not.toHaveBeenCalled()
  })
})

describe('the account', () => {
  it('does not hand one student\'s ignores to the next account on this device', async () => {
    // Synced as student A, whose session then lapsed without a sign-out here.
    row = { ignored_exam_clashes: { [A26]: [MON] } }
    const deviceA = makeDevice()
    let lib = await deviceA.load()
    await lib.syncIgnoredClashes('student-a')
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [MON] })

    // Student B signs in on the same browser after a reload.
    row = { ignored_exam_clashes: { [A26]: [THU] } }
    lib = await deviceA.load()
    await lib.syncIgnoredClashes('student-b')
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [THU] })
    expect(row?.ignored_exam_clashes).toEqual({ [A26]: [THU] })
    expect(update).not.toHaveBeenCalled()
  })

  it('still carries ignores made signed out into the account that signs in', async () => {
    row = { ignored_exam_clashes: null }
    const lib = await makeDevice().load()
    await lib.ignoreExamClash(null, A26, MON)
    await lib.syncIgnoredClashes(USER)
    expect(row?.ignored_exam_clashes).toEqual({ [A26]: [MON] })
  })

  it('carries an ignore from the laptop to the phone', async () => {
    const laptop = await makeDevice().load()
    await laptop.ignoreExamClash(USER, A26, MON)
    expect(row?.ignored_exam_clashes).toEqual({ [A26]: [MON] })

    const phone = await makeDevice().load()
    await phone.syncIgnoredClashes(USER)
    expect(phone.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [MON] })
  })

  it('keeps both when two devices each ignored a different clash', async () => {
    const phoneDevice = makeDevice()
    let phone = await phoneDevice.load()
    offline = true
    await phone.ignoreExamClash(USER, A26, THU) // stays on the phone for now
    offline = false

    const laptop = await makeDevice().load()
    await laptop.ignoreExamClash(USER, A26, MON)
    expect(row?.ignored_exam_clashes).toEqual({ [A26]: [MON] })

    phone = await phoneDevice.load()
    await phone.syncIgnoredClashes(USER)
    expect(phone.useIgnoredClashStore.getState().byTerm[A26]?.sort()).toEqual([MON, THU].sort())
    expect((row?.ignored_exam_clashes as Record<string, string[]>)[A26].sort()).toEqual([MON, THU].sort())

    await laptop.syncIgnoredClashes(USER)
    expect(laptop.useIgnoredClashStore.getState().byTerm[A26]?.sort()).toEqual([MON, THU].sort())
  })

  it('does not overwrite an ignore another device saved between its read and its write', async () => {
    const laptop = await makeDevice().load()
    // The phone's ignore lands just after the laptop has read the account.
    maybeSingle.mockImplementationOnce(async () => {
      const read = { data: { ignored_exam_clashes: structuredClone(row!.ignored_exam_clashes) }, error: null }
      row = { ignored_exam_clashes: { [W27]: [THU] } }
      return read
    })
    await laptop.ignoreExamClash(USER, A26, MON)
    expect(row?.ignored_exam_clashes).toEqual({ [W27]: [THU], [A26]: [MON] })
    expect(laptop.useIgnoredClashStore.getState().byTerm).toEqual({ [W27]: [THU], [A26]: [MON] })
  })

  it('writes nothing when the account already has everything', async () => {
    row = { ignored_exam_clashes: { [A26]: [MON] } }
    const lib = await makeDevice().load()
    await lib.syncIgnoredClashes(USER)
    expect(update).not.toHaveBeenCalled()
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [MON] })
  })

  it('keeps the ignore on the device before the column exists, then carries it once it does', async () => {
    hasColumn = false
    const laptopDevice = makeDevice()
    let laptop = await laptopDevice.load()
    await expect(laptop.ignoreExamClash(USER, A26, MON)).resolves.toBeUndefined()
    expect(laptop.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [MON] })
    expect(update).not.toHaveBeenCalled()

    hasColumn = true
    laptop = await laptopDevice.load()
    await laptop.syncIgnoredClashes(USER)
    expect(row?.ignored_exam_clashes).toEqual({ [A26]: [MON] })
  })

  it('stops asking for a column that does not exist, until the next page load', async () => {
    hasColumn = false
    const laptopDevice = makeDevice()
    const laptop = await laptopDevice.load()
    await laptop.syncIgnoredClashes(USER)
    await laptop.syncIgnoredClashes(USER) // a window focus later in the same visit
    expect(maybeSingle).toHaveBeenCalledTimes(1)
    hasColumn = true
    const reloaded = await laptopDevice.load()
    await reloaded.syncIgnoredClashes(USER)
    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('keeps asking after an ordinary failure, like being offline', async () => {
    offline = true
    const lib = await makeDevice().load()
    await lib.syncIgnoredClashes(USER)
    offline = false
    await lib.syncIgnoredClashes(USER)
    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('waits for the saved row instead of writing one', async () => {
    row = null
    const lib = await makeDevice().load()
    await lib.ignoreExamClash(USER, A26, MON)
    expect(update).not.toHaveBeenCalled()
    expect(lib.useIgnoredClashStore.getState().byTerm).toEqual({ [A26]: [MON] })
  })

  it('ignores a malformed value on the account and replaces it with a good one', async () => {
    row = { ignored_exam_clashes: { [A26]: 'not a list' } }
    const lib = await makeDevice().load()
    await lib.ignoreExamClash(USER, A26, MON)
    expect(row?.ignored_exam_clashes).toEqual({ [A26]: [MON] })
  })
})
