import type { MetadataRoute } from 'next'
import { readFile } from 'fs/promises'
import { SITE_URL } from '@/lib/site'
import { serverCatalogPath } from '@/lib/catalog-paths'

// Rebuild the sitemap at most once a day rather than per request.
export const revalidate = 86400

/** Prefer the prebuilt light dump so builds don't hang on a sick Supabase. */
async function getCatalog(): Promise<{ ids: string[]; subjects: string[] }> {
  try {
    const raw = await readFile(serverCatalogPath('light.json'), 'utf8')
    const rows = JSON.parse(raw) as Array<{
      course_id?: string
      id?: string
      subject?: string
      grading?: string
    }>
    const ids = new Set<string>()
    const subjects = new Set<string>()
    for (const row of rows) {
      const grading = (row.grading || '').trim()
      if (!grading || grading === 'TBD') continue
      const id = row.course_id || row.id
      if (id) ids.add(id)
      if (row.subject) subjects.add(row.subject)
    }
    return { ids: Array.from(ids), subjects: Array.from(subjects).sort() }
  } catch {
    // Never fail the sitemap build — fall back to static routes only.
    return { ids: [], subjects: [] }
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/departments`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/schedule`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  const { ids, subjects } = await getCatalog()

  const departmentRoutes: MetadataRoute.Sitemap = subjects.map((subject) => ({
    url: `${SITE_URL}/${encodeURIComponent(subject)}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  const courseRoutes: MetadataRoute.Sitemap = ids.map((id) => ({
    url: `${SITE_URL}/${encodeURIComponent(id)}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }))

  return [...staticRoutes, ...departmentRoutes, ...courseRoutes]
}
