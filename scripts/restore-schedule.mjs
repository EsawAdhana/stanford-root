/**
 * Lists and restores earlier versions of one student's saved schedule from
 * public.user_schedule_history (migration 20261111_user_schedule_history.sql).
 *
 *   node --env-file=.env.local scripts/restore-schedule.mjs <user-id>               # list versions
 *   node --env-file=.env.local scripts/restore-schedule.mjs <user-id> --show <id>   # compare one with the saved row
 *   node --env-file=.env.local scripts/restore-schedule.mjs <user-id> --apply <id>  # write it back (asks first)
 *   ... --apply <id> --yes                                                          # write it back without asking
 *
 * Nothing is written unless --apply is given and confirmed. Writing back goes
 * through the same trigger as a browser save, so the row it replaces is kept in
 * the history too and a restore can itself be undone. The write only lands if
 * the saved row has not changed since the script read it.
 *
 * It prints course ids, sections and timestamps only: no emails or names.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * A student with the site open in a tab that still holds the bad cart can push
 * it again after a restore. Check updated_at a little later.
 */
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseArgs(argv) {
  const args = { userId: null, show: null, apply: null, yes: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes') args.yes = true
    else if (a === '--show' || a === '--apply') {
      const v = argv[++i]
      if (!/^\d+$/.test(v ?? '')) throw new Error(`${a} needs a version id (a whole number from the list)`)
      args[a.slice(2)] = Number(v)
    } else if (!a.startsWith('-') && args.userId === null) args.userId = a
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (!args.userId || !UUID.test(args.userId)) throw new Error('First argument must be the user id (a uuid)')
  if (args.show !== null && args.apply !== null) throw new Error('Use --show or --apply, not both')
  if (args.yes && args.apply === null) throw new Error('--yes only goes with --apply')
  return args
}

function courseCount(schedule) {
  return Array.isArray(schedule) ? schedule.length : 0
}

function describeItem(item) {
  const parts = [item?.id ?? '(no id)']
  if (item?.selectedTerm) parts.push(item.selectedTerm)
  const sections = item?.selectedSectionIds ?? (item?.selectedSectionId != null ? [item.selectedSectionId] : null)
  if (sections?.length) parts.push(`sections ${sections.join(',')}`)
  if (item?.selectedUnits != null) parts.push(`${item.selectedUnits} units`)
  return parts.join('  ')
}

/** Lines comparing a history version with the current row, by course id. */
export function diffLines(version, current) {
  const lines = []
  const from = Array.isArray(current?.schedule) ? current.schedule : []
  const to = Array.isArray(version?.schedule) ? version.schedule : []
  const byId = list => new Map(list.map(item => [item?.id, item]))
  const fromIds = byId(from)
  const toIds = byId(to)

  for (const item of to) {
    if (!fromIds.has(item?.id)) lines.push(`+ ${describeItem(item)}`)
    else if (JSON.stringify(fromIds.get(item?.id)) !== JSON.stringify(item)) {
      lines.push(`~ ${describeItem(item)}   (now: ${describeItem(fromIds.get(item?.id))})`)
    }
  }
  for (const item of from) {
    if (!toIds.has(item?.id)) lines.push(`- ${describeItem(item)}`)
  }
  for (const key of ['plans', 'ignored_exam_clashes']) {
    const a = JSON.stringify(current?.[key] ?? null)
    const b = JSON.stringify(version?.[key] ?? null)
    if (a !== b) lines.push(`~ ${key}: ${a} -> ${b}`)
  }
  return lines
}

export function makeClient({ url, key, fetchImpl = fetch }) {
  const base = `${url.replace(/\/$/, '')}/rest/v1`
  async function call(method, path, body, prefer) {
    const res = await fetchImpl(`${base}/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} failed: ${res.status} ${text}`)
    return text ? JSON.parse(text) : null
  }
  const eq = v => `eq.${encodeURIComponent(v)}`
  return {
    versions: userId =>
      call('GET', `user_schedule_history?select=id,saved_at,reason,schedule,plans,ignored_exam_clashes&user_id=${eq(userId)}&order=saved_at.desc,id.desc`),
    version: async (userId, id) =>
      (await call('GET', `user_schedule_history?select=id,saved_at,reason,schedule,plans,ignored_exam_clashes&user_id=${eq(userId)}&id=${eq(id)}`))[0] ?? null,
    current: async userId =>
      (await call('GET', `user_schedules?select=updated_at,schedule,plans,ignored_exam_clashes&user_id=${eq(userId)}`))[0] ?? null,
    /** Writes the version back only if the row still has the updated_at we read. */
    writeBack: async (userId, version, current) => {
      const fields = {
        schedule: version.schedule ?? [],
        plans: version.plans ?? null,
        ignored_exam_clashes: version.ignored_exam_clashes ?? null,
      }
      if (current) {
        const rows = await call(
          'PATCH',
          `user_schedules?user_id=${eq(userId)}&updated_at=${eq(current.updated_at)}`,
          fields,
          'return=representation',
        )
        return rows.length
      }
      const rows = await call('POST', 'user_schedules', { user_id: userId, ...fields }, 'return=representation')
      return rows.length
    },
  }
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, out?: (line: string) => void, ask?: (question: string) => Promise<string>, fetchImpl?: Function }} [options]
 */
export async function main(argv, { env = process.env, out = console.log, ask, fetchImpl } = {}) {
  const args = parseArgs(argv)
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const db = makeClient({ url, key, fetchImpl })
  const current = await db.current(args.userId)

  if (args.show === null && args.apply === null) {
    out(current ? `Saved now: ${courseCount(current.schedule)} courses, updated ${current.updated_at}` : 'Saved now: no row')
    const versions = await db.versions(args.userId)
    if (versions.length === 0) {
      out('No earlier versions.')
      return 0
    }
    out('')
    out('id        saved at (UTC)                  reason   courses')
    for (const v of versions) {
      out(`${String(v.id).padEnd(9)} ${String(v.saved_at).padEnd(31)} ${v.reason.padEnd(8)} ${courseCount(v.schedule)}`)
    }
    out('')
    out('Compare one with --show <id>, restore it with --apply <id>.')
    return 0
  }

  const id = args.show ?? args.apply
  const version = await db.version(args.userId, id)
  if (!version) throw new Error(`No version ${id} for this user`)
  out(`Version ${version.id}: ${courseCount(version.schedule)} courses, saved ${version.saved_at} (${version.reason})`)
  out(current ? `Saved now: ${courseCount(current.schedule)} courses, updated ${current.updated_at}` : 'Saved now: no row')
  const lines = diffLines(version, current)
  out('')
  out(lines.length ? 'Restoring it would make these changes (+ add, - remove, ~ change):' : 'It is the same as the saved row.')
  for (const line of lines) out(`  ${line}`)

  if (args.apply === null) return 0
  if (lines.length === 0) {
    out('Nothing to write.')
    return 0
  }

  if (!args.yes) {
    const answer = (await ask(`\nType "restore ${version.id}" to write this version back: `)).trim()
    if (answer !== `restore ${version.id}`) {
      out('Not confirmed. Nothing was written.')
      return 1
    }
  }

  const written = await db.writeBack(args.userId, version, current)
  if (written !== 1) {
    out('The saved row changed after it was read. Nothing was written; run the command again.')
    return 1
  }
  out(`Restored version ${version.id}. The row it replaced is now in the history too.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  main(process.argv.slice(2), { ask: q => rl.question(q) })
    .then(code => {
      rl.close()
      process.exit(code)
    })
    .catch(err => {
      rl.close()
      console.error(err.message)
      process.exit(2)
    })
}
