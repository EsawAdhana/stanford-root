'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEnsureCatalog } from '@/hooks/use-catalog'
import { useDegreeAudit } from '@/hooks/use-degree-audit'
import { getCoursesById, useCourseStore } from '@/lib/store'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import type { AuditResult, ProgramResult, UnitSummary } from '@/lib/requirements/audit'
import { cn } from '@/lib/utils'
import { AuditContext, type AuditContextValue } from './audit-context'
import { AddCourseDialog } from './add-course-dialog'
import { AddProgramDialog } from './add-program-dialog'
import { CourseChip } from './course-chip'
import { CourseHistory } from './course-history'
import { ImportDialog } from './import-dialog'
import { MoveDialog } from './move-dialog'
import { ProgramCard, programAnchor } from './program-card'
import { RequirementNode } from './requirement-node'
import { ProgressBar, StatusMark, StatusText } from './status'

export function RequirementsApp() {
  // The plan lives in localStorage, so the server has nothing to render.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEnsureCatalog()
  if (!mounted) return <PageSkeleton />
  return <Requirements />
}

function Requirements() {
  const audit = useDegreeAudit()
  const catalogCourses = useCourseStore(s => s.courses)
  const catalog = useMemo(() => getCoursesById(catalogCourses), [catalogCourses])
  const programCount = useDegreeStore(s => s.programs.length)
  const generalEducation = useDegreeStore(s => s.generalEducation)
  const setGeneralEducation = useDegreeStore(s => s.setGeneralEducation)
  const [tab, setTab] = useState<'audit' | 'courses'>('audit')
  const [addProgram, setAddProgram] = useState(false)
  const [addCourse, setAddCourse] = useState<{ term?: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [move, setMove] = useState<{ program: string; node: string } | null>(null)

  const ctx: AuditContextValue | null = useMemo(() => {
    if (audit.state !== 'ready') return null
    return {
      result: audit.result,
      courseIndex: audit.courseIndex,
      programIndex: audit.programIndex,
      programs: audit.programs,
      catalog,
      openMove: (program, node) => setMove({ program, node }),
    }
  }, [audit, catalog])

  if (audit.state === 'error') {
    return (
      <Shell>
        <div className="rounded-xl border border-border/60 px-6 py-10 text-center">
          <p className="font-medium">The requirement data did not load.</p>
          <p className="mt-1 text-sm text-muted-foreground">{audit.message}</p>
          <Button className="mt-4" variant="outline" onClick={audit.retry}>Try again</Button>
        </div>
      </Shell>
    )
  }
  if (!ctx || audit.state !== 'ready') return <PageSkeleton />

  const { result } = ctx
  const recordedCount = result.courses.size
  const majorsCount = result.programs.filter(p => p.data.kind === 'major' && !p.choice.exploring).length
  const showCareer = result.programs.some(p => p.data.kind === 'grad') && result.programs.some(p => p.data.kind !== 'grad')

  return (
    <AuditContext.Provider value={ctx}>
      <Shell
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>Import transcript</Button>
            <Button size="sm" onClick={() => setAddProgram(true)}>Add program</Button>
          </>
        }
      >
        <Tabs value={tab} onValueChange={v => setTab(v as 'audit' | 'courses')}>
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <TabsList>
              <TabsTrigger value="audit">Audit</TabsTrigger>
              <TabsTrigger value="courses">Courses{recordedCount ? ` (${recordedCount})` : ''}</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-3 text-xs">
              {tab === 'courses' && <Button variant="outline" size="sm" onClick={() => setAddCourse({})}>Add a course</Button>}
              {tab === 'audit' && programCount > 0 && (
                <button className="text-muted-foreground hover:text-foreground" onClick={() => window.print()}>Print or save as PDF</button>
              )}
            </div>
          </div>

          <TabsContent value="audit" className="mt-5">
            {programCount === 0 ? (
              <EmptyAudit onAdd={() => setAddProgram(true)} onImport={() => setImportOpen(true)} hasCourses={recordedCount > 0} />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
                <Contents result={result} />
                <div className="min-w-0 space-y-5">
                  {recordedCount === 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm print:hidden">
                      <span className="text-muted-foreground">No courses yet, so nothing is applied. Import your transcript or add courses to fill this in.</span>
                      <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>Import transcript</Button>
                    </div>
                  )}
                  <Units result={result} />
                  {result.doubleCounted.length > 0 && <DoubleCounted result={result} />}
                  {result.programs.map(p => <ProgramCard key={p.code} result={p} majorsCount={majorsCount} />)}
                  {result.generalEducation.length > 0 && <GeneralEducation programs={result.generalEducation} />}
                  {!generalEducation && result.programs.some(p => p.data.kind !== 'grad' && p.data.kind !== 'phd-minor') && (
                    <button className="text-xs text-muted-foreground hover:text-foreground print:hidden" onClick={() => setGeneralEducation(true)}>
                      Show general education (COLLEGE, Ways, Writing, Language)
                    </button>
                  )}
                  <NotApplied result={result} />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="courses" className="mt-5">
            <CourseHistory onAdd={term => setAddCourse({ term })} onImport={() => setImportOpen(true)} />
          </TabsContent>
        </Tabs>

        <AddProgramDialog open={addProgram} onOpenChange={setAddProgram} index={ctx.programIndex} />
        <AddCourseDialog open={Boolean(addCourse)} onOpenChange={o => !o && setAddCourse(null)} index={ctx.courseIndex} defaultTerm={addCourse?.term} showCareer={showCareer} />
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} index={ctx.courseIndex} />
        <MoveDialog target={move} onClose={() => setMove(null)} />
      </Shell>
    </AuditContext.Provider>
  )
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Degree requirements</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your courses checked against the 2026-27 Stanford Bulletin, for every major, minor and coterm. It stays in this browser.
            My Academic Path is still the official audit.
          </p>
        </div>
        {actions && <div className="flex gap-2 print:hidden">{actions}</div>}
      </div>
      {children}
    </main>
  )
}

