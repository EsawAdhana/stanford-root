'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CourseIndex } from '@/lib/requirements/course-index'
import { normalizeCode } from '@/lib/requirements/course-index'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import { selectableTerms, TEST_CREDIT, TRANSFER_CREDIT } from '@/lib/requirements/student-courses'
import type { Career, CourseInfo } from '@/lib/requirements/types'
import { getCurrentTerm } from '@/lib/terms'

const GRADES = ['', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'CR', 'S', 'NP', 'NC', 'W']

export function AddCourseDialog({
  open,
  onOpenChange,
  index,
  defaultTerm,
  showCareer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: CourseIndex
  defaultTerm?: string
  showCareer: boolean
}) {
  const addCourse = useDegreeStore(s => s.addCourse)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CourseInfo | null>(null)
  const [term, setTerm] = useState(defaultTerm ?? getCurrentTerm())
  const [units, setUnits] = useState('')
  const [grade, setGrade] = useState('')
  const [career, setCareer] = useState<Career>('UG')

  useEffect(() => {
    if (open) {
      setQuery('')
      setPicked(null)
      setGrade('')
      setUnits('')
      setTerm(defaultTerm ?? getCurrentTerm())
    }
  }, [open, defaultTerm])

  const results = useMemo(() => (picked ? [] : index.search(query, 12)), [index, query, picked])
  const terms = useMemo(() => [TEST_CREDIT, TRANSFER_CREDIT, ...selectableTerms().reverse()], [])
  // A code that is not in this year's catalog (a retired course) can still be added.
  const typedCode = /^[A-Za-z&]+\s*\d/.test(query.trim()) ? normalizeCode(query) : ''

  const choose = (c: CourseInfo) => {
    setPicked(c)
    setQuery(c.code)
    setUnits(String(c.max || c.min || ''))
  }

  const save = () => {
    const code = picked?.code ?? typedCode
    const u = Number(units)
    if (!code || !Number.isFinite(u) || u < 0) return
    addCourse({ code, title: picked?.title, term, units: u, grade: grade || undefined, ...(showCareer ? { career } : {}) })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>Add a course</DialogTitle>
          <DialogDescription>Something you took, are taking, or plan to take. Leave the grade empty if there isn&apos;t one yet.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Input autoFocus placeholder="Course code or title" value={query} onChange={e => { setQuery(e.target.value); setPicked(null) }} />
          {results.length > 0 && (
            <ul className="mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1">
              {results.map(c => (
                <li key={c.code}>
                  <button onClick={() => choose(c)} className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <span className="w-24 shrink-0 font-medium">{c.code}</span>
                    <span className="truncate text-muted-foreground">{c.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {picked && <p className="-mt-1 text-xs text-muted-foreground">{picked.title} · {picked.min === picked.max ? picked.min : `${picked.min}-${picked.max}`} units{picked.ways.length ? ` · Ways: ${picked.ways.join(', ')}` : ''}</p>}
        {!picked && typedCode && results.length === 0 && (
          <p className="-mt-1 text-xs text-muted-foreground">{typedCode} is not in the 2026-27 catalog. It will be added as typed.</p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 grid gap-1 text-xs sm:col-span-1">
            <span className="text-muted-foreground">Term</span>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {terms.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Units</span>
            <Input className="h-9" inputMode="decimal" value={units} onChange={e => setUnits(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Grade</span>
            <Select value={grade || 'none'} onValueChange={v => setGrade(v === 'none' ? '' : v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {GRADES.map(g => <SelectItem key={g || 'none'} value={g || 'none'} className="text-xs">{g || 'None yet'}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        </div>
        {showCareer && (
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Counts toward</span>
            <Select value={career} onValueChange={v => setCareer(v as Career)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UG" className="text-xs">Undergraduate record</SelectItem>
                <SelectItem value="GR" className="text-xs">Graduate record (coterm)</SelectItem>
              </SelectContent>
            </Select>
          </label>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!(picked || typedCode) || units === ''}>Add course</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
