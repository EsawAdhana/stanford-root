import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let publicClient: SupabaseClient | null = null

/**
 * Lazily-created anon-key Supabase client for the public `courses` table only.
 * Access is governed by Row-Level Security: `courses` has a SELECT policy for the
 * `anon` role. Stanford-only tables (evaluations, course_class_years,
 * comment_sentiment) have no anon policy, so this client reads nothing from them;
 * use getServiceClient() after the Stanford check instead. Created on first use so
 * a missing env var surfaces as a handled 500 rather than crashing the module import.
 */
export function getPublicClient(): SupabaseClient {
  if (publicClient) return publicClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) {
    throw new Error('Supabase public client is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).')
  }
  publicClient = createClient(url, key, { auth: { persistSession: false } })
  return publicClient
}

let serviceClient: SupabaseClient | null = null

/**
 * Lazily-created service-role Supabase client for the Stanford-only tables.
 * The service role bypasses RLS, so this must only be called from server code
 * that has already checked the caller is a Stanford user (see
 * src/app/api/evaluations/route.ts and src/lib/mcp/data.ts). The key is
 * SUPABASE_SERVICE_ROLE_KEY, never a NEXT_PUBLIC_ variable: it must not reach
 * the browser bundle. There is deliberately no fallback to the anon key, because
 * the anon role can no longer read these tables and a silent fallback would turn
 * a missing env var into empty evaluations instead of a visible 500.
 */
export function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    throw new Error('Supabase service client is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  }
  serviceClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return serviceClient
}

/** Full course row columns (card data + sections + description). */
export const FULL_COURSE_COLUMNS = 'course_id, subject, code, title, description, units, grading, instructors, terms, sections, hours, quality, quality_pct, quality_n, rating_breakdown, cross_list_with'

/** Light course row columns (card-level only — no description/sections). */
export const LIGHT_COURSE_COLUMNS = 'course_id, subject, code, title, units, instructors, terms, grading, hours, quality, quality_pct, quality_n, rating_breakdown, cross_list_with'

/** Merge rows that share a course_id (cross-listed / multi-term), combining terms + sections. */
export function mergeCourseRows(rows: any[]) {
  const merged = new Map<string, any>()
  for (const row of rows) {
    const existing = merged.get(row.course_id)
    if (!existing) {
      merged.set(row.course_id, { ...row })
      continue
    }
    const terms = Array.from(new Set([...(existing.terms || []), ...(row.terms || [])]))
    const sections = [...(existing.sections || []), ...(row.sections || [])]
    // Prefer non-empty units when merging (first row may have empty units)
    const units = (existing.units && String(existing.units).trim()) ? existing.units : (row.units || existing.units)
    merged.set(row.course_id, { ...existing, terms, sections, units })
  }
  return Array.from(merged.values())
}