function PageSkeleton() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6" aria-busy="true">
      <div className="mb-6">
        <div className="h-9 w-72 rounded bg-muted/50" />
        <div className="mt-2 h-4 w-[28rem] max-w-full rounded bg-muted/40" />
      </div>
      <div className="h-10 w-48 rounded-md bg-muted/50" />
      <div className="mt-5 grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <div className="hidden h-48 rounded-xl bg-muted/30 lg:block" />
        <div className="space-y-5">
          <div className="h-24 rounded-xl border border-border/40 bg-muted/20" />
          <div className="h-80 rounded-xl border border-border/40 bg-muted/20" />
        </div>
      </div>
    </main>
  )
}

function EmptyAudit({ onAdd, onImport, hasCourses }: { onAdd: () => void; onImport: () => void; hasCourses: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="text-lg font-semibold">Start with your program</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
        Add your major, and any minor or coterm master&apos;s. Then import your unofficial transcript and the audit places every course
        where it counts most, including the Ways.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={onAdd}>Add a program</Button>
        {!hasCourses && <Button variant="outline" onClick={onImport}>Import transcript</Button>}
      </div>
    </div>
  )
}

function Contents({ result }: { result: AuditResult }) {
  const all = [...result.programs, ...result.generalEducation]
  const geMet = result.generalEducation.reduce((s, p) => s + p.met, 0)
  const geTotal = result.generalEducation.reduce((s, p) => s + p.total, 0)
  const geWithPlan = result.generalEducation.reduce((s, p) => s + p.metWithPlan, 0)
  const totalMet = all.filter(p => !p.choice.exploring).reduce((s, p) => s + p.met, 0)
  const total = all.filter(p => !p.choice.exploring).reduce((s, p) => s + p.total, 0)
  return (
    <nav className="hidden lg:block print:hidden" aria-label="Contents">
      <div className="sticky top-24 space-y-4 text-sm">
        <div>
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Overall</span>
            <span className="tabular-nums">{total ? Math.round((totalMet / total) * 100) : 0}%</span>
          </div>
          <ProgressBar className="mt-1.5" met={totalMet} withPlan={all.filter(p => !p.choice.exploring).reduce((s, p) => s + p.metWithPlan, 0)} total={total} />
        </div>
        <ul className="space-y-3">
          {result.programs.map(p => (
            <ContentsItem key={p.code} href={`#${programAnchor(p.code)}`} label={p.data.name} program={p} />
          ))}
          {result.generalEducation.length > 0 && (
            <li>
              <a href="#general-education" className="block hover:text-primary">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">General education</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{geTotal ? Math.round((geMet / geTotal) * 100) : 0}%</span>
                </div>
                <ProgressBar className="mt-1" met={geMet} withPlan={geWithPlan} total={geTotal} />
              </a>
            </li>
          )}
          <li>
            <a href="#not-applied" className="text-muted-foreground hover:text-primary">
              Not applied{result.notApplied.length ? ` (${result.notApplied.length})` : ''}
            </a>
          </li>
        </ul>
        <div className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <Legend status="complete" text="Complete, grades in" />
          <Legend status="in-progress" text="Met if current classes pass" />
          <Legend status="planned" text="Met by planned classes" />
          <Legend status="incomplete" text="Not met" />
          <Legend status="manual" text="Check by hand" />
        </div>
      </div>
    </nav>
  )
}

function Legend({ status, text }: { status: Parameters<typeof StatusMark>[0]['status']; text: string }) {
  return <div className="flex items-center gap-2"><StatusMark status={status} />{text}</div>
}

