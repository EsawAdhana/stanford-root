'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useEvaluationStore } from '@/lib/evaluation-store'
import {
  Loader2, ChevronDown, ChevronUp, MessageSquare,
  ExternalLink, Clock, Search, X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CourseEvaluation, EvalQuestion, EvalOption } from '@/types/course'

// --- Color helpers (green=good, yellow/orange=mid, red=bad) ---

function scoreColor (score: number): string {
  if (score >= 4.5) return 'text-emerald-600'
  if (score >= 4.0) return 'text-green-600'
  if (score >= 3.5) return 'text-yellow-600'
  if (score >= 3.0) return 'text-orange-600'
  return 'text-red-600'
}

function scoreBg (score: number): string {
  if (score >= 4.5) return 'bg-emerald-500/12 border-emerald-500/25'
  if (score >= 4.0) return 'bg-green-500/12 border-green-500/25'
  if (score >= 3.5) return 'bg-yellow-500/12 border-yellow-500/25'
  if (score >= 3.0) return 'bg-orange-500/12 border-orange-500/25'
  return 'bg-red-500/12 border-red-500/25'
}

function barFill (score: number): string {
  if (score >= 4.5) return 'bg-emerald-500'
  if (score >= 4.0) return 'bg-green-500'
  if (score >= 3.5) return 'bg-yellow-500'
  if (score >= 3.0) return 'bg-orange-500'
  return 'bg-red-500'
}

// --- Question categorization ---

type QuestionCategory = 'quality' | 'learning' | 'organization' | 'goals' | 'hours' | 'attendance_in_person' | 'attendance_online' | 'unknown'

function categorizeQuestion (text: string): QuestionCategory {
  const t = text.toLowerCase()
  if (t.includes('quality') || t.includes('overall')) return 'quality'
  if (t.includes('how much did you learn')) return 'learning'
  if (t.includes('organized')) return 'organization'
  if (t.includes('learning goals')) return 'goals'
  if (t.includes('hours per week')) return 'hours'
  if (t.includes('percent') && t.includes('in person')) return 'attendance_in_person'
  if (t.includes('percent') && t.includes('online')) return 'attendance_online'
  return 'unknown'
}

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  quality: 'Instruction Quality',
  learning: 'Learning',
  organization: 'Organization',
  goals: 'Goals Achieved',
  hours: 'Hours / Week',
  attendance_in_person: 'In-Person Attendance',
  attendance_online: 'Online Attendance',
  unknown: 'Other'
}

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

function parseRespondentCount (respondents: string): number {
  const match = respondents.match(/(\d+)\s+of\s+(\d+)/)
  if (match) return parseInt(match[1], 10)
  const simpleMatch = respondents.match(/(\d+)/)
  return simpleMatch ? parseInt(simpleMatch[1], 10) : 1
}

// --- Aggregation ---

function aggregateMetrics (evals: CourseEvaluation[]) {
  const sums: Record<QuestionCategory, { total: number, weight: number }> = {
    quality: { total: 0, weight: 0 },
    learning: { total: 0, weight: 0 },
    organization: { total: 0, weight: 0 },
    goals: { total: 0, weight: 0 },
    hours: { total: 0, weight: 0 },
    attendance_in_person: { total: 0, weight: 0 },
    attendance_online: { total: 0, weight: 0 },
    unknown: { total: 0, weight: 0 }
  }

  for (const ev of evals) {
    const w = parseRespondentCount(ev.respondents)
    for (const q of ev.questions) {
      const cat = categorizeQuestion(q.text)
      sums[cat].total += q.mean * w
      sums[cat].weight += w
    }
  }

  const result: Partial<Record<QuestionCategory, number>> = {}
  for (const [cat, { total, weight }] of Object.entries(sums)) {
    if (weight > 0) result[cat as QuestionCategory] = total / weight
  }
  return result
}

