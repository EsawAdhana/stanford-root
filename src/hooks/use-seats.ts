'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { strmForTerm, MAX_CLASS_NBRS_PER_REQUEST, type LiveSeat, type SeatsResponse } from '@/lib/seats'

const REFRESH_AFTER_MS = 45_000

/**
 * Live seat counts for the sections on screen. Fetches once when the course or
 * term changes, and again when the tab regains focus if the reading has aged
 * out — no interval, because a timer would keep asking Navigator about a page
 * nobody is looking at.
 */
export function useLiveSeats(term: string, classNbrs: number[]) {
  const [seats, setSeats] = useState<Map<number, LiveSeat>>(new Map())
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const lastFetchRef = useRef(0)
  // Each load takes a number. Only the newest may write: the focus refresh has
  // no abort signal, and one started before a term switch would otherwise land
  // after it. Class numbers repeat across terms, so its counts would show on
  // the new term's sections.
  const loadIdRef = useRef(0)

  const strm = strmForTerm(term)
  // A stable key so the effect does not refire on a new array with the same ids.
  const idsKey = classNbrs.slice(0, MAX_CLASS_NBRS_PER_REQUEST).sort((a, b) => a - b).join(',')

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!strm || !idsKey) return
    lastFetchRef.current = Date.now()
    const loadId = ++loadIdRef.current
    try {
      const res = await fetch(`/api/seats?strm=${strm}&classNbr=${idsKey}`, { signal })
      if (!res.ok) return
      const body: SeatsResponse = await res.json()
      if (loadId !== loadIdRef.current) return
      const next = new Map<number, LiveSeat>()
      for (const seat of Object.values(body.seats || {})) next.set(seat.classNbr, seat)
      if (next.size === 0) return
      setSeats(next)
      setFetchedAt(body.fetchedAt ? Date.parse(body.fetchedAt) : Date.now())
    } catch {
      // Leave the dump's snapshot on screen; a failed overlay is not an error
      // the student can act on.
    }
  }, [strm, idsKey])

  useEffect(() => {
    const controller = new AbortController()
    setSeats(new Map())
    setFetchedAt(null)
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetchRef.current < REFRESH_AFTER_MS) return
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load])

  return { seats, fetchedAt }
}
