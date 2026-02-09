'use client';

import { Input } from '@/components/ui/input';
import { useQueryState } from 'nuqs';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function SearchBar() {
  const [query, setQuery] = useQueryState('q', { defaultValue: '', shallow: true })
  const [localValue, setLocalValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null)

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) ||
        (e.key === 'k' && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  return (
    <div className="relative w-full max-w-2xl group">
      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
        <Search className="h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors duration-200" />
      </div>
      <Input
        ref={inputRef}
        placeholder="Search classes, subjects, or instructors..."
        className="pl-10 pr-16 h-10 rounded-xl border-border/50 bg-secondary/40 hover:bg-secondary/60 focus:bg-background focus:ring-2 focus:ring-primary/15 focus:border-primary/30 text-sm shadow-none transition-all duration-200 placeholder:text-muted-foreground/40"
        value={localValue}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          if (debounceRef.current) window.clearTimeout(debounceRef.current)
          setQuery(localValue.trim() ? localValue : null)
        }}
        onBlur={() => {
          if (debounceRef.current) window.clearTimeout(debounceRef.current)
          setQuery(localValue.trim() ? localValue : null)
        }}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border/40 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/40 shadow-[0_1px_0_0_hsl(var(--border)/0.3)]">
          <span className="text-[11px]">/</span>
        </kbd>
      </div>
    </div>
  );
}
