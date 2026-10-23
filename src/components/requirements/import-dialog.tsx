'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CourseIndex } from '@/lib/requirements/course-index'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import { parseTranscript, type ParsedCourse } from '@/lib/requirements/transcript'

/**
 * Import course history from the Axess unofficial transcript (the PDF, or
 * text copied out of it) or a MAP class history. Parsing happens in the
 * browser; the student checks every row before it is saved.
 */
export function ImportDialog({ open, onOpenChange, index }: { open: boolean; onOpenChange: (open: boolean) => void; index: CourseIndex }) {
  const importTranscript = useDegreeStore(s => s.importTranscript)
  const hadImport = useDegreeStore(s => s.courses.some(c => c.source === 'transcript'))
  const [text, setText] = useState('')
  const [rows, setRows] = useState<(ParsedCourse & { keep: boolean })[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    setRows(null)
    setSkipped(0)
    setError(null)
  }, [open])

  const parse = (source: string) => {
    const { courses, skipped } = parseTranscript(source, index.subjects)
    setRows(courses.map(c => ({ ...c, keep: true })))
    setSkipped(skipped.length)
    if (courses.length === 0) setError('No course rows found. Copy the whole transcript, including the term headings, and try again.')
    else setError(null)
  }

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const { pdfToText } = await import('@/lib/requirements/pdf-text')
        const extracted = await pdfToText(file)
        setText(extracted)
        parse(extracted)
      } else {
        const content = await file.text()
        setText(content)
        parse(content)
      }
    } catch (err) {
      setError(`Could not read that file (${err instanceof Error ? err.message : String(err)}). Copy the text out of it and paste it below instead.`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const kept = rows?.filter(r => r.keep) ?? []
  const save = () => {
    // The catalog's title over the transcript's all-caps one ("AI 360", not "Ai 360").
    importTranscript(kept.map(({ keep: _keep, ...c }) => ({ ...c, title: index.get(c.code)?.title ?? c.title, grade: c.grade || undefined })))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-3">
        <DialogHeader>
          <DialogTitle>Import your courses</DialogTitle>
          <DialogDescription>
            In Axess, open My Academics, then Request Transcript, then Unofficial Transcript, and upload the PDF here. It is read
            in your browser and never uploaded.
          </DialogDescription>
        </DialogHeader>

        {!rows && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Reading…' : 'Choose transcript PDF'}
              </Button>
              <span className="text-xs text-muted-foreground">or paste the text, or a My Academic Path class history</span>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.csv,application/pdf,text/plain" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={'2024-2025 Autumn\nCS 106B  PROGRAMMING ABSTRACTIONS  5.00  5.00  A\n…'}
              className="h-48 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {rows && rows.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border/60">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">Course</th>
                  <th className="hidden px-2 py-1.5 font-medium sm:table-cell">Title</th>
                  <th className="px-2 py-1.5 font-medium">Term</th>
                  <th className="px-2 py-1.5 text-right font-medium">Units</th>
                  <th className="px-2 py-1.5 font-medium">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r, i) => (
                  <tr key={`${r.code}-${r.term}-${i}`} className={r.keep ? '' : 'opacity-50'}>
                    <td className="px-2 py-1">
                      <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={r.keep} onChange={e => setRows(rs => rs!.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-medium">{r.code}</td>
                    <td className="hidden max-w-[16rem] truncate px-2 py-1 text-muted-foreground sm:table-cell">{index.get(r.code)?.title ?? r.title}</td>
                    <td className="whitespace-nowrap px-2 py-1">{r.term}{r.career === 'GR' ? ' · grad' : ''}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.units}</td>
                    <td className="px-2 py-1">{r.grade || <span className="text-muted-foreground">none yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {rows.length} courses found{skipped ? `, ${skipped} lines skipped because no term came before them` : ''}.
            {hadImport ? ' This replaces your last import; courses you added by hand stay.' : ''}
          </p>
        )}

        <DialogFooter>
          {rows ? (
            <>
              <Button variant="ghost" onClick={() => { setRows(null); setError(null) }}>Back</Button>
              <Button onClick={save} disabled={kept.length === 0}>Import {kept.length} courses</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => parse(text)} disabled={!text.trim() || busy}>Read courses</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
