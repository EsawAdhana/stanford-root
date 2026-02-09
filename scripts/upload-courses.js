/**
 * Upload quarterly course JSON files into Supabase.
 *
 * Reads fall.json, winter.json, spring.json, summer.json from public/data/
 * and inserts each course as a row in the `courses` table.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=ey... node scripts/upload-courses.js
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

const BATCH_SIZE = 200
const QUARTERS = ['fall', 'winter', 'spring', 'summer']

function loadQuarter (quarter) {
  const filePath = resolve(__dirname, `../public/data/${quarter}.json`)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    const courses = Array.isArray(data) ? data : (data?.courses ?? [])
    return courses
  } catch {
    console.log(`  ${quarter}.json not found or empty, skipping`)
    return []
  }
}

async function main () {
  // Clear existing data
  console.log('Clearing existing course data...')
  const { error: deleteError } = await supabase
    .from('courses')
    .delete()
    .neq('id', 0)

  if (deleteError) {
    console.error('Error clearing table:', deleteError.message)
    process.exit(1)
  }

  // Build rows from all quarter files
  const rows = []

  for (const quarter of QUARTERS) {
    console.log(`Reading ${quarter}.json...`)
    const courses = loadQuarter(quarter)
    console.log(`  ${courses.length} courses`)

    for (const c of courses) {
      if (!c || !c.id) continue
      rows.push({
        course_id: c.id,
        quarter,
        subject: c.subject || '',
        code: c.code || '',
        title: c.title || '',
        description: c.description || '',
        units: c.units || '',
        grading: c.grading || '',
        instructors: c.instructors || [],
        terms: c.terms || [],
        dept: c.dept || null,
        sections: c.sections || []
      })
    }
  }

  console.log(`\nPrepared ${rows.length} total course rows`)

  // Insert in batches (courses have large sections JSONB, so smaller batches)
  let uploaded = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('courses')
      .insert(batch)

    if (error) {
      console.error(`\nError at batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message)
      process.exit(1)
    }

    uploaded += batch.length
    const pct = ((uploaded / rows.length) * 100).toFixed(1)
    process.stdout.write(`\r  Uploaded ${uploaded}/${rows.length} (${pct}%)`)
  }

  console.log(`\nDone! Uploaded ${uploaded} course rows across ${QUARTERS.length} quarters.`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
