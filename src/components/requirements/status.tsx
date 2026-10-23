import { Check, Circle, Diamond, Minus } from 'lucide-react'
import type { NodeStatus } from '@/lib/requirements/audit'
import { cn } from '@/lib/utils'

/**
 * My Academic Path's legend: a check when final grades are in, a diamond
 * when it is met as long as current courses pass, and an alert when it is
 * not met. Planned and free-text states are Stanford Root's own.
 */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  planned: 'Planned',
  incomplete: 'Not met',
  manual: 'Check by hand',
  optional: 'Optional',
  info: 'Info',
  inactive: 'Not used',
}

const TONE: Record<NodeStatus, string> = {
  complete: 'text-emerald-600 dark:text-emerald-400',
  'in-progress': 'text-sky-600 dark:text-sky-400',
  planned: 'text-amber-600 dark:text-amber-400',
  incomplete: 'text-red-600 dark:text-red-400',
  manual: 'text-muted-foreground',
  optional: 'text-muted-foreground',
  info: 'text-muted-foreground',
  inactive: 'text-muted-foreground/60',
}

export function StatusMark({ status, className }: { status: NodeStatus; className?: string }) {
  const tone = TONE[status]
  const size = 'h-4 w-4 shrink-0'
  return (
    <span className={cn('inline-flex', tone, className)} title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]}>
      {status === 'complete' && <Check className={size} strokeWidth={3} />}
      {status === 'in-progress' && <Diamond className={size} strokeWidth={2.5} />}
      {status === 'planned' && <Diamond className={cn(size, 'opacity-80')} strokeWidth={2} strokeDasharray="3 2" />}
      {status === 'incomplete' && <span className="h-4 w-4 shrink-0 rounded-full border-2 border-current text-[10px] font-bold leading-[12px] text-center">!</span>}
      {(status === 'manual' || status === 'optional') && <Circle className={size} strokeWidth={2} />}
      {(status === 'info' || status === 'inactive') && <Minus className={size} />}
    </span>
  )
}

export function StatusText({ status, className }: { status: NodeStatus; className?: string }) {
  return <span className={cn('text-xs font-medium', TONE[status], className)}>{STATUS_LABEL[status]}</span>
}

export function courseStatusTone(status: string): string {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10'
  if (status === 'in-progress') return 'border-sky-500/30 bg-sky-500/10'
  if (status === 'planned') return 'border-amber-500/30 bg-amber-500/10 border-dashed'
  return 'border-border bg-muted/40'
}

/** Met share of a program's requirements, with planned courses as a lighter segment. */
export function ProgressBar({ met, withPlan, total, className }: { met: number; withPlan: number; total: number; className?: string }) {
  const done = total ? (met / total) * 100 : 0
  const plan = total ? (Math.max(0, withPlan - met) / total) * 100 : 0
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className="flex h-full">
        <div className="h-full bg-emerald-600 dark:bg-emerald-500" style={{ width: `${done}%` }} />
        <div className="h-full bg-amber-500/60" style={{ width: `${plan}%` }} />
      </div>
    </div>
  )
}
