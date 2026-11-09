/**
 * An in-memory stand-in for `supabase.from('user_schedules')`, covering the
 * calls the browser sync makes and nothing else:
 *
 *   select('schedule, plans').eq('user_id', id).single()                read
 *   update({ schedule, plans? }).eq('user_id', id).eq('schedule', json)
 *     .eq('plans', json) or .is('plans', null) (optional) .select()      compare-and-set
 *   insert({ user_id, schedule, plans? }).select()                      first save
 *   upsert({ user_id, schedule })                                       what older releases send
 *
 * The compare matches the way Postgres compares jsonb: object key order does
 * not matter, array order does. Each test keeps its own row and its own spies;
 * `write` is the test's existing write spy, so a test that counts or fails
 * writes keeps doing so whichever of update, insert or upsert carried them.
 * A write passes on exactly the columns the sync named, so a test can check
 * that a row without plans is still written as `{ user_id, schedule }`.
 * Any other call (delete, rpc, a different table) throws, so a test fails if
 * the sync starts needing something the live table's policies do not allow.
 */

type Item = { id: string }
type Payload<T extends Item> = { user_id: string; schedule: T[]; plans?: unknown }
type WriteResult = { error: { message: string; code?: string } | null }

export type TableOptions<T extends Item> = {
  /** The row as stored right now, without counting as a read. */
  peek: (userId: string) => T[] | null
  /** The row's `plans` right now. Leave out for a test whose rows never have plans. */
  peekPlans?: (userId: string) => unknown
  /** Stores a row. Usually the test's own `upsert` spy. */
  write: (payload: Payload<T>) => Promise<WriteResult>
  /** The read the sync makes. Usually the test's own `selectSingle` spy. */
  read: (userId: string) => Promise<unknown>
  /** Told the method of every call the sync makes on the table, in order. */
  onCall?: (method: 'select' | 'update' | 'insert' | 'upsert') => void
}

/** jsonb equality: sorted object keys, ordered arrays. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** A compare longer than this, URL-encoded, fails the way the gateway fails it. */
export const URL_LIMIT = 16_000

type Filter = { column: 'schedule' | 'plans'; expected: unknown }

export function userSchedulesTable<T extends Item>(opts: TableOptions<T>) {
  const plansOf = (userId: string) => opts.peekPlans?.(userId) ?? null

  function conditionalUpdate(patch: { schedule: T[]; plans?: unknown }, userId: string, filters: Filter[]) {
    const chain = {
      eq: (column: string, json: string) => {
        if (column !== 'schedule' && column !== 'plans') throw new Error(`compare on ${column}, not schedule or plans`)
        return conditionalUpdate(patch, userId, [...filters, { column, expected: JSON.parse(json) }])
      },
      is: (column: string, value: null) => {
        if (column !== 'plans' || value !== null) throw new Error(`is(${column}, ${value}) is not a compare the sync makes`)
        return conditionalUpdate(patch, userId, [...filters, { column: 'plans', expected: null }])
      },
      select: async (_columns: string) => {
        opts.onCall?.('update')
        if (!filters.some(f => f.column === 'schedule')) throw new Error('an update must compare the schedule')
        // Measured against the live API on 2026-11-11 with read-only
        // requests: 13,623 encoded characters passed, 18,163 failed.
        const urlChars = filters.reduce((n, f) => n + (f.expected === null ? 0 : encodeURIComponent(JSON.stringify(f.expected)).length), 0)
        if (urlChars > URL_LIMIT) {
          return { data: null, error: { message: 'TypeError: fetch failed' }, status: 0 }
        }
        const current = opts.peek(userId)
        if (current === null) return { data: [], error: null, status: 200 }
        for (const f of filters) {
          const stored = f.column === 'schedule' ? current : plansOf(userId)
          if (canonical(stored) !== canonical(f.expected)) return { data: [], error: null, status: 200 }
        }
        const { error } = await opts.write({ user_id: userId, ...patch })
        return error ? { data: null, error, status: 500 } : { data: [{ user_id: userId }], error: null, status: 200 }
      },
    }
    return chain
  }

  return {
    select: (_columns: string) => ({
      eq: (_column: string, userId: string) => ({
        single: () => {
          opts.onCall?.('select')
          return opts.read(userId)
        },
      }),
    }),

    update: (patch: { schedule: T[]; plans?: unknown }) => ({
      eq: (column: string, userId: string) => {
        if (column !== 'user_id') throw new Error(`update filtered on ${column}, not user_id`)
        return conditionalUpdate(patch, userId, [])
      },
    }),

    insert: (row: Payload<T>) => ({
      select: async (_columns: string) => {
        opts.onCall?.('insert')
        if (opts.peek(row.user_id) !== null) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' }, status: 409 }
        }
        const { error } = await opts.write(row)
        return error ? { data: null, error, status: 500 } : { data: [{ user_id: row.user_id }], error: null, status: 201 }
      },
    }),

    upsert: async (row: Payload<T>, _opts?: unknown) => {
      opts.onCall?.('upsert')
      return opts.write(row)
    },
  }
}

/** A `supabase` whose only table is `user_schedules`. */
export function fakeSupabase<T extends Item>(opts: TableOptions<T>) {
  return {
    from: (table: string) => {
      if (table !== 'user_schedules') throw new Error(`unexpected table ${table}`)
      return userSchedulesTable(opts)
    },
    rpc: () => { throw new Error('the sync must not call an RPC') },
  }
}
