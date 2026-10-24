'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ProgramResult } from '@/lib/requirements/audit'
import { useDegreeStore } from '@/lib/requirements/degree-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { RequirementNode } from './requirement-node'
import { ProgressBar, StatusMark, StatusText } from './status'

const KIND_LABEL: Record<string, string> = {
  major: 'Major',
  minor: 'Minor',
  grad: 'Graduate program',
  'phd-minor': 'PhD minor',
  honors: 'Interdisciplinary honors',
}

// Select items cannot have an empty value.
const NO_SUBPLAN = '__none'

export function programAnchor(code: string): string {
  return `program-${code.replace(/[^A-Za-z0-9-]/g, '')}`
}

export function ProgramCard({ result, majorsCount }: { result: ProgramResult; majorsCount: number }) {
  const { data, choice } = result
  const update = useDegreeStore(s => s.updateProgram)
  const remove = useDegreeStore(s => s.removeProgram)
  const subplans = data.blocks.filter(b => b.kind === 'subplan')
  const optional = data.blocks.filter(b => b.kind === 'optional')
  const info = data.blocks.filter(b => b.kind === 'info')
  const pct = result.total ? Math.round((result.met / result.total) * 100) : 0

  return (
    <section id={programAnchor(data.code)} className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
      <header className="border-b border-border/60 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusMark status={result.status} />
              <h2 className="text-lg font-semibold tracking-tight">{data.name}</h2>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {KIND_LABEL[data.kind]}{data.degree ? ` · ${data.degree}` : ''} ·{' '}
              <a href={data.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
                {data.year} Bulletin
              </a>
              {data.letterGrade && ' · letter grades required'}
              {data.minGrade && ` · ${data.minGrade} or better in each course`}
              {choice.exploring && ' · What-if: not counted against your other programs'}
              {choice.secondary && ' · Secondary major: may share courses'}
            </p>
          </div>
          {result.total === 0 && !result.needsSubplan ? (
            <p className="w-full max-w-[16rem] text-xs text-muted-foreground sm:w-56">
              The Bulletin lists no course rules here for the audit to check. Follow the program page and your advisor.
            </p>
          ) : (
          <div className="w-full max-w-[16rem] sm:w-56">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">{result.met} of {result.total} {result.total === 1 ? 'requirement' : 'requirements'}</span>
              <span className="tabular-nums text-muted-foreground">{pct}%</span>
            </div>
            <ProgressBar className="mt-1.5" met={result.met} withPlan={result.metWithPlan} total={result.total} />
            <p className="mt-1 text-xs text-muted-foreground">
              {result.units} units applied{data.unitsMin ? ` of ${data.unitsMin}` : ''}
              {result.metWithPlan > result.met ? ` · ${result.metWithPlan - result.met} more met by planned classes` : ''}
            </p>
          </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {subplans.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Subplan</span>
              <Select
                value={choice.subplan ?? (data.subplanRequired === false ? NO_SUBPLAN : '')}
                onValueChange={v => update(data.code, { subplan: v === NO_SUBPLAN ? undefined : v })}
              >
                <SelectTrigger className={cn('h-8 w-auto min-w-[12rem] text-xs', result.needsSubplan && 'border-red-500/50')}>
                  <SelectValue placeholder="Pick one" />
                </SelectTrigger>
                <SelectContent>
                  {/* The Bulletin lets these programs be finished without one. */}
                  {data.subplanRequired === false && <SelectItem value={NO_SUBPLAN} className="text-xs">No subplan</SelectItem>}
                  {subplans.map(b => <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          )}
          {optional.map(b => (
            <label key={b.id} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="accent-[hsl(var(--primary))]"
                checked={Boolean(choice.optional?.includes(b.id))}
                onChange={e => update(data.code, {
                  optional: e.target.checked ? [...(choice.optional ?? []), b.id] : (choice.optional ?? []).filter(id => id !== b.id),
                })}
              />
              {b.name}
            </label>
          ))}
          {data.kind === 'major' && majorsCount > 1 && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={Boolean(choice.secondary)} onChange={e => update(data.code, { secondary: e.target.checked })} />
              Secondary major
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={Boolean(choice.exploring)} onChange={e => update(data.code, { exploring: e.target.checked })} />
            What-if
          </label>
          <button className="ml-auto text-muted-foreground hover:text-red-600" onClick={() => remove(data.code)}>Remove</button>
        </div>
        {result.needsSubplan && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">Pick your subplan to see its requirements. The audit leaves it out until you do.</p>
        )}
      </header>

      <div className="divide-y divide-border/50">
        {result.checks.length > 0 && (
          <div className="px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold">Across the whole program</h3>
            <ul className="mt-1 space-y-1.5 text-sm">
              {result.checks.map(c => (
                <li key={c.label} className="flex items-start gap-2">
                  <StatusMark status={c.status} className="mt-0.5" />
                  <span className="flex-1">
                    <span className="font-medium">{c.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{c.detail}</span>
                  </span>
                  <StatusText status={c.status} className="hidden sm:inline" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.blocks.filter(b => b.included).map(b => (
          <BlockSection key={b.block.id} block={b} program={data.code} />
        ))}
        {info.length > 0 && (
          <div className="px-4 py-2 sm:px-5">
            {info.flatMap(b => b.rules).map(r => (
              <RequirementNode key={r.id} result={{ node: r, status: 'info', have: { courses: 0, units: 0 }, applied: [] }} program={data.code} />
            ))}
          </div>
        )}
        {(data.gpa || data.grading || data.policies || data.otherRequirements || data.transferPolicy) && <ProgramPolicies data={result.data} />}
        {data.reviewNotes && <ReviewNotes data={result.data} />}
      </div>
    </section>
  )
}

function BlockSection({ block, program }: { block: ProgramResult['blocks'][number]; program: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="px-4 py-3 sm:px-5">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <h3 className="flex-1 text-sm font-semibold">{block.block.name}</h3>
        {block.floor && <span className="text-xs text-muted-foreground">{block.floor.have > block.floor.need ? `${block.floor.have} units, ${block.floor.need} needed` : `${block.floor.have} of ${block.floor.need} units`}</span>}
        <StatusText status={block.status} />
      </button>
      {open && (
        <div className="mt-1 text-sm">
          {block.block.notes && <p className="ml-6 mt-1 whitespace-pre-line text-xs text-muted-foreground">{block.block.notes}</p>}
          {rulesShown(block).map(r => <RequirementNode key={r.node.id} result={r} program={program} />)}
        </div>
      )}
    </div>
  )
}

/**
 * A block that is one rule of the same name ("Human-Computer Interaction
 * Subplan" inside "Human-Computer Interaction Subplan") shows that rule's
 * parts directly instead of the name twice.
 */
function rulesShown(block: ProgramResult['blocks'][number]) {
  const only = block.rules.length === 1 ? block.rules[0] : null
  if (only && only.node.t === 'all' && only.children?.length && only.node.name === block.block.name && !only.floor) return only.children
  return block.rules
}

/**
 * What was corrected in the Bulletin's data for this program, and when, so a
 * student can see why the audit reads a rule the way it does.
 */
function ReviewNotes({ data }: { data: ProgramResult['data'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-4 py-3 text-xs sm:px-5">
      <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(v => !v)}>
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        How these rules were read{data.reviewed ? ` (checked against the Bulletin text ${data.reviewed})` : ''}
      </button>
      {open && <p className="mt-2 max-w-prose whitespace-pre-line leading-relaxed text-muted-foreground">{data.reviewNotes}</p>}
    </div>
  )
}

function ProgramPolicies({ data }: { data: ProgramResult['data'] }) {
  const [open, setOpen] = useState(false)
  const text = [
    data.gpa && `GPA: ${data.gpa}`,
    data.grading && `Grading: ${data.grading}`,
    data.policies,
    data.otherRequirements && `Other requirements on the registrar's record: ${data.otherRequirements}`,
    data.transferPolicy && `Transfer and AP credit: ${data.transferPolicy}`,
  ].filter(Boolean).join('\n\n')
  return (
    <div className="px-4 py-3 text-xs sm:px-5">
      <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(v => !v)}>
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        Grading, GPA and other policies, as the Bulletin words them
      </button>
      {open && <p className="mt-2 max-w-prose whitespace-pre-line leading-relaxed text-muted-foreground">{text}</p>}
    </div>
  )
}
