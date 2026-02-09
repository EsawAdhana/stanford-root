#!/usr/bin/env node

/**
 * Stanford Course Evaluation Scraper
 *
 * Fully headless approach — Puppeteer is used ONLY for login:
 *   - Puppeteer: login (handles Stanford 2FA/SSO), then steals session cookies
 *   - HTTP + Cheerio: search, pagination, AND report data extraction
 *
 * Search uses the /AppApi/Report/PublicReport pagination endpoint.
 * Reports are fetched from /Reports/StudentReport.aspx via direct HTTP.
 * Both run with high parallelism (~20 concurrent requests) for maximum speed.
 *
 * Usage:
 *   node scripts/scrape-evaluations.js [--resume] [--limit N] [--course "CS 106A"]
 *
 * Options:
 *   --resume        Resume from where a previous run left off (uses progress file)
 *   --limit N       Only scrape the first N courses (useful for testing)
 *   --course X      Scrape a single course by code, e.g. "CS 106A"
 *   --find-missing  Identify which evaluations are missing (no extraction, just lists them)
 *   --retry-missing Search by individual course code to find & extract only what's missing
 *   --concurrency N Number of parallel HTTP requests (default: 20)
 *   --workers N     Number of parallel term searches (default: 5, use 2 for resume)
 */

const puppeteer = require('puppeteer')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')

const BASE_URL = 'https://stanford.evaluationkit.com'
const SEARCH_URL = `${BASE_URL}/Report/Public/Results`
// Note: the report popup URL uses /Reports/ (with 's'), NOT /Report/Public/
const REPORT_URL = `${BASE_URL}/Reports/StudentReport.aspx`
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'data', 'evaluations.json')
const PROGRESS_FILE = path.join(__dirname, '..', '.eval-scrape-progress.json')

// Delay between requests to avoid rate limiting (ms)
const REQUEST_DELAY = 300
// Delay between search pages
const SEARCH_DELAY = 500
// Number of parallel report extractions (adjustable via --concurrency flag)
// HTTP fetches are lightweight, so we can safely run many more in parallel
const DEFAULT_CONCURRENCY = 20

// Recent academic terms to scrape (Fall 2023 onward)
const RECENT_TERMS = [
  { code: 'F23', label: 'Fall 2023' },
  { code: 'W24', label: 'Winter 2024' },
  { code: 'Sp24', label: 'Spring 2024' },
  { code: 'Su24', label: 'Summer 2024' },
  { code: 'F24', label: 'Fall 2024' },
  { code: 'W25', label: 'Winter 2025' },
  { code: 'Sp25', label: 'Spring 2025' },
  { code: 'Su25', label: 'Summer 2025' },
  { code: 'F25', label: 'Fall 2025' },
]

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { resume: false, limit: null, course: null, concurrency: DEFAULT_CONCURRENCY, workers: null, findMissing: false, retryMissing: false }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume') opts.resume = true
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[i + 1], 10)
    if (args[i] === '--course' && args[i + 1]) opts.course = args[i + 1]
    if (args[i] === '--concurrency' && args[i + 1]) opts.concurrency = parseInt(args[i + 1], 10)
    if (args[i] === '--workers' && args[i + 1]) opts.workers = parseInt(args[i + 1], 10)
    if (args[i] === '--find-missing') opts.findMissing = true
    if (args[i] === '--retry-missing') opts.retryMissing = true
  }

  return opts
}

/**
 * Extract the last name from a full name string.
 * "Percy Liang" -> "Liang", "Mary Teruel" -> "Teruel"
 */
function getLastName(fullName) {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] || ''
}

/**
 * Check if a term string like "Fall 2023" or "Winter 2024" is recent enough.
 * Only includes Fall 2023 and later (i.e., the 2023-24 academic year onward).
 */
function isTermRecent(termString) {
  const match = termString.match(/(fall|winter|spring|summer|autumn)\s+(\d{4})/i)
  if (!match) return true // Can't parse → include to be safe
  const season = match[1].toLowerCase()
  const year = parseInt(match[2], 10)
  if (year > 2023) return true
  if (year < 2023) return false
  // year === 2023: only Fall/Autumn quarter
  return season === 'fall' || season === 'autumn'
}

/**
 * Load course codes from the quarter JSON files or courses.json.
 * Also collects instructor names for smarter search queries.
 */
