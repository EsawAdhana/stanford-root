'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import type { ProgramIndex, ProgramKind } from '@/lib/requirements/types'
import { cn } from '@/lib/utils'

const FILTERS: { id: 'all' | ProgramKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'major', label: 'Majors' },
  { id: 'minor', label: 'Minors' },
  { id: 'grad', label: 'Graduate and coterm' },
  { id: 'honors', label: 'Honors' },
  { id: 'phd-minor', label: 'PhD minors' },
]

export function AddProgramDialog({ open, onOpenChange, index }: { open: boolean; onOpenChange: (open: boolean) => void; index: ProgramIndex }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | ProgramKind>('all')
  const programs = useDegreeStore(s => s.programs)
  const addProgram = useDegreeStore(s => s.addProgram)
  const added = new Set(programs.map(p => p.code))

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return index.programs.filter(p =>
      (kind === 'all' || p.kind === kind) &&
      (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)))
  }, [index, query, kind])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle>Add a program</DialogTitle>
          <DialogDescription>All {index.programs.length} programs in the {index.year} Bulletin. Add a coterm master&apos;s alongside your major.</DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Computer Science, Economics, CS-MS…" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setKind(f.id)}
              className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', kind === f.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <ul className="-mx-2 max-h-[50vh] overflow-y-auto">
          {results.slice(0, 120).map(p => {
            const isAdded = added.has(p.code)
            return (
              <li key={p.code}>
                <button
                  disabled={isAdded}
                  onClick={() => { addProgram(p.code); onOpenChange(false); setQuery('') }}
                  className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{p.name}</span>
                    {p.subplans.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{p.subplans.length} subplans</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{isAdded ? 'Added' : p.code}</span>
                </button>
              </li>
            )
          })}
          {results.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">No program matches “{query}”.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
