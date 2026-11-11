/**
 * Applies supabase/migrations/20261111_user_schedule_history.sql to an embedded
 * Postgres (PGlite) set up like Supabase: the anon, authenticated and service_role
 * roles, a stub auth schema with auth.users and auth.uid(), and user_schedules
 * rebuilt from its original definition (git show 73bbf59d:scripts/supabase-user-schedules.sql)
 * with today's columns (schedule, plans, ignored_exam_clashes) in place of the
 * old ciphertext and iv.
 *
 * PGlite is not a dependency of this repo. Install it once outside the repo:
 *   npm install --prefix "$TMPDIR/pglite" @electric-sql/pglite
 * or point PGLITE_MODULE at its dist/index.js. Without it these tests are skipped.
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PGLITE_MODULE =
  process.env.PGLITE_MODULE ??
  path.join(os.tmpdir(), 'pglite/node_modules/@electric-sql/pglite/dist/index.js')
const HAVE_PGLITE = existsSync(PGLITE_MODULE)

const MIGRATION = readFileSync(
  path.join(__dirname, '../supabase/migrations/20261111_user_schedule_history.sql'),
  'utf8',
)

type Row = Record<string, unknown>
type Notice = { message?: string }
interface Tx {
  query<T = Row>(sql: string, params?: unknown[], opts?: { onNotice?: (n: Notice) => void }): Promise<{ rows: T[] }>
  exec(sql: string): Promise<unknown>
}
interface Db extends Tx {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  close(): Promise<void>
}

const SUPABASE_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  -- Supabase's "postgres" role owns the tables but is not a superuser.
  create role app_owner nologin nosuperuser;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role, app_owner;
  grant references, select on auth.users to app_owner;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage, create on schema public to app_owner;
`

const USER_SCHEDULES = `
  set role app_owner;

  create table if not exists public.user_schedules (
    user_id uuid primary key references auth.users(id) on delete cascade,
    schedule jsonb not null default '[]'::jsonb,
    plans jsonb,
    ignored_exam_clashes jsonb,
    updated_at timestamptz not null default now()
  );

  alter table public.user_schedules enable row level security;

  create policy "Users can select own schedule" on public.user_schedules
    for select to authenticated using (auth.uid() = user_id);
  create policy "Users can insert own schedule" on public.user_schedules
    for insert to authenticated with check (auth.uid() = user_id);
  create policy "Users can update own schedule" on public.user_schedules
    for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

  create or replace function public.set_updated_at()
  returns trigger language plpgsql as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;

  create trigger user_schedules_updated_at
    before update on public.user_schedules
    for each row execute function public.set_updated_at();

  grant select, insert, update on public.user_schedules to authenticated;
  grant select, insert, update, delete on public.user_schedules to service_role;

  reset role;
`

let n = 0
function newUserId(): string {
  n += 1
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const course = (id: string) => ({ id, sections: [] })

describe.skipIf(!HAVE_PGLITE)('user_schedule_history migration', () => {
  let db: Db

  beforeAll(async () => {
    const mod = await import(pathToFileURL(PGLITE_MODULE).href)
    db = (await mod.PGlite.create()) as Db
    await db.exec(SUPABASE_STUB)
    await db.exec(USER_SCHEDULES)
    await db.exec(`set role app_owner;\n${MIGRATION}\nreset role;`)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  /** Runs fn as a database role, with auth.uid() returning sub, like a PostgREST request. */
  async function as<T>(role: string, sub: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      await tx.exec(`set local role ${role}`)
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? ''])
      return fn(tx)
    })
  }

  async function addUser(schedule: unknown[] | Row | null = []): Promise<string> {
    const id = newUserId()
    await db.query('insert into auth.users (id) values ($1)', [id])
    await db.query('insert into public.user_schedules (user_id, schedule) values ($1, $2)', [
      id,
      schedule === null ? null : JSON.stringify(schedule),
    ])
    return id
  }

  /** What supabase-js .upsert({ user_id, schedule }, { onConflict: 'user_id' }) sends. */
  async function browserUpsert(userId: string, schedule: unknown, asUser = userId) {
    return as('authenticated', asUser, tx =>
      tx.query(
        `insert into public.user_schedules (user_id, schedule) values ($1, $2)
         on conflict (user_id) do update set schedule = excluded.schedule
         returning user_id`,
        [userId, JSON.stringify(schedule)],
      ),
    )
  }

  async function history(userId: string) {
    const { rows } = await db.query<{ reason: string; schedule: unknown; plans: unknown; ignored_exam_clashes: unknown }>(
      'select reason, schedule, plans, ignored_exam_clashes from public.user_schedule_history where user_id = $1 order by id',
      [userId],
    )
    return rows
  }

  async function current(userId: string) {
    const { rows } = await db.query<{ schedule: unknown }>('select schedule from public.user_schedules where user_id = $1', [userId])
    return rows[0]?.schedule
  }

  it('keeps the old schedule when a browser upsert empties the row', async () => {
    const six = ['CS106A', 'CS106B', 'MATH51', 'PHYSICS41', 'PWR1', 'THINK1'].map(course)
    const u = await addUser(six)
    await browserUpsert(u, [])
    expect(await current(u)).toEqual([])
    expect(await history(u)).toEqual([{ reason: 'update', schedule: six, plans: null, ignored_exam_clashes: null }])
  })

  it('writes nothing when an upsert sends the same schedule (only updated_at moves)', async () => {
    const u = await addUser([course('CS106A')])
    const before = await db.query<{ updated_at: string }>('select updated_at::text as updated_at from public.user_schedules where user_id = $1', [u])
    await new Promise(r => setTimeout(r, 5))
    await browserUpsert(u, [course('CS106A')])
    const after = await db.query<{ updated_at: string }>('select updated_at::text as updated_at from public.user_schedules where user_id = $1', [u])
    expect(after.rows[0].updated_at).not.toBe(before.rows[0].updated_at)
    expect(await history(u)).toEqual([])
  })

  it('treats a reordered schedule as a change and keeps the old order (jsonb arrays compare by order)', async () => {
    const u = await addUser([course('A'), course('B')])
    await browserUpsert(u, [course('B'), course('A')])
    expect(await history(u)).toEqual([{ reason: 'update', schedule: [course('A'), course('B')], plans: null, ignored_exam_clashes: null }])
  })

  it('keeps a version when only plans or ignored_exam_clashes change', async () => {
    const u = await addUser([course('A')])
    await db.query(`update public.user_schedules set plans = '{"b": []}' where user_id = $1`, [u])
    await db.query(`update public.user_schedules set ignored_exam_clashes = '["x"]' where user_id = $1`, [u])
    const rows = await history(u)
    expect(rows.map(r => [r.plans, r.ignored_exam_clashes])).toEqual([
      [null, null],
      [{ b: [] }, null],
    ])
  })

  it('does not log a row that was already empty, or a brand new row', async () => {
    const u = await addUser([])
    await browserUpsert(u, [course('A')])
    expect(await history(u)).toEqual([])

    const fresh = newUserId()
    await db.query('insert into auth.users (id) values ($1)', [fresh])
    await browserUpsert(fresh, [course('A')])
    expect(await history(fresh)).toEqual([])
  })

  it('still saves when the old schedule is not an array, and logs nothing for it', async () => {
    const u = await addUser({ not: 'an array' })
    await browserUpsert(u, [course('A')])
    expect(await current(u)).toEqual([course('A')])
    expect(await history(u)).toEqual([])
  })

  it('keeps every row of a multi-row update', async () => {
    const a = await addUser([course('A')])
    const b = await addUser([course('B')])
    await db.query(`update public.user_schedules set schedule = '[]' where user_id in ($1, $2)`, [a, b])
    expect((await history(a)).map(r => r.schedule)).toEqual([[course('A')]])
    expect((await history(b)).map(r => r.schedule)).toEqual([[course('B')]])
  })

  it('keeps the row on delete, and the delete still succeeds', async () => {
    const u = await addUser([course('A')])
    const { rows } = await as('service_role', null, tx =>
      tx.query('delete from public.user_schedules where user_id = $1 returning user_id', [u]),
    )
    expect(rows).toHaveLength(1)
    expect(await current(u)).toBeUndefined()
    expect(await history(u)).toEqual([{ reason: 'delete', schedule: [course('A')], plans: null, ignored_exam_clashes: null }])
  })

  it('lets an account be deleted, and leaves no history behind for it', async () => {
    const u = await addUser([course('A')])
    await browserUpsert(u, [course('B')])
    expect(await history(u)).toHaveLength(1)
    await db.query('delete from auth.users where id = $1', [u], { onNotice: () => {} })
    expect(await current(u)).toBeUndefined()
    expect(await history(u)).toEqual([])
  })

  it('lets the authenticated role upsert its own row with RLS on, and not someone else\'s', async () => {
    const me = await addUser([course('A')])
    const other = await addUser([course('Z')])
    const { rows } = await browserUpsert(me, [course('A'), course('B')])
    expect(rows).toHaveLength(1)
    expect(await current(me)).toEqual([course('A'), course('B')])

    await expect(browserUpsert(other, [], me)).rejects.toThrow(/row-level security/)
    expect(await current(other)).toEqual([course('Z')])
    expect(await history(other)).toEqual([])
  })

  it('hides the history table from anon and authenticated, and gives service_role read and delete', async () => {
    const u = await addUser([course('A')])
    await browserUpsert(u, [])
    for (const role of ['anon', 'authenticated']) {
      await expect(as(role, u, tx => tx.query('select * from public.user_schedule_history'))).rejects.toThrow(/permission denied/)
      await expect(
        as(role, u, tx => tx.query(`insert into public.user_schedule_history (user_id, reason) values ($1, 'update')`, [u])),
      ).rejects.toThrow(/permission denied/)
      await expect(as(role, u, tx => tx.query('delete from public.user_schedule_history'))).rejects.toThrow(/permission denied/)
      await expect(as(role, u, tx => tx.query('select public.prune_user_schedule_history()'))).rejects.toThrow(/permission denied/)
    }
    const { rows } = await as('service_role', null, tx =>
      tx.query('select schedule from public.user_schedule_history where user_id = $1', [u]),
    )
    expect(rows).toEqual([{ schedule: [course('A')] }])
    await expect(as('service_role', null, tx => tx.query('update public.user_schedule_history set reason = reason'))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('retention keeps a 60-day-old version and removes a 100-day-old one', async () => {
    const u = await addUser([course('A')])
    await db.query(
      `insert into public.user_schedule_history (user_id, saved_at, reason, schedule) values
         ($1, now() - interval '60 days', 'update', '["sixty"]'),
         ($1, now() - interval '100 days', 'update', '["hundred"]'),
         ($1, now() - interval '89 days 23 hours', 'update', '["just-inside"]'),
         ($1, now() - interval '90 days 1 hour', 'update', '["just-outside"]')`,
      [u],
    )
    await as('service_role', null, tx => tx.query('select public.prune_user_schedule_history()'))
    const { rows } = await db.query<{ schedule: string[] }>(
      'select schedule from public.user_schedule_history where user_id = $1 order by saved_at desc',
      [u],
    )
    expect(rows.map(r => r.schedule[0])).toEqual(['sixty', 'just-inside'])
  })

  it('is safe to apply twice', async () => {
    await db.exec(`set role app_owner;\n${MIGRATION}\nreset role;`)
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from pg_trigger where tgname = 'user_schedules_history'`,
    )
    expect(rows[0].count).toBe(1)
    const u = await addUser([course('A')])
    await browserUpsert(u, [])
    expect(await history(u)).toHaveLength(1)
  })

  // Last, because it breaks the history table on purpose.
  it('never makes a save fail when writing history fails', async () => {
    const u = await addUser([course('A')])
    await db.exec(
      'alter table public.user_schedule_history add constraint always_fails check (false) not valid',
    )
    try {
      const notices: string[] = []
      const { rows } = await as('authenticated', u, tx =>
        tx.query(
          `insert into public.user_schedules (user_id, schedule) values ($1, '[]')
           on conflict (user_id) do update set schedule = excluded.schedule returning user_id`,
          [u],
          { onNotice: m => notices.push(String(m.message)) },
        ),
      )
      expect(rows).toHaveLength(1)
      expect(await current(u)).toEqual([])
      expect(await history(u)).toEqual([])
      expect(notices.join('\n')).toMatch(/user_schedule_history: could not save/)

      // A delete goes through too.
      const v = await addUser([course('B')])
      await db.query('delete from public.user_schedules where user_id = $1', [v], { onNotice: () => {} })
      expect(await current(v)).toBeUndefined()
    } finally {
      await db.exec('alter table public.user_schedule_history drop constraint always_fails')
    }
  })
})

describe.skipIf(HAVE_PGLITE)('user_schedule_history migration (PGlite missing)', () => {
  it.skip(`install PGlite at ${PGLITE_MODULE} to run these tests`, () => {})
})
