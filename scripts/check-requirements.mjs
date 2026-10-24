/**
 * Bundles scripts/requirements/check.ts (it imports the audit engine from
 * src/, which is TypeScript) and runs it. Each run bundles to its own temp
 * file, so several can run at once. Usage is in check.ts.
 */
import { build } from 'esbuild'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(tmpdir(), `check-requirements-${process.pid}-${Date.now()}.mjs`)
await build({
  entryPoints: [join(root, 'scripts', 'requirements', 'check.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: join(root, 'tsconfig.json'),
})
try {
  const { main } = await import(pathToFileURL(outfile).href)
  await main(process.argv.slice(2), root)
} finally {
  rmSync(outfile, { force: true })
}