function computeInstructorStats (evals: CourseEvaluation[]) {
  const byInstructor: Record<string, { scores: Record<QuestionCategory, { total: number, weight: number }>, evalCount: number, terms: Set<string> }> = {}

  for (const ev of evals) {
    const name = ev.instructor
    if (!byInstructor[name]) {
      byInstructor[name] = {
        scores: {
          quality: { total: 0, weight: 0 },
          learning: { total: 0, weight: 0 },
          organization: { total: 0, weight: 0 },
          goals: { total: 0, weight: 0 },
          hours: { total: 0, weight: 0 },
          attendance_in_person: { total: 0, weight: 0 },
          attendance_online: { total: 0, weight: 0 },
          unknown: { total: 0, weight: 0 }
        },
        evalCount: 0,
        terms: new Set()
      }
    }
    byInstructor[name].evalCount++
    byInstructor[name].terms.add(ev.term)
    const w = parseRespondentCount(ev.respondents)
    for (const q of ev.questions) {
      const cat = categorizeQuestion(q.text)
      byInstructor[name].scores[cat].total += q.mean * w
      byInstructor[name].scores[cat].weight += w
    }
  }

  return Object.entries(byInstructor).map(([name, data]) => {
    const scores: Partial<Record<QuestionCategory, number>> = {}
    for (const [cat, { total, weight }] of Object.entries(data.scores)) {
      if (weight > 0) scores[cat as QuestionCategory] = total / weight
    }
    return { name, scores, evalCount: data.evalCount, terms: Array.from(data.terms) }
  }).sort((a, b) => (b.scores.quality || 0) - (a.scores.quality || 0))
}

// --- Sub-components ---

function ScoreBadge ({ score, size = 'md' }: { score: number, size?: 'sm' | 'md' | 'lg' }) {
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

// Horizontal histogram for hours data
function HoursHistogram ({ options }: { options: EvalOption[] }) {
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
    <div className="space-y-1.5">
      <div className="flex items-end gap-1 h-20">
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
                className="w-full bg-foreground/30 rounded-t transition-all duration-300 group-hover:bg-foreground/50"
                style={{ height: `${Math.max(height, bucket.count > 0 ? 4 : 0)}%` }}
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
      <div className="text-center text-[9px] text-muted-foreground/60">hours per week</div>
    </div>
  )
}

// --- Instructor row that expands on click ---

function InstructorRow ({ instructor, ratingCats, isExpanded, onToggle, evals }: {
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
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full grid gap-2 px-4 py-2.5 items-center hover:bg-secondary/20 transition-colors',
          isExpanded && 'bg-secondary/10'
        )}
        style={{ gridTemplateColumns: '1fr repeat(5, minmax(40px, 52px))' }}
      >
        <div className="min-w-0 text-left">
          <div className="text-sm font-medium text-foreground truncate">
            {instructor.name.split(', ').reverse().join(' ')}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {instructor.evalCount} {instructor.evalCount === 1 ? 'eval' : 'evals'} &middot; {instructor.terms.slice(-2).join(', ')}
          </div>
        </div>
        {ratingCats.map(cat => (
          <div key={cat} className="flex justify-center">
            {instructor.scores[cat] !== undefined ? (
              <ScoreBadge score={instructor.scores[cat]!} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">--</span>
            )}
          </div>
        ))}
        <div className="flex justify-center">
          {instructor.scores.hours !== undefined ? (
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {instructor.scores.hours.toFixed(0)}h
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          )}
        </div>
      </button>

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
function InlineEval ({ evaluation, disableComments }: { evaluation: CourseEvaluation, disableComments?: boolean }) {
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
            <ScoreBadge key={i} score={q.mean} size="sm" />
          ))}
        </div>
        {hoursQ ? (
          <span className="text-[10px] font-semibold text-foreground tabular-nums w-14 text-right">
            {hoursQ.mean.toFixed(0)} hrs/wk
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
              &ldquo;{c}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Comments panel ---

function CommentsPanel ({ comments }: { comments: string[] }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(10)

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return comments
    const q = searchQuery.toLowerCase()
    return comments.filter(c => c.toLowerCase().includes(q))
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
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setVisibleCount(10) }}
          placeholder="Search comments..."
          className="w-full bg-secondary/30 border border-border/40 rounded-lg pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
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

      <div className="text-[11px] text-muted-foreground">
        {searchQuery ? `${filtered.length} of ${comments.length} comments` : `${comments.length} comments`}
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {filtered.slice(0, visibleCount).map((comment, i) => (
          <div
            key={i}
            className="text-sm text-muted-foreground bg-secondary/15 rounded-lg px-4 py-3 border border-border/20 leading-relaxed hover:bg-secondary/25 transition-colors"
          >
            &ldquo;{comment}&rdquo;
          </div>
        ))}
      </div>

      {filtered.length > visibleCount && (
        <button
          type="button"
          onClick={() => setVisibleCount(prev => prev + 20)}
          className="w-full text-center text-xs text-primary hover:underline font-medium py-2"
        >
          Show more ({filtered.length - visibleCount} remaining)
        </button>
      )}
    </div>
  )
}

