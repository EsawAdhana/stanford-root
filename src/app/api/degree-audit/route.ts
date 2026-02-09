import { NextRequest, NextResponse } from 'next/server'
import { parseDegreeAudit } from '@/lib/parse-degree-audit'
import { findRemainingCourses } from '@/lib/find-remaining-courses'
import { getStanfordUser } from '@/lib/auth-server'
import type { Course } from '@/types/course'
import fs from 'fs'
import path from 'path'

// pdf-parse (ESM) exposes a named export: PDFParse (no default export)
import { PDFParse } from 'pdf-parse'

export const runtime = 'nodejs'

function normalizeCourseCode (code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

function loadWorkerTermsMap (): Map<string, string[]> {
  const dir = path.join(process.cwd(), 'public', 'data')
  const out = new Map<string, string[]>()

  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter(f => /^results_worker_\d+\.json$/.test(f))
  } catch {
    return out
  }

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      const rows = JSON.parse(raw)
      if (!Array.isArray(rows)) continue

      for (const row of rows) {
        const course = typeof row?.course === 'string' ? row.course : ''
        const term = typeof row?.term === 'string' ? row.term : ''
        if (!course || !term) continue

        const key = normalizeCourseCode(course)
        const prev = out.get(key) || []
        if (!prev.includes(term)) prev.push(term)
        out.set(key, prev)
      }
    } catch {
      // ignore malformed worker file
    }
  }

  return out
}

export async function POST (req: NextRequest) {
  const user = await getStanfordUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')

    let rawText: string

    if (isText && !isPdf) {
      // Plain text upload (e.g., user exported MAP as text)
      rawText = await file.text()
    } else if (isPdf) {
      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Extract text from PDF
      try {
        const parser = new PDFParse({ data: buffer })
        const textResult = await parser.getText()
        rawText = textResult.text
      } catch (error: any) {
        console.error('pdf-parse error:', error)
        return NextResponse.json(
          {
            error:
              'Failed to parse PDF in this environment. As a workaround, export your MAP as text and upload the .txt file instead.'
          },
          { status: 500 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'File must be a PDF or a .txt export of your MAP' },
        { status: 400 }
      )
    }

    // Parse the audit
    const parsedAudit = parseDegreeAudit(rawText)

    // Load all courses from file system
    const coursesPath = path.join(process.cwd(), 'public', 'data', 'courses.json')
    let allCourses: Course[]
    try {
      const coursesData = fs.readFileSync(coursesPath, 'utf-8')
      allCourses = JSON.parse(coursesData)
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to load course data' },
        { status: 500 }
      )
    }

    const termsByCourseCode = loadWorkerTermsMap()

    // Find remaining courses
    const remainingCourses = findRemainingCourses(parsedAudit, allCourses, { termsByCourseCode })

    return NextResponse.json({
      parsedAudit,
      remainingCourses
    })
  } catch (error) {
    console.error('Error processing degree audit:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
