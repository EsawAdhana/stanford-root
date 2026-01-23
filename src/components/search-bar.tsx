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

  // Debounce URL updates so filtering runs after typing pauses
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
    const val = e.target.value;
    setLocalValue(val);
  };

  return (
    <div className="relative w-full max-w-4xl group">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
      </div>
      <Input
        ref={inputRef}
        placeholder="Search by class (eg. PSYCH 1), subject (eg. MATH), or instructors (eg. Piech)"
        className="pl-12 h-12 rounded-full border-border/60 bg-secondary/30 hover:bg-secondary/50 focus:bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/50 text-base shadow-sm transition-all duration-200"
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
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          <span className="text-[10px] text-muted-foreground border border-border/50 rounded px-1.5 py-0.5 bg-background/50 hidden sm:inline-block">/</span>
      </div>
    </div>
  );
}