// Aggregated rating breakdown across multiple questions of the same category
function AggregatedRatingBreakdown ({ questions, aggregateScore }: { questions: EvalQuestion[], aggregateScore: number }) {
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
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <ScoreBadge score={aggregateScore} size="md" />
      </div>
      <div className="space-y-1">
        {mergedOptions.map((opt, i) => {
          const pct = totalCount > 0 ? (opt.count / totalCount) * 100 : 0
          const barWidth = maxCount > 0 ? (opt.count / maxCount) * 100 : 0
          return (
            <div key={i} className="flex items-center gap-2 text-sm group">
              <span className="w-24 text-right text-muted-foreground shrink-0 text-[11px] leading-tight">{opt.text}</span>
              <div className="flex-1 h-4 bg-secondary/40 rounded overflow-hidden relative">
                <div
                  className={cn('h-full rounded transition-all duration-500', barFill(aggregateScore))}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="w-14 text-right text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {opt.count} <span className="text-muted-foreground/50">({pct.toFixed(0)}%)</span>
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{totalCount} total responses across {questions.length} evals</span>
      </div>
    </div>
  )
}

// --- Main Component ---

type EvalTab = 'overview' | 'instructors' | 'comments'

interface CourseEvaluationsProps {
  courseId: string
  subject: string
  code: string
}

export function CourseEvaluations ({ courseId, subject, code }: CourseEvaluationsProps) {
  const { fetchCourseEvaluations, getEvaluations, isLoadingCourse, hasErrorForCourse } = useEvaluationStore()
  const [activeTermFilter, setActiveTermFilter] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<EvalTab>('overview')
  const [expandedInstructor, setExpandedInstructor] = useState<string | null>(null)
  const [expandedQuestion, setExpandedQuestion] = useState<QuestionCategory | null>(null)

  const isLoading = isLoadingCourse(courseId)
  const hasError = hasErrorForCourse(courseId)
  const evaluations = getEvaluations(courseId)

  useEffect(() => {
    fetchCourseEvaluations(courseId)
  }, [courseId, fetchCourseEvaluations])

  // Unique terms (newest first)
  const evalTerms = useMemo(() => {
    const terms = [...new Set(evaluations.map(e => e.term))].sort((a, b) => {
      const parseTermYear = (t: string) => {
        const parts = t.split(' ')
        const year = parseInt(parts[parts.length - 1], 10)
        const order = ['Winter', 'Spring', 'Summer', 'Autumn', 'Fall']
        const seasonIdx = order.findIndex(s => t.toLowerCase().includes(s.toLowerCase()))
        return (year * 10) + (seasonIdx >= 0 ? seasonIdx : 0)
      }
      return parseTermYear(b) - parseTermYear(a)
    })
    return terms
  }, [evaluations])

  const filteredEvals = useMemo(() => {
    if (activeTermFilter === 'all') return evaluations
    return evaluations.filter(e => e.term === activeTermFilter)
  }, [evaluations, activeTermFilter])

  const metrics = useMemo(() => aggregateMetrics(filteredEvals), [filteredEvals])
  const instructors = useMemo(() => computeInstructorStats(filteredEvals), [filteredEvals])
  const allComments = useMemo(() => filteredEvals.flatMap(e => e.comments), [filteredEvals])
  const hasMultipleInstructors = instructors.length > 1

  // Hours question for histogram (pick first available)
  const representativeHoursQuestion = useMemo(() => {
    for (const ev of filteredEvals) {
      for (const q of ev.questions) {
        if (categorizeQuestion(q.text) === 'hours') return q
      }
    }
    return undefined
  }, [filteredEvals])

  // All rating questions across filtered evals (for breakdown)
  const allQuestionsByCategory = useMemo(() => {
    const map: Record<QuestionCategory, EvalQuestion[]> = {
      quality: [], learning: [], organization: [], goals: [],
      hours: [], attendance_in_person: [], attendance_online: [], unknown: []
    }
    for (const ev of filteredEvals) {
      for (const q of ev.questions) {
        map[categorizeQuestion(q.text)].push(q)
      }
    }
    return map
  }, [filteredEvals])

  const handleTermFilterChange = useCallback((term: string) => {
    setActiveTermFilter(term)
    setExpandedInstructor(null)
    setExpandedQuestion(null)
    // If switching to a term and on instructors tab but only 1 instructor for that filter, go to overview
    if (activeTab === 'instructors') {
      setActiveTab('overview')
    }
  }, [activeTab])

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
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-muted-foreground text-sm">No evaluation data available for this course.</p>
        <a
          href={`https://stanford.evaluationkit.com/Report/Public/Results?Course=${encodeURIComponent(subject + ' ' + code)}&Search=true`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          Search on EvaluationKit
          <ExternalLink size={12} />
        </a>
      </div>
    )
  }

  const ratingCats: QuestionCategory[] = ['quality', 'learning', 'organization', 'goals']
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
            All ({evaluations.length})
          </button>
          {evalTerms.map(term => {
            const count = evaluations.filter(e => e.term === term).length
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

      {/* Tab navigation */}
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

      {/* Tab content */}
      <div className="min-h-[200px]">

        {/* === Overview tab === */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Clickable metric rows */}
            <div className="border border-border/50 rounded-xl overflow-hidden divide-y divide-border/30">
              {ratingCats.map(cat => {
                if (metrics[cat] === undefined) return null
                const isExpanded = expandedQuestion === cat
                const questions = allQuestionsByCategory[cat]

                return (
                  <div key={cat}>
                    <button
                      type="button"
                      onClick={() => setExpandedQuestion(isExpanded ? null : cat)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors',
                        isExpanded && 'bg-secondary/10'
                      )}
                    >
                      <span className="text-sm text-foreground font-medium flex-1 text-left">
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <div className="w-20 h-1.5 bg-secondary/60 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', barFill(metrics[cat]!))}
                          style={{ width: `${(metrics[cat]! / 5) * 100}%` }}
                        />
                      </div>
                      <ScoreBadge score={metrics[cat]!} size="sm" />
                      {isExpanded ? (
                        <ChevronUp size={14} className="text-muted-foreground" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && questions.length > 0 && (
                      <div className="px-5 pb-4 pt-1 bg-secondary/5 space-y-4">
                        <AggregatedRatingBreakdown questions={questions} aggregateScore={metrics[cat]!} />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Hours row (expandable with histogram) */}
              {metrics.hours !== undefined && (() => {
                const isExpanded = expandedQuestion === 'hours'
                const hoursOptions = representativeHoursQuestion
                  ? [...representativeHoursQuestion.options].sort((a, b) => b.weight - a.weight)
                  : []

                return (
                  <div>
                    <button
                      type="button"
                      onClick={() => setExpandedQuestion(isExpanded ? null : 'hours')}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors',
                        isExpanded && 'bg-secondary/10'
                      )}
                    >
                      <Clock size={16} className="text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground font-medium flex-1 text-left">Hours / Week</span>
                      <span className="text-sm font-bold text-foreground tabular-nums">{metrics.hours.toFixed(1)} hrs</span>
                      {isExpanded ? (
                        <ChevronUp size={14} className="text-muted-foreground" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && hoursOptions.length > 0 && (
                      <div className="px-5 pb-4 pt-2 bg-secondary/5">
                        <HoursHistogram options={hoursOptions} />
                        {representativeHoursQuestion && (
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2 pt-1 border-t border-border/30">
                            <span>{representativeHoursQuestion.responseRate}</span>
                            <span className="tabular-nums">med {representativeHoursQuestion.median.toFixed(1)} / sd {representativeHoursQuestion.std.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Single instructor: show their per-eval list inline */}
            {!hasMultipleInstructors && filteredEvals.length > 1 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                  {instructors[0]?.name.split(', ').reverse().join(' ')} &middot; {filteredEvals.length} evals
                </div>
                {filteredEvals.map((ev, i) => (
                  <InlineEval key={`${ev.term}-${ev.instructor}-${i}`} evaluation={ev} disableComments />
                ))}
              </div>
            )}
          </div>
        )}

        {/* === Instructors tab (only with 2+ instructors) === */}
        {activeTab === 'instructors' && hasMultipleInstructors && (
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div
              className="grid gap-2 px-4 py-2.5 bg-secondary/30 border-b border-border/40"
              style={{ gridTemplateColumns: '1fr repeat(5, minmax(40px, 52px))' }}
            >
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Instructor</div>
              {ratingCats.map(cat => (
                <div key={cat} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">
                  {CATEGORY_SHORT[cat]}
                </div>
              ))}
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">
                {CATEGORY_SHORT.hours}
              </div>
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
      <div className="pt-1 text-center">
        <a
          href={`https://stanford.evaluationkit.com/Report/Public/Results?Course=${encodeURIComponent(subject + ' ' + code)}&Search=true`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          View on EvaluationKit
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  )
}
