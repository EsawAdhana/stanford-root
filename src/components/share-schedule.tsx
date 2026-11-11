'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { track } from '@/lib/analytics';
import { shareLinkPath } from '@/lib/share-link';
import type { CartItem } from '@/lib/cart-store';

type ShareProps = { term: string; courses: CartItem[] }

/** The full share URL for one term's classes, or null while there is nothing to share. */
function useShareUrl({ term, courses }: ShareProps): string | null {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  return useMemo(() => {
    const path = shareLinkPath(term, courses.map(c => ({
      id: c.id,
      selectedSectionIds: c.selectedSectionIds,
      selectedUnits: c.selectedUnits,
    })))
    return path && origin ? `${origin}${path}` : null
  }, [term, courses, origin])
}

/**
 * The header's Share button, from the sm breakpoint up. A phone's header has
 * no room for a fourth control (it already fills 368 of 375 px), so there the
 * same link lives in the Transfer menu as `ShareScheduleItem`.
 */
export function ShareSchedule(props: ShareProps) {
  const { term, courses } = props
  const url = useShareUrl(props)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setCopied(false), [url])
  // "Copied!" for a moment, then back to "Copy link" so it can be copied again.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard access can be refused (an insecure origin, a strict
      // browser). Leave the link selected so a manual copy is one keystroke.
      inputRef.current?.select()
      toast.error('Could not copy automatically. The link is selected, so copy it from the box.')
      return
    }
    setCopied(true)
    track('schedule_share_copied', { courses: courses.length, via: 'button' })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex gap-2 text-muted-foreground hover:text-foreground">
          <Share className="h-4 w-4" />
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <p className="text-sm font-semibold">Share your {term} schedule</p>
        {url ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              Anyone with the link can see these classes and times, but can&apos;t change anything. The link
              shows your schedule as it is now, so share a new one after you change classes.
            </p>
            <div className="mt-3 flex gap-2">
              <Input
                ref={inputRef}
                readOnly
                value={url}
                aria-label="Share link"
                onFocus={e => e.currentTarget.select()}
                className="h-9 text-xs"
              />
              <Button size="sm" className="h-9 shrink-0" onClick={copy}>
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Add a class to {term} first, then share it from here.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The phone's way in: a Transfer menu row that opens the system share sheet. */
export function ShareScheduleItem(props: ShareProps) {
  const { term, courses } = props
  const url = useShareUrl(props)

  const share = async () => {
    if (!url) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${term} schedule`, url })
        track('schedule_share_copied', { courses: courses.length, via: 'share_sheet' })
        return
      } catch (err) {
        // Closing the sheet is a choice, not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
      track('schedule_share_copied', { courses: courses.length, via: 'menu' })
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={!url}
      className="sm:hidden flex flex-col gap-1 p-2 text-left rounded-md hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none group"
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        <Share className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        Share Schedule
      </div>
      <span className="text-xs text-muted-foreground pl-6">
        {url ? `Send a read-only link to your ${term} classes.` : `Add a class to ${term} to share it.`}
      </span>
    </button>
  )
}