function ContentsItem({ href, label, program }: { href: string; label: string; program: ProgramResult }) {
  return (
    <li>
      <a href={href} className="block hover:text-primary">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate', program.choice.exploring && 'italic')}>{label}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{program.total ? Math.round((program.met / program.total) * 100) : 0}%</span>
        </div>
        <ProgressBar className="mt-1" met={program.met} withPlan={program.metWithPlan} total={program.total} />
      </a>
    </li>
  )
}

function Units({ result }: { result: AuditResult }) {
  if (!result.undergradUnits && !result.gradUnits) return null
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {result.undergradUnits && <UnitBar title="Units toward your bachelor's" units={result.undergradUnits} note={result.undergradUnits.overCap ? `${result.undergradUnits.overCap} pass/fail units over the 36-unit cap don't count.` : undefined} />}
      {result.gradUnits && <UnitBar title="Graduate units (master's minimum)" units={result.gradUnits} note="Only courses on your graduate record count here." />}
    </section>
  )
}

function UnitBar({ title, units, note }: { title: string; units: UnitSummary; note?: string }) {
  const total = units.completed + units.inProgress + units.planned
  const pct = (n: number) => `${Math.min(100, (n / units.need) * 100)}%`
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="tabular-nums text-muted-foreground">{units.completed + units.inProgress} of {units.need}</span>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-emerald-600 dark:bg-emerald-500" style={{ width: pct(units.completed) }} />
        <div className="bg-sky-500" style={{ width: pct(units.inProgress) }} />
        <div className="bg-amber-500/60" style={{ width: pct(units.planned) }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {units.completed} completed, {units.inProgress} in progress, {units.planned} planned
        {total < units.need ? `, ${units.need - total} still to plan` : ''}. {note}
      </p>
    </div>
  )
}

function GeneralEducation({ programs }: { programs: ProgramResult[] }) {
  const setGeneralEducation = useDegreeStore(s => s.setGeneralEducation)
  return (
    <section id="general-education" className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">General education</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            COLLEGE, Ways, Writing and Rhetoric, and Language, from the{' '}
            <a href={programs[0].data.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">Bulletin&apos;s policy</a>.
            A course can count here and toward your major. A two-Ways course is placed in the Way that leaves you the least to take.
          </p>
        </div>
        <button className="text-xs text-muted-foreground hover:text-foreground print:hidden" onClick={() => setGeneralEducation(false)}>Hide</button>
      </header>
      <div className="divide-y divide-border/50">
        {programs.map(p => (
          <div key={p.code} className="px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-sm font-semibold">{p.data.name}</h3>
              <StatusText status={p.status} />
            </div>
            <div className="text-sm">
              {p.blocks[0].rules.map(r => <RequirementNode key={r.node.id} result={r} program={p.code} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function NotApplied({ result }: { result: AuditResult }) {
  const notCounted = result.notCounted.map(id => result.courses.get(id)).filter(Boolean)
  return (
    <section id="not-applied" className="scroll-mt-24 rounded-xl border border-border/60 bg-card px-4 py-4 sm:px-5">
      <h2 className="text-sm font-semibold">Classes not applied</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">They still count toward your total units, as general electives.</p>
      {result.notApplied.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Every course is applied somewhere.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.notApplied.map(id => <NotAppliedChip key={id} id={id} result={result} />)}
        </div>
      )}
      {notCounted.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Not counted (not passed, withdrawn or repeated): {notCounted.map(c => `${c!.course.code} ${c!.course.term}${c!.course.grade ? ` (${c!.course.grade})` : ''}`).join(', ')}
        </p>
      )}
    </section>
  )
}

function NotAppliedChip({ id, result }: { id: string; result: AuditResult }) {
  // Offered as a move into the first declared program; the chip menu lists the rest.
  const program = result.programs.find(p => !p.choice.exploring) ?? result.programs[0]
  if (!program) {
    const c = result.courses.get(id)
    return <span className="rounded-md border px-2 py-0.5 text-xs">{c?.course.code}</span>
  }
  return <CourseChip applied={{ courseId: id, units: result.courses.get(id)?.units ?? 0 }} program={program.code} node={{ id: '__none', t: 'courses' }} />
}

function DoubleCounted({ result }: { result: AuditResult }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-medium">Counted toward two programs that may not share it</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Stanford allows only its{' '}
        <Link href="https://bulletin.stanford.edu/academic-polices/degree-requirements/ug-double-counting" target="_blank" className="underline">list of foundational courses</Link>{' '}
        to double-count between majors and minors, unless both departments approve.
      </p>
      <ul className="mt-2 text-xs">
        {result.doubleCounted.map(d => (
          <li key={d.courseId}>{result.courses.get(d.courseId)?.course.code}: {d.programs.join(' and ')}</li>
        ))}
      </ul>
    </div>
  )
}