function loadCourseCodes() {
  const dataDir = path.join(__dirname, '..', 'public', 'data')
  const quarterFiles = ['fall.json', 'winter.json', 'spring.json', 'summer.json']
  const seen = new Set()
  const codes = []

  function processCourses(courses) {
    for (const c of courses) {
      if (!c || !c.subject || !c.code) continue
      const key = `${c.subject} ${c.code}`
      if (!seen.has(key)) {
        seen.add(key)
        // Collect unique instructor last names for this course
        const instructorLastNames = []
        if (c.instructors && Array.isArray(c.instructors)) {
          for (const name of c.instructors) {
            const last = getLastName(name)
            if (last && !instructorLastNames.includes(last)) {
              instructorLastNames.push(last)
            }
          }
        }
        // Also collect from section meeting instructors
        if (c.sections && Array.isArray(c.sections)) {
          for (const section of c.sections) {
            if (!section.meetings) continue
            for (const meeting of section.meetings) {
              if (!meeting.instructors) continue
              for (const name of meeting.instructors) {
                const last = getLastName(name)
                if (last && !instructorLastNames.includes(last)) {
                  instructorLastNames.push(last)
                }
              }
            }
          }
        }
        codes.push({
          subject: c.subject,
          code: c.code,
          id: c.id || key,
          instructorLastNames
        })
      }
    }
  }

  for (const file of quarterFiles) {
    const filepath = path.join(dataDir, file)
    if (!fs.existsSync(filepath)) continue

    try {
      const raw = fs.readFileSync(filepath, 'utf-8')
      const data = JSON.parse(raw)
      const courses = Array.isArray(data) ? data : (data?.courses ?? [])
      processCourses(courses)
    } catch (err) {
      console.warn(`Warning: Could not parse ${file}: ${err.message}`)
    }
  }

  // Fallback to courses.json if no quarter files found
  if (codes.length === 0) {
    const fallback = path.join(dataDir, 'courses.json')
    if (fs.existsSync(fallback)) {
      console.log('Using fallback courses.json...')
      const raw = fs.readFileSync(fallback, 'utf-8')
      const data = JSON.parse(raw)
      const courses = Array.isArray(data) ? data : (data?.courses ?? [])
      processCourses(courses)
    }
  }

  return codes
}

/**
 * Load existing evaluations and progress
 */
function loadProgress() {
  const evaluations = {}
  const completed = new Set()

  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
      Object.assign(evaluations, data)
    } catch (err) {
      console.warn('Warning: Could not parse existing evaluations file')
    }
  }

  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
      if (data.completed) {
        for (const c of data.completed) completed.add(c)
      }
    } catch (err) {
      console.warn('Warning: Could not parse progress file')
    }
  }

  return { evaluations, completed }
}

/**
 * Save evaluations and progress
 */
function saveProgress(evaluations, completed) {
  // Use compact JSON for evaluations (can be 100MB+ with pretty-print)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(evaluations))
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    completed: Array.from(completed),
    lastUpdated: new Date().toISOString()
  }))
}

/**
 * Parse the hdnReportData JSON from a report page into our simplified format
 */
function parseReportData(rawQuestions, pageMetadata) {
  const questions = []
  let comments = []

  for (const q of rawQuestions) {
    const questionText = (q.QuestionText || '').replace(/All comments are subject to.*$/, '').trim()

    // QuestionType 1 = open-ended text, QuestionType 3 = Likert scale, QuestionType 5 = numeric entry
    if (q.QuestionType === 1) {
      // Open-ended comments
      if (q.AnswerText) {
        comments = q.AnswerText
          .split('||')
          .map(c => c.trim())
          .filter(c => c.length > 0)
      }
      continue
    }

    const options = (q.Options || [])
      .filter(o => o.OptionText !== '')
      .map(o => ({
        text: o.OptionText,
        weight: o.OptionWeight,
        count: o.Frequency,
        pct: o.Percentage
      }))

    const type = q.QuestionType === 3 ? 'rating' : 'numeric'

    questions.push({
      text: questionText,
      type,
      mean: parseFloat(q.Mean) || 0,
      median: parseFloat(q.Meadian) || 0, // Note: typo in original data ("Meadian")
      std: parseFloat(q.STD) || 0,
      responseRate: q.ResponseRate || '',
      options
    })
  }

  return {
    term: pageMetadata.term || '',
    instructor: pageMetadata.instructor || '',
    courseCode: pageMetadata.courseCode || '',
    respondents: pageMetadata.respondents || '',
    questions,
    comments
  }
}

