'use client';

import { Input } from '@/components/ui/input';
import { useQueryState } from 'nuqs';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/analytics';
import { useFindShortcut } from '@/hooks/use-find-shortcut';
import { createSearchBoxSync } from '@/lib/search-box-sync';

export function SearchBar() {
  const pathname = usePathname();
  const [query, setQuery] = useQueryState('q', { defaultValue: '', shallow: true })
  const [localValue, setLocalValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTrackedRef = useRef('')
  const setQueryRef = useRef(setQuery)
  useEffect(() => { setQueryRef.current = setQuery }, [setQuery])

  // The box is the source of truth while it is in use; ?q= only replaces its
  // text when something else changed it (Back, Clear all). See search-box-sync.
  const [sync] = useState(() => createSearchBoxSync({
    initial: query,
    commit: q => setQueryRef.current(q),
    onValue: setLocalValue,
  }))

  useEffect(() => {
    sync.urlChanged(query);
  }, [sync, query]);

  useEffect(() => () => sync.dispose(), [sync])

  // Track only on commit (Enter/blur), not per debounced keystroke, otherwise
  // typing a sentence fires a beacon per word.
  const commitQuery = () => {
    sync.flush()
    const trimmed = sync.value.trim()
    if (trimmed && trimmed !== lastTrackedRef.current) {
      lastTrackedRef.current = trimmed
      track('search_performed', { length: trimmed.length })
    }
  }

  // Ctrl-F/Cmd-F is shared with the schedule and comment search boxes, so it
  // lives in one hook; "/" and Cmd-K stay here because only this bar has them.
  useFindShortcut(inputRef, pathname === '/');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      if (
        (e.key === '/' && !isInput) ||
        (e.key === 'k' && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Pressing a link blurs the box before the click lands. Writing ?q= in that
  // gap cancelled the link's navigation (the card needed a second click), so a
  // blur caused by a link press holds the pending search until the click
  // resolves: dropped if the link navigated, committed if it didn't.
  const linkPressAtRef = useRef(0)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const onLink = e.button === 0 && e.target instanceof Element && e.target.closest('a[href]') != null
      linkPressAtRef.current = onLink ? Date.now() : 0
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  const handleBlur = () => {
    const pressedLink = Date.now() - linkPressAtRef.current < 1000
    linkPressAtRef.current = 0
    if (!pressedLink) {
      commitQuery()
      return
    }
    sync.holdForLink()
    let settled = false
    const settle = (navigating: boolean) => {
      if (settled) return
      settled = true
      window.removeEventListener('click', onClick)
      window.removeEventListener('pointerup', onPointerUp, true)
      if (navigating) sync.releaseLink(true)
      else commitQuery()
    }
    // Window listeners run after React's, so defaultPrevented here means
    // Next's Link took the click and is navigating.
    const onClick = (e: MouseEvent) => settle(e.defaultPrevented)
    // No click at all (the pointer slid off the link): commit as a plain blur.
    const onPointerUp = () => { window.setTimeout(() => settle(false), 300) }
    window.addEventListener('click', onClick)
    window.addEventListener('pointerup', onPointerUp, true)
    // A press held past this is not a quick click; committing before its click
    // is safe, since a navigation that starts later still wins.
    window.setTimeout(() => settle(false), 1500)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    sync.type(e.target.value);
  };

  return (
    <div className="relative w-full group">
      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
        <Search className="h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors duration-200" />
      </div>
      <Input
        ref={inputRef}
        placeholder="Search courses or professors..."
        className="pl-10 pr-4 h-10 rounded-xl border-border/50 bg-secondary/40 hover:bg-secondary/60 focus:bg-background focus:ring-2 focus:ring-primary/15 focus:border-primary/30 text-base md:text-sm shadow-none transition-all duration-200 placeholder:text-muted-foreground/40 md:placeholder:text-muted-foreground/40 md:w-full"
        value={localValue}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          commitQuery()
        }}
        onBlur={handleBlur}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border/40 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/40 shadow-[0_1px_0_0_hsl(var(--border)/0.3)]">
          <span className="text-[11px]">/</span>
        </kbd>
      </div>
    </div>
  );
}
