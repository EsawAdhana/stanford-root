import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { parseClassNbrParam } from '@/lib/seats'
import { readLiveSeats } from '@/lib/live-seats'

/**
 * GET /api/seats?strm=1272&classNbr=1883,1884
 *
 * Server-side proxy for Navigator's per-class enrollment. It has to be
 * server-side: navigator.stanford.edu sends no access-control-allow-origin, so
 * a browser cannot read it. The proxy is also what keeps the upstream load
 * bounded — 1,000 students on the same course in the same minute is one
 * upstream fetch, not a thousand.
 */

const RATE_LIMIT_PER_MIN = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const strm = parseInt(searchParams.get('strm') || '', 10)
  const classNbrs = parseClassNbrParam(searchParams.get('classNbr'))

  // strm is 1252..1278 in the catalog window; reject anything else rather than
  // forward a made-up term code upstream.
  if (!Number.isFinite(strm) || strm < 1000 || strm > 1999 || classNbrs.length === 0) {
    return NextResponse.json({ error: 'strm and classNbr are required' }, { status: 400 })
  }

  if (!rateLimit(`seats:${getClientIp(request)}`, RATE_LIMIT_PER_MIN, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await readLiveSeats(strm, classNbrs)

  return NextResponse.json(body, {
    // The CDN absorbs a burst on a popular course; the shared instance cache
    // handles the rest. Both are shorter than a student's attention span.
    headers: { 'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=120' },
  })
}