/**
 * Parse search results from an HTML string using cheerio.
 * Works for both the initial full page and the "Show More" API responses,
 * since both contain the same .sr-dataitem elements.
 */
function parseSearchResultsHTML(html) {
  const $ = cheerio.load(html)
  const results = []

  $('.sr-dataitem').each((i, item) => {
    const $item = $(item)
    const viewBtn = $item.find('.sr-view-report')
    if (!viewBtn.length) return

    const id0 = viewBtn.attr('data-id0')
    const id1 = viewBtn.attr('data-id1')
    const id2 = viewBtn.attr('data-id2')
    const id3 = viewBtn.attr('data-id3')
    if (!id0 || !id1 || !id2 || !id3) return

    let term = ''
    const termEl = $item.find('.small').first()
    if (termEl.length) {
      const lines = termEl.text().trim().split('\n').map(l => l.trim()).filter(Boolean)
      term = lines[0] || ''
    }

    results.push({
      reportUrl: `${id0},${id1},${id2},${id3}`,
      courseCode: $item.find('.sr-dataitem-info-code').text().trim(),
      title: $item.find('h2').text().trim(),
      instructor: $item.find('.sr-dataitem-info-instr').text().trim(),
      term,
      respondents: $item.find('.sr-avg .small span').first().text().trim()
    })
  })

  return results
}

/**
 * Search for courses and extract report links entirely via HTTP (no browser needed).
 * Page 1: fetches the full search results HTML page.
 * Page 2+: uses the /AppApi/Report/PublicReport pagination endpoint.
 *
 * The API may return raw HTML fragments OR JSON wrapping HTML (common with
 * ASP.NET Web API endpoints). We try both parsing strategies.
 */
