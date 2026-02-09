#!/usr/bin/env node

/**
 * Split the monolithic evaluations.json into per-course JSON files.
 *
 * Input:  public/data/evaluations.json  (~92 MB, keyed by courseId)
 * Output: public/data/evals/{courseId}.json  (one file per course)
 *
 * Also cleans term names that have the department concatenated, e.g.
 *   "Summer 2024Computer Science" -> "Summer 2024"
 */

const fs = require('fs')
const path = require('path')

const INPUT = path.join(__dirname, '..', 'public', 'data', 'evaluations.json')
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'evals')

// Extract "Season Year" from strings like "Summer 2024Computer Science"
function cleanTerm(raw) {
  const match = raw.match(/^((?:Winter|Spring|Summer|Autumn|Fall)\s+\d{4})/)
  return match ? match[1] : raw
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Input file not found:', INPUT)
    process.exit(1)
  }

  console.log('Reading evaluations.json ...')
  const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const courseIds = Object.keys(data)
  console.log(`Found ${courseIds.length} courses`)

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  let written = 0

  for (const courseId of courseIds) {
    const evals = data[courseId]
    if (!Array.isArray(evals) || evals.length === 0) continue

    // Clean term names on every evaluation
    const cleaned = evals.map(ev => ({
      ...ev,
      term: cleanTerm(ev.term)
    }))

    // Use courseId directly as filename (safe for filesystem since IDs are alphanumeric)
    const outPath = path.join(OUTPUT_DIR, `${courseId}.json`)
    fs.writeFileSync(outPath, JSON.stringify(cleaned))
    written++
  }

  console.log(`Wrote ${written} per-course files to ${OUTPUT_DIR}`)
}

main()
