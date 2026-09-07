'use client';

import { Input } from '@/components/ui/input';
import { useQueryState } from 'nuqs';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/analytics';

export function SearchBar() {
  const pathname = usePathname();
  const [query, setQuery] = useQueryState('q', { defaultValue: '', shallow: true })
  const [localValue, setLocalValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null)
  const lastTrackedRef = useRef('')

  useEffect(() => {
    setLocalValue(query);
  }, [query]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setQuery(localValue.trim() ? localValue : null)
    }, 250)

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [localValue, setQuery])

  // Track only on commit (Enter/blur), not per debounced keystroke — otherwise
  // typing a sentence fires a beacon per word.
  const commitQuery = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    const trimmed = localValue.trim()
    setQuery(trimmed ? localValue : null)
    if (trimmed && trimmed !== lastTrackedRef.current) {
      lastTrackedRef.current = trimmed
      track('search_performed', { length: trimmed.length })
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      if (
        (e.key === '/' && !isInput) ||
        (e.key === 'k' && (e.metaKey || e.ctrlKey)) ||
        (pathname === '/' && e.key === 'f' && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pathname]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
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
        onBlur={commitQuery}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border/40 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/40 shadow-[0_1px_0_0_hsl(var(--border)/0.3)]">
          <span className="text-[11px]">/</span>
        </kbd>
      </div>
    </div>
  );
}
