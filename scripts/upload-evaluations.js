/**
 * Upload evaluations.json into Supabase
 *
 * Prerequisites:
 *   1. Create the `evaluations` table in Supabase (see SQL in README)
 *   2. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=ey... node scripts/upload-evaluations.js
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BATCH_SIZE = 500

async function main () {
  const filePath = resolve(__dirname, '../public/data/evaluations.json')
  console.log(`Reading ${filePath}...`)

  const raw = readFileSync(filePath, 'utf-8')
  const data = JSON.parse(raw)

  const courseIds = Object.keys(data)
  console.log(`Found ${courseIds.length} courses`)

  // Build flat rows
  const rows = []
  for (const courseId of courseIds) {
    const evals = data[courseId]
    for (const evaluation of evals) {
      rows.push({
        course_id: courseId,
        term: evaluation.term,
        instructor: evaluation.instructor,
        course_code: evaluation.courseCode,
        respondents: evaluation.respondents,
        questions: evaluation.questions,
        comments: evaluation.comments
      })
    }
  }

  console.log(`Prepared ${rows.length} evaluation rows`)

  // Clear existing data first (full refresh)
  console.log('Clearing existing data...')
  const { error: deleteError } = await supabase
    .from('evaluations')
    .delete()
    .neq('id', 0) // deletes all rows (Supabase requires a filter)

  if (deleteError) {
    console.error('Error clearing table:', deleteError.message)
    process.exit(1)
  }

  // Insert in batches
  let uploaded = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('evaluations')
      .insert(batch)

    if (error) {
      console.error(`\nError at batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message)
      process.exit(1)
    }

    uploaded += batch.length
    const pct = ((uploaded / rows.length) * 100).toFixed(1)
    process.stdout.write(`\r  Uploaded ${uploaded}/${rows.length} (${pct}%)`)
  }

  console.log(`\nDone! Uploaded ${uploaded} evaluation rows for ${courseIds.length} courses.`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