async function searchCourseHTTP(courseQuery, cookieString, instructorQuery = '') {
  const allReports = []

  // Page 1: fetch the initial search results page (full HTML)
  // Matches the browser URL pattern exactly (no Sort param — server uses default)
  const searchUrl = `${SEARCH_URL}?Course=${encodeURIComponent(courseQuery)}&Instructor=${encodeURIComponent(instructorQuery)}&Search=true`

  const initialResponse = await fetch(searchUrl, {
    headers: getHTTPHeaders(cookieString)
  })

  if (!initialResponse.ok) {
    console.warn(`  Search returned HTTP ${initialResponse.status}`)
    return []
  }

  const initialHTML = await initialResponse.text()
  const firstBatch = parseSearchResultsHTML(initialHTML)
  allReports.push(...firstBatch)
  console.log(`    Page 1: ${firstBatch.length} results`)

  if (firstBatch.length === 0) return allReports

  // Page 2+: paginate using the lightweight API endpoint
  // URL pattern matches exactly what the "Show More" button fires:
  //   /AppApi/Report/PublicReport?Course=f23&Instructor=&Search=true&page=2&_=timestamp
  let page = 2
  let consecutiveEmpty = 0
  while (true) {
    const apiUrl = `${BASE_URL}/AppApi/Report/PublicReport?Course=${encodeURIComponent(courseQuery)}&Instructor=${encodeURIComponent(instructorQuery)}&Search=true&page=${page}&_=${Date.now()}`

    // Retry up to 3 times on HTTP errors (server gets overwhelmed during parallel searches)
    let response
    let retries = 0
    const MAX_RETRIES = 3
    while (retries <= MAX_RETRIES) {
      response = await fetch(apiUrl, {
        headers: {
          ...getHTTPHeaders(cookieString),
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': '*/*'
        }
      })

      if (response.ok) break

      retries++
      if (retries > MAX_RETRIES) {
        console.log(`    Page ${page}: HTTP ${response.status} after ${MAX_RETRIES} retries — stopping pagination`)
        break
      }
      // Exponential backoff: 1s, 2s, 4s
      const backoff = 1000 * Math.pow(2, retries - 1)
      await sleep(backoff)
    }

    if (!response.ok) break

    const rawData = await response.text()

    // The API returns JSON: { "hasMore": bool, "results": ["<li>...</li>", ...] }
    // Each element in "results" is an HTML string for one course row.
    let reports = []
    try {
      const json = JSON.parse(rawData)

      if (json.results && Array.isArray(json.results)) {
        // Join all HTML fragments into one string and parse with cheerio
        const combinedHTML = json.results.join('')
        reports = parseSearchResultsHTML(combinedHTML)

        // Use the server's hasMore flag to know if we should keep going
        if (!json.hasMore && reports.length > 0) {
          allReports.push(...reports)
          console.log(`    Page ${page}: +${reports.length} results (${allReports.length} total) [last page]`)
          break
        }
      } else if (typeof json === 'string') {
        reports = parseSearchResultsHTML(json)
      } else {
        // Unknown JSON structure — try treating entire response as HTML
        reports = parseSearchResultsHTML(rawData)
      }
    } catch {
      // Not JSON — treat as raw HTML
      reports = parseSearchResultsHTML(rawData)
    }

    if (reports.length === 0) {
      consecutiveEmpty++
      // Log first empty page for debugging
      if (consecutiveEmpty === 1) {
        const preview = rawData.substring(0, 200).replace(/\n/g, ' ')
        console.log(`    Page ${page}: 0 results (${rawData.length} chars) — preview: ${preview}`)
      }
      // Stop after 2 consecutive empty pages (safety valve)
      if (consecutiveEmpty >= 2) {
        console.log(`    Pagination ended at page ${page}`)
        break
      }
      page++
      await sleep(50)
      continue
    }

    consecutiveEmpty = 0
    allReports.push(...reports)

    // Log progress every 10 pages
    if (page % 10 === 0) {
      console.log(`    Page ${page}: +${reports.length} results (${allReports.length} total)`)
    }

    page++
    await sleep(50)
  }

  return allReports
}

/**
 * Extract cookies from a Puppeteer page as a "Cookie: ..." header string.
 * All browser pages share the same cookie jar, so any page works.
 */
async function getCookieString(page) {
  const cookies = await page.cookies()
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

/**
 * HTTP headers for headless fetch requests.
 * Uses the session cookies extracted from Puppeteer after login.
 */
function getHTTPHeaders(cookieString) {
  return {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }
}

/**
 * Fetch a single report page via HTTP and extract the hdnReportData JSON.
 * ~10-100x faster than opening a browser popup since no rendering is needed.
 * The report URL pattern is: /Reports/StudentReport.aspx?id={id0},{id1},{id2},{id3}
 */
async function fetchReportHTTP(reportIdString, cookieString, metadata) {
  const url = `${REPORT_URL}?id=${reportIdString}`

  try {
    // Retry up to 2 times on server errors (500s from rate limiting)
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, {
        headers: getHTTPHeaders(cookieString),
        redirect: 'follow'
      })

      if (response.ok || response.status < 500) break
      // Server error — back off and retry
      await sleep(1000 * (attempt + 1))
    }

    if (!response.ok) {
      console.warn(`  HTTP ${response.status} for ${metadata.courseCode}`)
      return null
    }

    const html = await response.text()

    // Use cheerio to extract hdnReportData (handles HTML entity decoding automatically)
    const $ = cheerio.load(html)
    const reportDataRaw = $('#hdnReportData').val()

    if (!reportDataRaw || reportDataRaw.length < 10) {
      console.warn(`  hdnReportData empty for ${metadata.courseCode}`)
      return null
    }

    const rawQuestions = JSON.parse(reportDataRaw)
    return parseReportData(rawQuestions, metadata)
  } catch (err) {
    console.warn(`  Failed HTTP fetch for ${metadata.courseCode}: ${err.message}`)
    return null
  }
}

/**
 * Extract evaluations from a batch of reports using direct HTTP requests.
 * All requests in the batch run fully in parallel — no browser rendering overhead.
 * This is the key speedup: 20+ lightweight text fetches vs 3-5 heavy browser popups.
 */
async function extractBatchViaHTTP(batch, cookieString) {
  const results = await Promise.all(
    batch.map(async (report) => {
      const { reportUrl, courseCode, instructor, term, respondents } = report
      const metadata = { courseCode, instructor, term, respondents }

      const evalData = await fetchReportHTTP(reportUrl, cookieString, metadata)
      return { report, evalData }
    })
  )

  return results
}

/**
 * Match a search result's course code to our course list.
 * Returns the course key if matched, or null.
 * Course codes can be cross-listed: "F24-CS-106A-01/F24-SYMSYS-106A-01"
 */
function matchResultToCourse(result, termCode, courseLookup) {
  const codeSegments = result.courseCode.split('/')
  for (const segment of codeSegments) {
    const parts = segment.trim().split('-')
    if (parts.length < 3) continue

    // Verify the term code matches what we searched for
    if (parts[0] !== termCode) continue

    // parts[1] = subject, parts[2] = course number
    const lookupKey = `${parts[1]}-${parts[2]}`
    if (courseLookup.has(lookupKey)) {
      return courseLookup.get(lookupKey)
    }
  }
  return null
}

/**
 * Main scraping function
 */
async function main() {
  const opts = parseArgs()
  const { resume, limit, course: singleCourse } = opts

  console.log('Stanford Course Evaluation Scraper')
  console.log('==================================')
  console.log('Strategy: fully headless HTTP (Puppeteer for login only)')

  // Load course codes
  let courseCodes
  if (singleCourse) {
    const [subject, ...codeParts] = singleCourse.split(' ')
    courseCodes = [{ subject, code: codeParts.join(' '), id: singleCourse, instructorLastNames: [] }]
    console.log(`Filtering for single course: ${singleCourse}`)
  } else {
    courseCodes = loadCourseCodes()
    console.log(`Loaded ${courseCodes.length} unique courses to match against`)
  }

  // Build a fast lookup: "CS-106A" -> course key (e.g., "CS 106A")
  const courseLookup = new Map()
  for (const c of courseCodes) {
    const subjectClean = c.subject.replace(/\s+/g, '')
    const codeClean = c.code.replace(/\s+/g, '')
    const key = `${subjectClean}-${codeClean}`
    if (!courseLookup.has(key)) {
      courseLookup.set(key, c.id || `${c.subject} ${c.code}`)
    }
  }

  // Load progress
  let evaluations = {}
  let completed = new Set()
  if (resume || opts.findMissing || opts.retryMissing) {
    const progress = loadProgress()
    evaluations = progress.evaluations
    completed = progress.completed
    console.log(`Resuming: ${completed.size} reports already scraped`)
  }

  // --find-missing / --retry-missing: find courses with ZERO evaluations in evaluations.json.
  // These are courses in our data files that we never successfully extracted data for.
  // (Courses only offered in some terms are NOT counted as "missing" for other terms.)
  let missingCourseList = null
  if (opts.findMissing || opts.retryMissing) {
    const evalsKeys = new Set(Object.keys(evaluations))
    missingCourseList = []

    for (const course of courseCodes) {
      const courseKey = course.id || `${course.subject} ${course.code}`
      if (!evalsKeys.has(courseKey)) {
        missingCourseList.push({
          courseKey,
          subject: course.subject.replace(/\s+/g, ''),
          code: course.code.replace(/\s+/g, '')
        })
      }
    }

    const withEvals = evalsKeys.size
    const total = courseCodes.length
    console.log(`\nCourses in data files: ${total}`)
    console.log(`Courses with evaluations: ${withEvals}`)
    console.log(`Courses with ZERO evaluations: ${missingCourseList.length}`)

    if (opts.findMissing) {
      // Just list them and exit — no browser needed
      console.log(`\nThese courses have no evaluation data at all:`)
      for (const m of missingCourseList) {
        console.log(`  ${m.courseKey}`)
      }
      console.log(`\nMany of these may simply not exist on EvaluationKit.`)
      console.log(`To search & extract any that do exist, run: npm run scrape:evals:retry`)
      return
    }
  }

  // Launch browser
  console.log('\nLaunching browser for login...')
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()

  // Navigate to the public report page for login
  await page.goto(`${BASE_URL}/Report/Public`, { waitUntil: 'networkidle2' })

  console.log('\n========================================')
  console.log('Please log in to EvaluationKit in the browser.')
  console.log('Once you are on the Student Reporting search page,')
  console.log('press ENTER in this terminal to continue...')
  console.log('========================================\n')

  // Wait for user to press Enter after logging in
  await new Promise(resolve => {
    process.stdin.once('data', () => resolve())
  })

  // Extract session cookies from the browser for HTTP requests.
  // This is the key to the speed optimization: all report fetches use lightweight
  // HTTP requests with these cookies instead of opening heavy browser popups.
  const cookieString = await getCookieString(page)
  console.log(`Extracted ${cookieString.split(';').length} session cookies for HTTP extraction`)

  const { concurrency } = opts

  // === RETRY-MISSING MODE ===
  // Search for each course that has 0 evaluations, by course code (e.g., "CS 106A").
  // Each search returns a small set of results (all terms), no pagination needed.
  // This is much faster than re-searching all 9 terms with thousands of results each.
  if (opts.retryMissing && missingCourseList) {
    console.log(`\nRetry-missing: searching ${missingCourseList.length} courses directly by code...`)
    let retryExtracted = 0
    let retrySkipped = 0
    let retryNoResults = 0

    // Process courses in batches
    const BATCH = concurrency || 5

    for (let i = 0; i < missingCourseList.length; i += BATCH) {
      const batch = missingCourseList.slice(i, Math.min(i + BATCH, missingCourseList.length))

      await Promise.all(batch.map(async (info) => {
        // Search by subject + code (e.g., "CS 106A") — returns results across all terms
        const searchQuery = `${info.subject} ${info.code}`
        const results = await searchCourseHTTP(searchQuery, cookieString)

        // Filter to results that match our course and aren't already completed
        const toExtract = []
        for (const result of results) {
          if (completed.has(result.courseCode)) continue

          // Verify this result actually matches our course (not a substring match)
          const segments = result.courseCode.split('/')
          let matchedKey = null
          for (const seg of segments) {
            const parts = seg.trim().split('-')
            if (parts.length < 3) continue
            const lookupKey = `${parts[1]}-${parts[2]}`
            if (courseLookup.has(lookupKey)) {
              matchedKey = courseLookup.get(lookupKey)
              break
            }
          }
          if (matchedKey === info.courseKey) {
            toExtract.push({ ...result, _courseKey: matchedKey })
          }
        }

        if (toExtract.length === 0) {
          retryNoResults++
          return
        }

        // Extract each matched result
        const batchResults = await extractBatchViaHTTP(toExtract, cookieString)
        for (const { report, evalData } of batchResults) {
          if (evalData) {
            if (!evaluations[report._courseKey]) evaluations[report._courseKey] = []
            evaluations[report._courseKey].push(evalData)
            completed.add(report.courseCode)
            retryExtracted++
            console.log(`  OK: ${report.courseCode} - ${report.instructor} [${report._courseKey}]`)
          } else {
            retrySkipped++
            console.log(`  SKIP: ${report.courseCode} (no data on server)`)
          }
        }
      }))

      // Save after each batch
      saveProgress(evaluations, completed)

      // Progress log
      const done = Math.min(i + BATCH, missingCourseList.length)
      if (done % 50 === 0 || done === missingCourseList.length) {
        console.log(`  Progress: ${done}/${missingCourseList.length} courses searched`)
      }
    }

    const coursesWithEvals = Object.keys(evaluations).length
    console.log('\n==================================')
    console.log('Retry-missing complete!')
    console.log(`  Courses searched: ${missingCourseList.length}`)
    console.log(`  Not on EvaluationKit: ${retryNoResults}`)
    console.log(`  New evaluations extracted: ${retryExtracted}`)
    console.log(`  Skipped (empty data): ${retrySkipped}`)
    console.log(`  Total courses with evaluations: ${coursesWithEvals}`)
    console.log('==================================')
    await browser.close()
    return
  }

  // Number of terms to process in parallel (all HTTP now, no browser pages needed)
  const termWorkers = singleCourse ? 1 : (opts.workers || Math.min(5, RECENT_TERMS.length))

  console.log(`Extraction concurrency: ${concurrency} parallel HTTP requests`)
  console.log(`Term workers: ${termWorkers} parallel HTTP searches`)
  console.log('\nStarting scrape...\n')

  let totalExtracted = 0
  let totalMatched = 0
  let errors = 0

  // Keep-alive: periodically ping the site to prevent session expiry.
  // Uses a lightweight HTTP request instead of a full browser page.
  const KEEP_ALIVE_INTERVAL = 3 * 60 * 1000 // every 3 minutes
  const keepAliveTimer = setInterval(async () => {
    try {
      await fetch(`${BASE_URL}/Report/Public`, {
        headers: getHTTPHeaders(cookieString)
      })
    } catch {
      // Silently ignore — session may already be refreshed by active scraping
    }
  }, KEEP_ALIVE_INTERVAL)
  console.log('Session keep-alive started (HTTP ping every 3 minutes)')

  // Work queue of terms
  const termQueue = [...RECENT_TERMS]

  /**
   * Process a single term: search for results, match to course list,
   * then extract evaluations in parallel batches.
   */
  async function processTerm(term) {
    const prefix = `[${term.code}]`

    let searchQuery
    if (singleCourse) {
      const [subject, ...codeParts] = singleCourse.split(' ')
      searchQuery = `${term.code}-${subject}-${codeParts.join('')}`
    } else {
      searchQuery = term.code
    }

    console.log(`  ${prefix} Searching: "${searchQuery}"`)

    // Search entirely via HTTP (no browser needed)
    const allResults = await searchCourseHTTP(searchQuery, cookieString)
    console.log(`  ${prefix} Found ${allResults.length} total results`)

    if (allResults.length === 0) return

    // Collect matching results (fast, in-memory filtering)
    const matchedResults = []
    for (const result of allResults) {
      if (completed.has(result.courseCode)) continue
      const courseKey = matchResultToCourse(result, term.code, courseLookup)
      if (!courseKey) continue
      matchedResults.push({ ...result, _courseKey: courseKey })
    }

    if (matchedResults.length === 0) {
      console.log(`  ${prefix} No new evaluations to extract`)
      return
    }

    console.log(`  ${prefix} Extracting ${matchedResults.length} evaluations (${concurrency} at a time)...`)

    // Extract in parallel batches via HTTP requests:
    // Each batch fires N lightweight HTTP fetches simultaneously — no browser rendering
    for (let i = 0; i < matchedResults.length; i += concurrency) {
      if (limit && totalExtracted >= limit) break
      const batch = matchedResults.slice(i, Math.min(i + concurrency, matchedResults.length))

      const batchResults = await extractBatchViaHTTP(batch, cookieString)

      for (const { report, evalData } of batchResults) {
        if (evalData) {
          if (!evaluations[report._courseKey]) evaluations[report._courseKey] = []
          evaluations[report._courseKey].push(evalData)
          totalExtracted++
          completed.add(report.courseCode)
          console.log(`  ${prefix} OK: ${report.courseCode} - ${report.instructor}`)
        } else {
          // Don't add to completed — allows retry on --resume
          console.log(`  ${prefix} SKIP: ${report.courseCode} - ${report.instructor} (no data, will retry)`)
        }
      }

      // Save progress after every batch (crash protection for long runs)
      saveProgress(evaluations, completed)

      // Brief delay between batches to avoid overwhelming the server
      if (i + concurrency < matchedResults.length) {
        await sleep(REQUEST_DELAY)
      }
    }

    totalMatched += matchedResults.length
    console.log(`  ${prefix} Done: ${matchedResults.length} matched [${completed.size} total, ${totalExtracted} extracted]`)
  }

  /**
   * Term worker: pulls terms from the shared queue and processes them.
   * Multiple workers run in parallel — all use HTTP, no browser pages needed.
   */
  async function termWorker(workerId) {
    while (termQueue.length > 0) {
      if (limit && totalExtracted >= limit) break
      const term = termQueue.shift()
      if (!term) break

      console.log(`\n=== ${term.label} (${term.code}) [Worker ${workerId + 1}] ===`)
      try {
        await processTerm(term)
        await sleep(SEARCH_DELAY)
      } catch (err) {
        errors++
        console.error(`  [${term.code}] Error: ${err.message}`)

        // If we get an HTTP error, the session may have expired
        if (err.message.includes('401') || err.message.includes('403') || err.message.includes('fetch')) {
          console.log('\n  Session may have expired. Please log in again in the browser,')
          console.log('  then press ENTER to re-extract cookies and continue...\n')
          await new Promise(resolve => {
            process.stdin.once('data', () => resolve())
          })
          // Note: cookieString won't update here since it's const.
          // User should restart with --resume for a fresh session.
        }
      }
    }
  }

  // Run term workers in parallel
  await Promise.all(
    Array.from({ length: termWorkers }, (_, i) => termWorker(i))
  )

  // Clean up keep-alive
  clearInterval(keepAliveTimer)

  // Final save
  saveProgress(evaluations, completed)

  const coursesWithEvals = Object.keys(evaluations).length

  console.log('\n==================================')
  console.log('Scraping complete!')
  console.log(`  Terms searched: ${RECENT_TERMS.length}`)
  console.log(`  Evaluations matched: ${totalMatched}`)
  console.log(`  Evaluations extracted: ${totalExtracted}`)
  console.log(`  Courses with evaluations: ${coursesWithEvals}`)
  console.log(`  Errors: ${errors}`)
  console.log(`  Output: ${OUTPUT_FILE}`)
  console.log('==================================')

  await browser.close()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
