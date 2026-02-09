import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseAnonKey)

const PAGE_SIZE = 1000

// In-memory cache (survives across requests in the same serverless instance)
let cachedLight: any[] | null = null
let cachedFull: any[] | null = null
let lightTimestamp = 0
let fullTimestamp = 0
const CACHE_TTL = 1000 * 60 * 15 // 15 min

async function fetchAllRows (columns: string) {
  const { count, error: countError } = await supabase
    .from('courses')
    .select('*', { count: 'exact', head: true })
  if (countError) throw countError
  if (!count || count === 0) return []

  const pages = Math.ceil(count / PAGE_SIZE)
  const promises = Array.from({ length: pages }, (_, i) => {
    const from = i * PAGE_SIZE
    return supabase.from('courses').select(columns).range(from, from + PAGE_SIZE - 1)
  })

  const results = await Promise.all(promises)
  const rows: any[] = []
  for (const r of results) {
    if (r.error) throw r.error
    if (r.data) rows.push(...r.data)
  }
  return rows
}

function mergeRows (rows: any[]) {
  const merged = new Map<string, any>()
  for (const row of rows) {
    const existing = merged.get(row.course_id)
    if (!existing) {
      merged.set(row.course_id, { ...row })
      continue
    }
    // Merge terms
    const terms = Array.from(new Set([...(existing.terms || []), ...(row.terms || [])]))
    // Merge sections
    const sections = [...(existing.sections || []), ...(row.sections || [])]
    merged.set(row.course_id, { ...existing, terms, sections })
  }
  return Array.from(merged.values())
}

export async function GET (request: Request) {
  const { searchParams } = new URL(request.url)
  const full = searchParams.get('full') === '1'

  try {
    if (full) {
      // Full data (with sections + description)
      if (cachedFull && Date.now() - fullTimestamp < CACHE_TTL) {
        return NextResponse.json(cachedFull, {
          headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' }
        })
      }

      const rows = await fetchAllRows(
        'course_id, subject, code, title, description, units, grading, instructors, terms, dept, sections'
      )
      const merged = mergeRows(rows)
      cachedFull = merged
      fullTimestamp = Date.now()

      return NextResponse.json(merged, {
        headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' }
      })
    }

    // Light data (card-level only — fast)
    if (cachedLight && Date.now() - lightTimestamp < CACHE_TTL) {
      return NextResponse.json(cachedLight, {
        headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' }
      })
    }

    const rows = await fetchAllRows(
      'course_id, subject, code, title, units, instructors, terms'
    )
    const merged = mergeRows(rows)
    cachedLight = merged
    lightTimestamp = Date.now()

    return NextResponse.json(merged, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' }
    })
  } catch (err: any) {
    console.error('Failed to fetch courses:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
