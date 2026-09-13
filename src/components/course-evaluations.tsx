'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useEvaluationStore } from '@/lib/evaluation-store'
import { useAuthStore } from '@/lib/auth-store'
import { track } from '@/lib/analytics'
import { StanfordLoginButton } from '@/components/stanford-login-button'
import {
  Loader2, ChevronDown, ChevronUp, MessageSquare,
  ExternalLink, Clock, Search, X, Lock, Users
} from 'lucide-react'
import { cn, decodeHtmlEntities } from '@/lib/utils'
import { formatInstructorName, instructorSlug } from '@/lib/instructors'
import { isDevEvalsUnlocked } from '@/lib/dev-flags'
import { compareTerms } from '@/lib/terms'
import { splitLinkSegments } from '@/lib/linkify'
import { CLASS_YEAR_BUCKETS, optionStats } from '@/lib/class-years'
import type { ClassYearBreakdown, Course, CourseEvaluation, EvalQuestion, EvalOption } from '@/types/course'
import { addRatingCounts, pooledMean, rankShare, rankScopeLabel } from '@/lib/quality-score.mjs'
import { categorizeQuestion, dedupeCourseLevelReports } from '@/lib/eval-reports.mjs'

// --- Color helpers (green=good, yellow/orange=mid, red=bad) ---

function scoreColor(score: number): string {
  if (score >= 4.5) return 'text-emerald-600'
  if (score >= 4.0) return 'text-green-600'
  if (score >= 3.5) return 'text-yellow-600'
  if (score >= 3.0) return 'text-orange-600'
  return 'text-red-600'
}

function scoreBg(score: number): string {
  if (score >= 4.5) return 'bg-emerald-500/12 border-emerald-500/25'
  if (score >= 4.0) return 'bg-green-500/12 border-green-500/25'
  if (score >= 3.5) return 'bg-yellow-500/12 border-yellow-500/25'
  if (score >= 3.0) return 'bg-orange-500/12 border-orange-500/25'
  return 'bg-red-500/12 border-red-500/25'
}

/**
 * Colour for a percentile, on the same five-step vocabulary as the 1-5 scores. Keyed to
 * the percentile rather than the score because the percentile is what it sits beside --
 * a 4.5 that only beats 40% of Stanford should not read as green.
 */
function rankColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-600'
  if (pct >= 60) return 'text-green-600'
  if (pct >= 40) return 'text-yellow-600'
  if (pct >= 20) return 'text-orange-600'
  return 'text-red-600'
}

/**
 * "Ranks higher than 71% of CS courses", with the share sized and coloured to be read
 * first.
 *
 * The peer group is always spelled out. A rank inside a department and a rank against
 * all of Stanford are different numbers on the same 1-99 scale, and which one a course
 * got depends on how many rated classes its department has -- so a bare "71%" would
 * leave the reader unable to tell the two apart.
 */
function RankSentence({ percentile, scope, shareClass }: {
  percentile: number
  scope?: string | null
  shareClass: string
}) {
  return (
    <>
      Ranks higher than{' '}
      <span className={cn('font-bold tabular-nums', shareClass, rankColor(percentile))}>
        {rankShare(percentile) as number}%
      </span>{' '}
      of {rankScopeLabel(scope)}
    </>
  )
}

function RankLine({ percentile, scope, className }: {
  percentile: number
  scope?: string | null
  className?: string
}) {
  return (
    <div className={cn('text-[11px] text-muted-foreground', className)}>
      <RankSentence percentile={percentile} scope={scope} shareClass="text-[15px]" />
    </div>
  )
}

export function barFill(score: number): string {
  if (score >= 4.5) return 'bg-emerald-500'
  if (score >= 4.0) return 'bg-green-500'
  if (score >= 3.5) return 'bg-yellow-500'
  if (score >= 3.0) return 'bg-orange-500'
  return 'bg-red-500'
}

// --- Question categorization ---

export type QuestionCategory = 'quality' | 'learning' | 'organization' | 'goals' | 'hours' | 'attendance_in_person' | 'attendance_online' | 'unknown'

export { categorizeQuestion }

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  quality: 'Instruction Quality',
  learning: 'Learning',
  organization: 'Organization',
  goals: 'Goals Achieved',
  hours: 'Hours / Week',
  attendance_in_person: 'In-Person Attendance',
  attendance_online: 'Online Attendance',
  unknown: 'Other'
}

/** The categories surfaced in summaries, in display order. */
export const RATING_CATEGORIES: QuestionCategory[] = ['quality', 'learning', 'organization', 'hours']

const CATEGORY_SHORT: Record<QuestionCategory, string> = {
  quality: 'Quality',
  learning: 'Learn',
  organization: 'Org',
  goals: 'Goals',
  hours: 'Hrs/Wk',
  attendance_in_person: 'In-Person',
  attendance_online: 'Online',
  unknown: ''
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Aggregation: pooled means for the 1-5 ratings, medians for the open-ended numerics.
 *
 * Ratings pool every individual response across sections and terms -- see
 * src/lib/quality-score.mjs for why a median is the wrong statistic on a scale whose
 * mode sits on the ceiling. Hours stays a median: it is unbounded and a single
 * "60 hours" answer would drag a mean.
 */
const POOLED_CATEGORIES: QuestionCategory[] = ['quality', 'learning', 'organization', 'goals']

export function aggregateMetrics(evals: CourseEvaluation[]) {
  try {
    if (!Array.isArray(evals)) return {}
    const medianCats: Record<QuestionCategory, number[]> = {
      quality: [], learning: [], organization: [], goals: [], hours: [],
      attendance_in_person: [], attendance_online: [], unknown: []
    }
    const pooled = new Map<QuestionCategory, Map<number, number>>()

    for (const ev of evals) {
      const questions = ev?.questions || []
      for (const q of questions) {
        const cat = categorizeQuestion(q?.text ?? '')
        if (POOLED_CATEGORIES.includes(cat)) {
          if (!pooled.has(cat)) pooled.set(cat, new Map())
          addRatingCounts(pooled.get(cat)!, q)
          continue
        }
        const val = typeof q?.median === 'number' && !isNaN(q.median) ? q.median : null
        if (val != null) medianCats[cat].push(val)
      }
    }

    const result: Partial<Record<QuestionCategory, number>> = {}
    for (const [cat, values] of Object.entries(medianCats)) {
      const m = median(values)
      if (m != null) result[cat as QuestionCategory] = m
    }
    for (const [cat, counts] of pooled) {
      const p = pooledMean(counts)
      if (p) result[cat] = p.mean
    }
    return result
  } catch {
    return {}
  }
}

function computeInstructorStats(evals: CourseEvaluation[]) {
  // Group first, then reuse aggregateMetrics so an instructor row and the course
  // summary above it are always computed the same way.
  const byInstructor = new Map<string, CourseEvaluation[]>()
  for (const ev of evals) {
    if (!byInstructor.has(ev.instructor)) byInstructor.set(ev.instructor, [])
    byInstructor.get(ev.instructor)!.push(ev)
  }

  return Array.from(byInstructor, ([name, own]) => ({
    name,
    scores: aggregateMetrics(own),
    evalCount: own.length,
    terms: Array.from(new Set(own.map(ev => ev.term))),
  })).sort((a, b) => (b.scores.quality || 0) - (a.scores.quality || 0))
}

// --- Sub-components ---

/**
 * Option C headline: the pooled 1-5 mean, plus where that mean sits in Stanford's own
 * distribution. The rank is the point of the component -- on its own a 4.6 looks
 * excellent when it is in fact merely typical here.
 */
export function ScoreBadge({ score, size = 'md' }: { score: number, size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5 min-w-[36px]',
    md: 'text-sm px-2 py-0.5 min-w-[44px]',
    lg: 'text-lg px-3 py-1 min-w-[52px] font-bold'
  }

  return (
    <span className={cn(
      'inline-flex items-center justify-center rounded-md border font-semibold tabular-nums',
      scoreBg(score),
      scoreColor(score),
      sizeClasses[size]
    )}>
      {score.toFixed(size === 'sm' ? 1 : 2)}
    </span>
  )
}

/**
 * Overall rating row. Deliberately the same shape as the category headers below it
 * (label / bar / ScoreBadge) so it reads as one more row of the same table rather
 * than a callout -- the rank is the new information, not the styling.
 *
 * `score` is courses.quality, which is already shrunk toward the Stanford average by
 * sample size, so the number and the rank always agree.
 */
export function QualityRank({ score, percentile, rankScope }: {
  score: number
  percentile?: number | null
  rankScope?: string | null
}) {

  return (
    <div className="px-4 py-3 bg-secondary/5 rounded-lg border border-border/20">
      <div className="flex items-center gap-3">
        <span className="text-sm text-foreground font-medium flex-1 text-left">Overall rating</span>
        <div className="w-20 h-1.5 bg-secondary/60 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full', barFill(score))} style={{ width: `${(score / 5) * 100}%` }} />
        </div>
        <ScoreBadge score={score} size="sm" />
      </div>
      {percentile != null && <RankLine percentile={percentile} scope={rankScope} className="mt-1.5" />}
    </div>
  )
}

// Horizontal histogram for hours data
function HoursHistogram({ options }: { options: EvalOption[] }) {
  const buckets = useMemo(() => {
    const ranges = [
      { label: '0-5', min: 0, max: 5 },
      { label: '5-10', min: 5, max: 10 },
      { label: '10-15', min: 10, max: 15 },
      { label: '15-20', min: 15, max: 20 },
      { label: '20-25', min: 20, max: 25 },
      { label: '25-30', min: 25, max: 30 },
      { label: '30+', min: 30, max: Infinity }
    ]

    const result = ranges.map(r => ({ ...r, count: 0 }))
    for (const opt of options) {
      const val = opt.weight
      const bucket = result.find(r => val >= r.min && val < r.max)
      if (bucket) bucket.count += opt.count
    }
    return result
  }, [options])

  const maxCount = Math.max(...buckets.map(b => b.count), 1)
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0)

  return (
    <div className="flex flex-col gap-1.5">
      {/* Definite height, not flex-1: each bar sets its own height as a percentage, and a
          flex-basis parent gives percentages nothing to resolve against -- the bars
          rendered at zero height. The card still stretches; the slack sits below. */}
      {/* 160px, not 112: paired with a six or seven row enrollment chart the card gets
          stretched, and a short histogram left a slab of dead space around it. Definite
          height rather than flex-1 -- each bar's height is a percentage, which resolves
          to zero against a flex-basis parent. */}
      <div className="flex items-end gap-1 h-24">
        {buckets.map((bucket, i) => {
          const height = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
          const pct = totalCount > 0 ? ((bucket.count / totalCount) * 100).toFixed(0) : '0'
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end group relative">
              {bucket.count > 0 && (
                <span className="text-[9px] text-muted-foreground tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
                  {bucket.count} ({pct}%)
                </span>
              )}
              <div
                className="w-full rounded-t bg-primary transition-all duration-300 hover:brightness-110"
                style={{
                  height: `${Math.max(height, bucket.count > 0 ? 4 : 0)}%`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1">
        {buckets.map((bucket, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-muted-foreground tabular-nums">
            {bucket.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Who actually takes the course, by class level. Same row shape as the rating
 * breakdowns above it -- label / bar / count -- because it is the same kind of thing:
 * one distribution over named buckets.
 *
 * Levels with no students are dropped rather than drawn as empty rows: most courses
 * touch three or four of the eleven, and eight flat bars read as missing data.
 */
function ClassYearChart({ breakdown }: { breakdown: ClassYearBreakdown }) {
  const rows = useMemo(() => {
    // A bucket that rounds to 0% is dropped, not drawn: one professional student in a
    // 894-person lecture rendered as "Professional 1 (0%)", a full row of chrome for a
    // number the chart cannot even express. 625 courses had at least one such row.
    const present = CLASS_YEAR_BUCKETS
      .map(bucket => ({
        label: bucket.label,
        count: bucket.keys.reduce((sum, key) => sum + (breakdown.levels[key] || 0), 0),
      }))
      .filter(bucket => bucket.count > 0
        && Math.round((bucket.count / Math.max(breakdown.total, 1)) * 100) > 0)
    const max = Math.max(...present.map(bucket => bucket.count), 1)
    return { present, max }
  }, [breakdown])

  return (
    <div className="space-y-1">
      {rows.present.map(bucket => {
        const pct = breakdown.total > 0 ? (bucket.count / breakdown.total) * 100 : 0
        const barWidth = (bucket.count / rows.max) * 100
        return (
          <div key={bucket.label} className="flex items-center gap-2 text-sm group">
            <span className="w-24 text-right text-muted-foreground shrink-0 text-[11px] leading-tight">{bucket.label}</span>
            <div className="flex-1 h-4 bg-secondary/40 rounded overflow-hidden relative">
              {/* Floored at 4%, the same way HoursHistogram floors its bars: one dominant
                  bucket (165 of 233 professional) scaled every other row to two or three
                  pixels, so six of seven rows read as empty when they are not. The floor
                  overstates the smallest values, which is why the count and percentage
                  sit beside every bar. */}
              <div
                className="h-full rounded bg-primary transition-all duration-500 group-hover:brightness-110"
                style={{ width: `${Math.max(barWidth, 4)}%` }}
              />
            </div>
            <span className="w-20 text-right text-[11px] text-muted-foreground shrink-0 tabular-nums whitespace-nowrap transition-colors group-hover:text-foreground">
              {bucket.count} <span className="text-muted-foreground/50 group-hover:text-muted-foreground">({pct.toFixed(0)}%)</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// --- Instructor row that expands on click ---

function InstructorRow({ instructor, ratingCats, isExpanded, onToggle, evals }: {
  instructor: { name: string, scores: Partial<Record<QuestionCategory, number>>, evalCount: number, terms: string[] }
  ratingCats: QuestionCategory[]
  isExpanded: boolean
  onToggle: () => void
  evals: CourseEvaluation[]
}) {
  const instructorEvals = useMemo(
    () => evals.filter(e => e.instructor === instructor.name),
    [evals, instructor.name]
  )

  return (
    <div className="border-b border-border/30 last:border-0">
      {/* Not a <button>: the name inside is a link, and anchors can't nest in buttons. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        }}
        className={cn(
          'w-full grid gap-2 px-4 py-2.5 items-center hover:bg-secondary/20 transition-colors cursor-pointer',
          isExpanded && 'bg-secondary/10'
        )}
        style={{ gridTemplateColumns: '1fr repeat(4, minmax(40px, 52px))' }}
      >
        <div className="min-w-0 text-left">
          <Link
            href={`/instructors/${instructorSlug(instructor.name)}`}
            onClick={e => e.stopPropagation()}
            className="text-sm font-medium text-foreground truncate block underline underline-offset-2 decoration-muted-foreground/40 hover:decoration-current"
          >
            {formatInstructorName(instructor.name)}
          </Link>
          <div className="text-[10px] text-muted-foreground">
            {instructor.evalCount} {instructor.evalCount === 1 ? 'eval' : 'evals'} &middot; {instructor.terms.slice(-2).join(', ')}
          </div>
        </div>
        {ratingCats.map(cat => (
          <div key={cat} className="flex justify-center">
            {cat === 'hours' ? (
              instructor.scores.hours !== undefined ? (
                <span className="text-xs font-semibold text-foreground tabular-nums">
                  {instructor.scores.hours.toFixed(0)}h
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">--</span>
              )
            ) : (
              instructor.scores[cat] !== undefined ? (
                <ScoreBadge score={instructor.scores[cat]!} size="sm" />
              ) : (
                <span className="text-xs text-muted-foreground">--</span>
              )
            )}
          </div>
        ))}
      </div>

      {isExpanded && (
        <div className="px-4 pb-3 pt-1 space-y-2 bg-secondary/5">
          {instructorEvals.map((ev, i) => (
            <InlineEval key={i} evaluation={ev} disableComments />
          ))}
        </div>
      )}
    </div>
  )
}

// Compact inline eval card
function InlineEval({ evaluation, disableComments }: { evaluation: CourseEvaluation, disableComments?: boolean }) {
  const [showComments, setShowComments] = useState(false)
  const ratingQuestions = evaluation.questions.filter(q => q.type === 'rating')
  const hoursQ = evaluation.questions.find(q => categorizeQuestion(q.text) === 'hours')

  return (
    <div className="border border-border/40 rounded-lg bg-card/60 overflow-hidden">
      <div className="grid items-center gap-2 px-3 py-2" style={{ gridTemplateColumns: 'auto 1fr auto auto auto' }}>
        <span className="text-xs font-medium text-foreground w-24 shrink-0">{evaluation.term}</span>
        <span className="text-[10px] text-muted-foreground truncate">{evaluation.respondents}</span>
        <div className="flex items-center gap-1">
          {ratingQuestions.slice(0, 4).map((q, i) => (
            <ScoreBadge key={i} score={q.median} size="sm" />
          ))}
        </div>
        {hoursQ && typeof hoursQ.median === 'number' ? (
          <span className="text-[10px] font-semibold text-foreground tabular-nums w-14 text-right">
            {hoursQ.median.toFixed(0)} hrs/wk
          </span>
        ) : (
          <span className="w-14" />
        )}
        {evaluation.comments.length > 0 ? (
          disableComments ? (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 text-muted-foreground w-12 justify-end">
              <MessageSquare size={10} />
              {evaluation.comments.length}
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowComments(!showComments) }}
              className={cn(
                'flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-colors w-12 justify-end',
                showComments
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
              )}
            >
              <MessageSquare size={10} />
              {evaluation.comments.length}
            </button>
          )
        ) : (
          <span className="w-12" />
        )}
      </div>

      {!disableComments && showComments && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1.5 max-h-40 overflow-y-auto">
          {evaluation.comments.map((c, i) => (
            <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              &ldquo;<CommentText text={c} />&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  )
}


/** A comment's prose, with any URL in it clickable. Comments are plain text, never markup. */
function CommentText({ text }: { text: string }) {
  return (
    <>
      {splitLinkSegments(decodeHtmlEntities(text)).map((seg, i) =>
        seg.href ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium underline underline-offset-2 hover:opacity-80 break-words"
          >
            {seg.text}
          </a>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </>
  )
}

// --- Comments panel ---

export interface CommentEntry {
  text: string
  /** Where the comment came from, e.g. "CS 106A". Shown when one list mixes courses. */
  label?: string
}

export function CommentsPanel({ comments }: { comments: CommentEntry[] }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(10)

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return comments

    const q = searchQuery.toLowerCase()
    return comments.filter(c =>
      decodeHtmlEntities(c.text).toLowerCase().includes(q) ||
      c.label?.toLowerCase().includes(q))
  }, [comments, searchQuery])

  if (comments.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No comments available.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">Search Keywords</div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setVisibleCount(10) }}
            placeholder="Search comments..."
            className="w-full bg-secondary/30 border border-border/40 rounded-lg pl-8 pr-3 py-2 text-base md:text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {searchQuery ? `${filtered.length} of ${comments.length} comments` : `${comments.length} comments`}
      </div>

      <div className="space-y-2 pr-1">
        {(() => {
          const remaining = filtered.length - visibleCount
          const showAll = remaining <= 9 && remaining > 0
          const displayCount = showAll ? filtered.length : visibleCount
          return filtered.slice(0, displayCount).map((comment, i) => (
            <div
              key={i}
              // No hover highlight: the card is not clickable, and the highlight
              // read as an affordance. Students clicked the same comment
              // repeatedly waiting for it to do something — one session logged
              // 107 clicks in 29.3s on a single ECON 11N comment.
              className="text-sm text-muted-foreground bg-secondary/15 rounded-lg px-4 py-3 border border-border/20 leading-relaxed"
            >
              {comment.label && (
                <div className="text-[11px] font-bold text-destructive mb-1">{comment.label}</div>
              )}
              &ldquo;<CommentText text={comment.text} />&rdquo;
            </div>
          ))
        })()}
      </div>

      {(() => {
        const remaining = filtered.length - visibleCount
        if (remaining <= 0) return null
        if (remaining <= 9) return null
        return (
          <button
            type="button"
            onClick={() => setVisibleCount(prev => prev + 20)}
            className="w-full text-center text-xs text-primary hover:underline font-medium py-2 mt-4"
          >
            Show more ({remaining} remaining)
          </button>
        )
      })()}
    </div>
  )
}

// Aggregated rating breakdown across multiple questions of the same category
function AggregatedRatingBreakdown({ questions, aggregateScore }: { questions: EvalQuestion[], aggregateScore: number }) {
  const mergedOptions = useMemo(() => {
    const map: Record<string, { text: string, weight: number, count: number }> = {}
    for (const q of questions) {
      for (const opt of q.options) {
        if (!map[opt.text]) {
          map[opt.text] = { text: opt.text, weight: opt.weight, count: 0 }
        }
        map[opt.text].count += opt.count
      }
    }
    return Object.values(map).sort((a, b) => b.weight - a.weight)
  }, [questions])

  const totalCount = useMemo(() => mergedOptions.reduce((sum, o) => sum + o.count, 0), [mergedOptions])
  const maxCount = useMemo(() => Math.max(...mergedOptions.map(o => o.count), 1), [mergedOptions])

  const cat = categorizeQuestion(questions[0].text)
  const label = cat !== 'unknown' ? CATEGORY_LABELS[cat] : questions[0].text

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {mergedOptions.map((opt, i) => {
          const pct = totalCount > 0 ? (opt.count / totalCount) * 100 : 0
          const barWidth = maxCount > 0 ? (opt.count / maxCount) * 100 : 0
          return (
            <div key={i} className="flex items-center gap-2 text-sm group">
              <span className="w-32 text-right text-muted-foreground shrink-0 text-[11px] leading-tight">{decodeHtmlEntities(opt.text)}</span>
              <div className="flex-1 h-4 bg-secondary/40 rounded overflow-hidden relative">
                <div
                  className={cn('h-full rounded transition-all duration-500', barFill(aggregateScore))}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="w-20 text-right text-[11px] text-muted-foreground shrink-0 tabular-nums whitespace-nowrap transition-colors group-hover:text-foreground">
                {opt.count} <span className="text-muted-foreground/50">({pct.toFixed(0)}%)</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Median score per category with an expandable response breakdown for each. */
export function EvaluationOverview({ evaluations: rawEvaluations, quality, qualityPct, rankScope, breakdown, classYears, termFiltered }: {
  evaluations: CourseEvaluation[]
  /**
   * courses.quality / quality_pct / rating_breakdown -- precomputed over the course's
   * whole history. Neither the shrinkage prior nor the percentile can be derived from one
   * course's rows, so callers showing a subset omit these and each row falls back to the
   * unranked mean of what's on screen rather than mislabelling it.
   */
  quality?: number | null
  qualityPct?: number | null
  /** courses.rank_scope: the subject `qualityPct` was ranked within, null = all of Stanford. */
  rankScope?: string | null
  breakdown?: Course['ratingBreakdown'] | null
  /**
   * Carta's class-level breakdown, summed across the cross-list group. Pooled over
   * Carta's whole record with no way to slice it by term, so callers pass null when a
   * term filter is active -- same rule as `breakdown` above.
   */
  classYears?: ClassYearBreakdown | null
  /**
   * A single quarter is selected. The whole-history numbers are withheld upstream, so
   * there is no overall rating, no percentile and no class breakdown -- which leaves
   * four things to show, and they read better as a 2x2 of panels than as a table with
   * three rows and an empty rank column.
   */
  termFiltered?: boolean
}) {
  // A co-taught section files the same course-level answers once per instructor, so the
  // charts counted those students once per instructor too -- the same duplication the
  // headline rating de-duplicates server-side. Both must use the same rule or the bars
  // add up to more responses than the rating claims.
  const evaluations = useMemo(() => dedupeCourseLevelReports(rawEvaluations), [rawEvaluations])
  const metrics = useMemo(() => aggregateMetrics(evaluations), [evaluations])

  const questionsByCategory = useMemo(() => {
    const map: Record<QuestionCategory, EvalQuestion[]> = {
      quality: [], learning: [], organization: [], goals: [],
      hours: [], attendance_in_person: [], attendance_online: [], unknown: []
    }
    for (const ev of evaluations) {
      for (const q of ev.questions) {
        map[categorizeQuestion(q.text)].push(q)
      }
    }
    return map
  }, [evaluations])

  // Nothing preselected: the workload histogram is always visible in its own section
  // now, so there is no empty column to fill on arrival.
  const [openCat, setOpenCat] = useState<QuestionCategory | null>(null)
  const hasClassYears = Boolean(classYears && classYears.total > 0)

  const hoursQuestions = questionsByCategory.hours
  const hasEnrollment = Boolean(hasClassYears && classYears)
  // A term filter withholds every percentile, so the rank column collapses rather than
  // sitting empty -- but the layout no longer changes with it.
  const hasRanks = qualityPct != null
    || RATING_CATEGORIES.some(cat => breakdown?.[cat as 'quality' | 'learning' | 'organization']?.pct != null)

  const hoursPanel = metrics.hours === undefined ? null : (() => {
    const stats = optionStats(hoursQuestions.flatMap(q => q.options))
    return (
      <PanelSection
        label="Hours per week"
        value={`${metrics.hours!.toFixed(1)} hrs/wk`}
        note={stats ? `median ${stats.median} · mean ${stats.mean.toFixed(1)} · SD ${stats.sd.toFixed(1)}` : undefined}
      >
        <div className="px-4 py-3">
          <HoursHistogram options={hoursQuestions.flatMap(q => q.options)} />
        </div>
      </PanelSection>
    )
  })()

  // A single quarter: one panel per category in a 2x2 -- instruction quality, learning,
  // organization, hours -- each showing its own response breakdown, so nothing needs
  // opening. A quarter has no overall rating, no percentile and no class breakdown (the
  // whole-history numbers are withheld upstream), which is what leaves room for four.
  if (termFiltered) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {(['quality', 'learning', 'organization'] as QuestionCategory[]).map(cat => {
          if (metrics[cat] === undefined) return null
          const score = metrics[cat]!
          return (
            <PanelSection key={cat} label={CATEGORY_LABELS[cat]} value={score.toFixed(1)}>
              <div className="px-4 py-3">
                <AggregatedRatingBreakdown questions={questionsByCategory[cat]} aggregateScore={score} />
              </div>
            </PanelSection>
          )
        })}
        {hoursPanel}
      </div>
    )
  }

  // The all view, unchanged from before: three full-width bands stacked -- the ratings
  // table with its rank column, the class breakdown, then hours.
  return (
    <div className="space-y-4">
      <PanelSection label="Student ratings">
        {quality != null && (
          <ScoreRow label="Overall rating" score={quality} percentile={qualityPct} rankScope={rankScope} emphasis showRank={hasRanks} />
        )}
        {RATING_CATEGORIES.filter(cat => cat !== 'hours').map(cat => {
          if (metrics[cat] === undefined) return null
          const stat = breakdown?.[cat as 'quality' | 'learning' | 'organization']
          const score = stat?.score ?? metrics[cat]!
          const isOpen = openCat === cat
          return (
            <div key={cat}>
              <ScoreRow
                label={CATEGORY_LABELS[cat]}
                score={score}
                percentile={stat?.pct}
                rankScope={stat?.scope}
                questions={questionsByCategory[cat]}
                isOpen={isOpen}
                onToggle={() => setOpenCat(isOpen ? null : cat)}
                showRank={hasRanks}
              />
              {isOpen && (
                <div className="px-4 pb-4 pt-1 bg-secondary/[0.06]">
                  <AggregatedRatingBreakdown questions={questionsByCategory[cat]} aggregateScore={score} />
                </div>
              )}
            </div>
          )
        })}
      </PanelSection>

      {/* Paired when both exist, and hours takes the full width when it is alone -- a
          lone half-width histogram left a gap beside it. */}
      {hasEnrollment && classYears ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <PanelSection label="Enrollment by year" value={`${classYears.total} students`}>
            <div className="px-4 py-3">
              <ClassYearChart breakdown={classYears} />
            </div>
          </PanelSection>
          {hoursPanel}
        </div>
      ) : hoursPanel}
    </div>
  )
}

/**
 * One band of the panel: a quiet header strip, then its content. Sections carry their own
 * headline on the right, which is what lets the panel be read at a glance without opening
 * anything.
 */
function PanelSection({ label, value, note, children, className }: {
  label: string
  value?: string
  note?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('border border-border/40 rounded-xl overflow-hidden flex flex-col', className)}>
      <header className="flex items-baseline gap-3 px-4 py-2.5 bg-secondary/[0.07] border-b border-border/30">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {note && <span className="flex-1 text-[11px] text-muted-foreground tabular-nums truncate">{note}</span>}
        {!note && <span className="flex-1" />}
        {value && <span className="text-sm font-bold text-foreground tabular-nums shrink-0">{value}</span>}
      </header>
      {/* Top-aligned, not centred: with a shared minimum height the slack has to go
          somewhere, and centring it split the gap above the first row so the header's
          border stopped sitting flush against it. */}
      <div className="flex-1 flex flex-col">{children}</div>
    </section>
  )
}

/**
 * One row of the score table. The three rating categories are the same shape of thing
 * measured three times, so they read as rows of one table rather than as three cards --
 * which is also what frees the full width for the two charts below.
 */
function ScoreRow({ label, score, percentile, rankScope, valueLabel, questions, isOpen, onToggle, emphasis, showRank = true }: {
  label: string
  /** Drives the bar and the badge. Omitted for rows that are not on the 1-5 scale. */
  score?: number
  percentile?: number | null
  /** Peer group `percentile` was measured in. Null/undefined = all rated Stanford courses. */
  rankScope?: string | null
  /** Replaces the score badge, e.g. "10.0 hrs/wk". */
  valueLabel?: string
  questions?: EvalQuestion[]
  isOpen?: boolean
  onToggle?: () => void
  emphasis?: boolean
  /** False when no row in the table has a percentile, so the column is not reserved. */
  showRank?: boolean
}) {
  const expandable = Boolean(onToggle && questions && questions.length > 0)

  const row = (
    <>
      <span className={cn('flex-1 text-left text-foreground text-sm truncate', emphasis ? 'font-semibold' : 'font-medium')}>
        {label}
      </span>
      {/* One fixed column for the sentence, so every row's bar and value line up and the
          share keeps the rankColor scale -- a bare "71%" beside a bar says nothing. */}
      {/* Dropped entirely, not left blank: a term filter withholds every percentile, and
          the reserved column left each row as a label and a number with a void between. */}
      {showRank && (
      <span className="hidden sm:block text-[11px] text-muted-foreground w-72 text-right shrink-0 whitespace-nowrap">
        {percentile != null && (
          <RankSentence percentile={percentile} scope={rankScope} shareClass="text-[13px]" />
        )}
      </span>
      )}
      {score != null ? (
        <div className="w-24 h-1.5 bg-secondary/60 rounded-full overflow-hidden shrink-0">
          <div className={cn('h-full rounded-full', barFill(score))} style={{ width: `${(score / 5) * 100}%` }} />
        </div>
      ) : (
        <div className="w-24 shrink-0" aria-hidden />
      )}
      <span className="w-24 shrink-0 flex justify-end">
        {valueLabel
          ? <span className="text-sm font-bold text-foreground tabular-nums">{valueLabel}</span>
          : score != null && <ScoreBadge score={score} size={emphasis ? 'md' : 'sm'} />}
      </span>
      <span className="w-4 shrink-0 flex items-center justify-center">
        {expandable && (isOpen
          ? <ChevronUp size={14} className="text-muted-foreground" />
          : <ChevronDown size={14} className="text-muted-foreground" />)}
      </span>
    </>
  )

  return (
    <div className={cn(
      'border-b border-border/30 last:border-0',
      emphasis && 'bg-secondary/10 border-b-border/50',
    )}>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="w-full flex items-center gap-4 px-4 py-2.5 hover:bg-secondary/20 transition-colors"
        >
          {row}
        </button>
      ) : (
        <div className={cn('w-full flex items-center gap-4 px-4', emphasis ? 'py-3' : 'py-2.5')}>{row}</div>
      )}
    </div>
  )
}


/** Shared sign-in prompt for the Stanford-only evaluation data. */
export function EvalLoginGate({ title = 'Course reviews are Stanford-only' }: { title?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 gap-3 border border-border/50 rounded-xl bg-secondary/10">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Lock size={18} className="text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          Log in with your Stanford account to view student evaluations, ratings, and comments.
        </p>
      </div>
      <StanfordLoginButton
        source="eval_gate"
        signingInLabel="Redirecting to Stanford…"
        className="mt-1 inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] gap-2 h-auto"
      />
    </div>
  )
}

// --- Main Component ---

type EvalTab = 'overview' | 'instructors' | 'comments'


interface CourseEvaluationsProps {
  /** All course IDs in the cross-list group (e.g. CS 24, LINGUIST 35, BILL 99). Chart/comments include data from all. */
  courseIds: string[]
  subject: string
  code: string
  forcedTab?: 'overview' | 'instructors' | 'comments'
  /**
   * Whether the catalog dump flagged this cross-list group as first-time-offered:
   * true swaps the empty state from "our records start in 2021" to "new course",
   * `undefined` means the catalog hasn't loaded yet and the empty state must wait
   * rather than assert either. Required (not optional) so a caller can't leave it
   * unresolved by accident and hang the empty state on a spinner.
   */
  isNew: boolean | undefined
  /** courses.quality / quality_pct / rank_scope -- the overall rating row. */
  quality?: number | null
  qualityPct?: number | null
  rankScope?: string | null
  ratingBreakdown?: Course['ratingBreakdown'] | null
  /**
   * Term filter, lifted out so it survives a tab switch. The Charts and Comments tabs
   * are two separate instances of this component and Radix unmounts the inactive one,
   * so state held here was lost the moment you moved between them.
   */
  termFilter?: string
  onTermFilterChange?: (term: string) => void
}

export function CourseEvaluations({ courseIds, subject, code, forcedTab, isNew, quality, qualityPct, rankScope, ratingBreakdown, termFilter, onTermFilterChange }: CourseEvaluationsProps) {
  const fetchBulkEvaluations = useEvaluationStore(state => state.fetchBulkEvaluations)
  const fetchBulkClassYears = useEvaluationStore(state => state.fetchBulkClassYears)
  const getMergedClassYears = useEvaluationStore(state => state.getMergedClassYears)
  const classYearsById = useEvaluationStore(state => state.classYears)
  const getMergedEvaluations = useEvaluationStore(state => state.getMergedEvaluations)
  const loadingCourses = useEvaluationStore(state => state.loadingCourses)
  const errorCourses = useEvaluationStore(state => state.errorCourses)
  const evaluationsById = useEvaluationStore(state => state.evaluations)
  const user = useAuthStore(state => state.user)
  const authLoading = useAuthStore(state => state.isLoading)
  const canViewEvals = Boolean(user) || isDevEvalsUnlocked()
  // Controlled when the parent supplies a filter; self-managed otherwise.
  const [ownTermFilter, setOwnTermFilter] = useState<string>('all')
  const activeTermFilter = termFilter ?? ownTermFilter
  const setActiveTermFilter = onTermFilterChange ?? setOwnTermFilter
  const [activeTab, setActiveTab] = useState<EvalTab>(forcedTab || 'overview')
  const [expandedInstructor, setExpandedInstructor] = useState<string | null>(null)
  const [expandedQuestion, setExpandedQuestion] = useState<QuestionCategory | null>(null)

  useEffect(() => {
    if (forcedTab) {
      setActiveTab(forcedTab)
    }
  }, [forcedTab])

  // Until the class-year answer is known, `hasClassYears` reads false, Hours takes the
  // full width, and the card then arrives and squeezes it back to half -- a visible jump
  // on the 46% of courses that have data. The class-year request is the faster of the
  // two (142ms against 240-360ms for evaluations), so waiting for it costs nothing
  // measurable and removes the shift entirely.
  const classYearsPending = courseIds.some(id => !(id in classYearsById))
  const isLoading = courseIds.some(id => !!loadingCourses[id]) || classYearsPending
  const hasError = courseIds.some(id => !!errorCourses[id])
  const evaluations = useMemo(() => getMergedEvaluations(courseIds), [getMergedEvaluations, courseIds, evaluationsById])

  const courseIdsKey = courseIds.join(',')
  useEffect(() => {
    if (canViewEvals && courseIds.length > 0) {
      fetchBulkEvaluations(courseIds)
      fetchBulkClassYears(courseIds)
    }
  }, [courseIdsKey, fetchBulkEvaluations, fetchBulkClassYears, canViewEvals])

  const classYears = useMemo(
    () => getMergedClassYears(courseIds),
    [getMergedClassYears, courseIds, classYearsById]
  )

  useEffect(() => {
    if (!authLoading && !canViewEvals) track('eval_gate_viewed', { subject, code })
  }, [authLoading, canViewEvals, subject, code])

  // Unique terms (newest first)
  const evalTerms = useMemo(() => {
    const terms = [...new Set(evaluations.map(e => e.term))].sort((a, b) => compareTerms(b, a))
    return terms
  }, [evaluations])

  // The pill counts are reports, so they must not count a co-taught section once per
  // instructor -- that is why every term read "(2)" on a class with two listed teachers.
  const distinctReports = useMemo(() => dedupeCourseLevelReports(evaluations), [evaluations])

  const filteredEvals = useMemo(() => {
    if (activeTermFilter === 'all') return evaluations
    return evaluations.filter(e => e.term === activeTermFilter)
  }, [evaluations, activeTermFilter])

  const instructors = useMemo(() => computeInstructorStats(filteredEvals), [filteredEvals])
  const allComments = useMemo(() => {
    // De-dupe identical comments that can appear across multiple evaluation records
    // (e.g. cross-listed or co-taught offerings sharing the same comment pool).
    const seen = new Set<string>()
    const out: CommentEntry[] = []
    for (const e of filteredEvals) {
      for (const c of e.comments) {
        const key = decodeHtmlEntities(c).trim().toLowerCase()
        if (key && !seen.has(key)) {
          seen.add(key)
          out.push({ text: c })
        }
      }
    }
    return out
  }, [filteredEvals])
  const hasMultipleInstructors = instructors.length > 1

  const handleTermFilterChange = useCallback((term: string) => {
    setActiveTermFilter(term)
    setExpandedInstructor(null)
    setExpandedQuestion(null)
    // If switching to a term and on instructors tab but only 1 instructor for that filter, go to overview
    if (activeTab === 'instructors') {
      setActiveTab('overview')
    }
  }, [activeTab])

  // Gated: course evaluations are Stanford-login-only (dev bypass via NEXT_PUBLIC_DEV_UNLOCK_EVALS)
  if (!canViewEvals) {
    if (authLoading) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading evaluations...</span>
        </div>
      )
    }
    return <EvalLoginGate />
  }

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading evaluations...</span>
      </div>
    )
  }

  // Error
  if (hasError) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Could not load evaluation data.
      </div>
    )
  }

  // No data
  if (evaluations.length === 0) {
    // `isNew` rides on the client-side catalog, not the server-fetched course
    // row, so on a hard load it is unresolved for a moment. Keep spinning rather
    // than flash the 2021 line at a course that turns out to be new.
    if (isNew === undefined) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading evaluations...</span>
        </div>
      )
    }
    // A first-time offering has no evaluations anywhere, so pointing at our
    // 2021 cutoff (or at EvaluationKit) would imply data we just don't show.
    if (isNew) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm">This is a new course, so there are no evaluations yet.</p>
        </div>
      )
    }
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-muted-foreground text-sm">No evaluation data found. Note: Our records only go back to <strong>Fall 2021</strong>.</p>
        <a
          href={`https://stanford.evaluationkit.com/Report/Public/Results?Course=${encodeURIComponent(subject + ' ' + code)}&Search=true`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-full transition-colors"
        >
          Search EvaluationKit for previous quarters
          <ExternalLink size={12} />
        </a>
      </div>
    )
  }

  const ratingCats = RATING_CATEGORIES
  const tabItems: { key: EvalTab, label: string, count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    ...(hasMultipleInstructors ? [{ key: 'instructors' as EvalTab, label: 'Instructors', count: instructors.length }] : []),
    { key: 'comments', label: 'Comments', count: allComments.length }
  ]

  return (
    <div className="space-y-4">
      {/* Term filter pills */}
      {evalTerms.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleTermFilterChange('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              activeTermFilter === 'all'
                ? 'bg-foreground text-background'
                : 'bg-secondary/50 hover:bg-secondary text-muted-foreground'
            )}
          >
            All ({distinctReports.length})
          </button>
          {evalTerms.map(term => {
            const count = distinctReports.filter(e => e.term === term).length
            return (
              <button
                key={term}
                type="button"
                onClick={() => handleTermFilterChange(term)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  activeTermFilter === term
                    ? 'bg-foreground text-background'
                    : 'bg-secondary/50 hover:bg-secondary text-muted-foreground'
                )}
              >
                {term} {count > 1 ? `(${count})` : ''}
              </button>
            )
          })}
        </div>
      )}

      {/* Tab navigation - only show if no forcedTab */}
      {!forcedTab && (
        <div className="flex border-b border-border/50">
          {tabItems.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors relative',
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="text-[10px] text-muted-foreground ml-1">({tab.count})</span>
              )}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="min-h-[200px]">

        {/* === Overview tab === */}
        {activeTab === 'overview' && (
          <EvaluationOverview
            evaluations={filteredEvals}
            // Computed over the course's whole history, so it would not describe the
            // breakdown beside it once a single term is selected.
            quality={activeTermFilter === 'all' ? quality : null}
            qualityPct={activeTermFilter === 'all' ? qualityPct : null}
            rankScope={rankScope}
            breakdown={activeTermFilter === 'all' ? ratingBreakdown : null}
            classYears={activeTermFilter === 'all' ? classYears : null}
            termFiltered={activeTermFilter !== 'all'}
          />
        )}

        {/* === Instructors tab (only with 2+ instructors) === */}
        {activeTab === 'instructors' && hasMultipleInstructors && (
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div
              className="grid gap-2 px-4 py-2.5 bg-secondary/30 border-b border-border/40"
              style={{ gridTemplateColumns: '1fr repeat(4, minmax(40px, 52px))' }}
            >
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Instructor</div>
              {ratingCats.map(cat => (
                <div key={cat} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">
                  {CATEGORY_SHORT[cat]}
                </div>
              ))}
            </div>

            {instructors.map(inst => (
              <InstructorRow
                key={inst.name}
                instructor={inst}
                ratingCats={ratingCats}
                isExpanded={expandedInstructor === inst.name}
                onToggle={() => setExpandedInstructor(expandedInstructor === inst.name ? null : inst.name)}
                evals={filteredEvals}
              />
            ))}
          </div>
        )}

        {/* === Comments tab === */}
        {activeTab === 'comments' && (
          <CommentsPanel comments={allComments} />
        )}
      </div>

      {/* Footer link */}

    </div >
  )
}
