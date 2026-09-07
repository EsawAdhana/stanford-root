'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, MessageSquare } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useCourseStore } from '@/lib/store'
import { isDevEvalsUnlocked } from '@/lib/dev-flags'
import { cn, decodeHtmlEntities } from '@/lib/utils'
import { compareTerms } from '@/lib/terms'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  aggregateMetrics, barFill, CATEGORY_LABELS, categorizeQuestion, CommentsPanel,
  EvaluationOverview, EvalLoginGate, RATING_CATEGORIES, ScoreBadge,
  type CommentEntry, type QuestionCategory,
} from '@/components/course-evaluations'
import type { InstructorEvaluation } from '@/app/api/instructors/[slug]/route'
import type { DumpInstructorCourse } from '@/lib/catalog-dump'
import { useEnsureCatalog } from '@/hooks/use-catalog';

interface InstructorDetailContentProps {
  slug: string
  name: string
  /** Upcoming catalog listings for this person. */
  upcoming: DumpInstructorCourse[]
}

/** Matches the page-level tabs on the course detail page. */
const TAB_TRIGGER_CLASS = 'rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 py-3 text-[18px] font-bold text-muted-foreground data-[state=active]:text-foreground transition-all hover:text-foreground/80'

interface CourseStat {
  courseId: string
  subject: string
  code: string
  title: string
  terms: string[]
  evalCount: number
  commentCount: number
  scores: Partial<Record<QuestionCategory, number>>
}

/** "CHEMENG480" -> { subject: "CHEMENG", code: "480" } for courses no longer in the catalog. */
function splitCourseId(id: string): { subject: string; code: string } {
  const match = id.match(/^([A-Za-z&]+)(.*)$/)
  return { subject: match?.[1] ?? id, code: match?.[2] ?? '' }
}

function useInstructorEvaluations(slug: string, enabled: boolean) {
  const [evaluations, setEvaluations] = useState<InstructorEvaluation[] | null>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setHasError(false)
    fetch(`/api/instructors/${encodeURIComponent(slug)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(data => { if (!cancelled) setEvaluations(data.evaluations ?? []) })
      .catch(() => { if (!cancelled) { setEvaluations([]); setHasError(true) } })
    return () => { cancelled = true }
  }, [slug, enabled])

  return { evaluations, hasError }
}

export function InstructorDetailContent({ slug, name, upcoming }: InstructorDetailContentProps) {
    useEnsureCatalog();
  const user = useAuthStore(s => s.user)
  const authLoading = useAuthStore(s => s.isLoading)
  const canViewEvals = Boolean(user) || isDevEvalsUnlocked()
  const courses = useCourseStore(s => s.courses)

  const [activeTermFilter, setActiveTermFilter] = useState('all')

  const { evaluations, hasError } = useInstructorEvaluations(slug, canViewEvals)

  const terms = useMemo(() => {
    const unique = [...new Set((evaluations ?? []).map(e => e.term).filter(Boolean))]
    return unique.sort((a, b) => compareTerms(b, a))
  }, [evaluations])

  const filtered = useMemo(() => {
    const all = evaluations ?? []
    return activeTermFilter === 'all' ? all : all.filter(e => e.term === activeTermFilter)
  }, [evaluations, activeTermFilter])

  const metrics = useMemo(() => aggregateMetrics(filtered), [filtered])

  /** This instructor's own quality score per course — not the catalog course average. */
  const qualityByCourse = useMemo(() => {
    const byCourse = new Map<string, InstructorEvaluation[]>()
    for (const ev of evaluations ?? []) {
      const list = byCourse.get(ev.courseId)
      if (list) list.push(ev)
      else byCourse.set(ev.courseId, [ev])
    }
    const out = new Map<string, number>()
    for (const [courseId, evals] of byCourse) {
      const quality = aggregateMetrics(evals).quality
      if (quality !== undefined) out.set(courseId, quality)
    }
    return out
  }, [evaluations])

  const courseStats = useMemo<CourseStat[]>(() => {
    const titleById = new Map(courses.map(c => [c.id, c]))
    const byCourse = new Map<string, InstructorEvaluation[]>()
    for (const ev of filtered) {
      const list = byCourse.get(ev.courseId)
      if (list) list.push(ev)
      else byCourse.set(ev.courseId, [ev])
    }

    return Array.from(byCourse.entries())
      .map(([courseId, evals]) => {
        const catalog = titleById.get(courseId)
        const { subject, code } = splitCourseId(courseId)
        return {
          courseId,
          subject: catalog?.subject || subject,
          code: catalog?.code || code,
          title: catalog?.title ? decodeHtmlEntities(catalog.title) : '',
          terms: [...new Set(evals.map(e => e.term))].sort(compareTerms),
          evalCount: evals.length,
          commentCount: evals.reduce((sum, e) => sum + e.comments.length, 0),
          scores: aggregateMetrics(evals),
        }
      })
      .sort((a, b) =>
        compareTerms(b.terms[b.terms.length - 1] ?? '', a.terms[a.terms.length - 1] ?? '') ||
        `${a.subject}${a.code}`.localeCompare(`${b.subject}${b.code}`))
  }, [filtered, courses])

  const comments = useMemo(() => {
    // Unlike a course page, this list mixes every class the instructor has
    // taught, so each comment carries the course it was written about.
    const titleById = new Map(courses.map(c => [c.id, c]))
    const seen = new Set<string>()
    const out: CommentEntry[] = []
    // Newest term first, so one prolific course doesn't bury the rest.
    const byRecency = [...filtered].sort((a, b) => compareTerms(b.term, a.term))
    for (const ev of byRecency) {
      const catalog = titleById.get(ev.courseId)
      const { subject, code } = splitCourseId(ev.courseId)
      const label = `${catalog?.subject || subject} ${catalog?.code || code}`.trim()
      for (const comment of ev.comments) {
        const key = decodeHtmlEntities(comment).trim().toLowerCase()
        if (key && !seen.has(key)) {
          seen.add(key)
          out.push({ text: comment, label })
        }
      }
    }
    return out
  }, [filtered, courses])

  /** Sample size behind the ratings: students who answered the quality question. */
  const responseCount = useMemo(() => {
    let total = 0
    for (const ev of evaluations ?? []) {
      for (const question of ev.questions) {
        if (categorizeQuestion(question.text) !== 'quality') continue
        for (const option of question.options) total += option.count
      }
    }
    return total
  }, [evaluations])

  const headerStats = useMemo(() => {
    if (!evaluations || evaluations.length === 0) return []
    return [
      { label: 'COURSES', value: new Set(evaluations.map(e => e.courseId)).size },
      { label: 'TERMS', value: terms.length },
      { label: 'EVALS', value: evaluations.length },
      { label: 'RESPONSES', value: responseCount },
    ]
  }, [evaluations, terms, responseCount])

  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const course of upcoming) set.add(course.subject)
    for (const stat of courseStats) set.add(stat.subject)
    return [...set].sort()
  }, [upcoming, courseStats])

  const isLoading = canViewEvals && evaluations === null

  return (
    <div className="container max-w-[95rem] mx-auto p-4 md:px-8 md:pt-4 md:pb-10 space-y-4">
      <header className="space-y-3">
        {departments.length > 0 && (
          <h2 className="text-2xl font-bold text-destructive tracking-tight pl-3 md:pl-4">
            {departments.join(' · ')}
          </h2>
        )}
        <h1 className="text-3xl md:text-4xl font-extrabold leading-tight text-foreground tracking-tight pl-3 md:pl-4">
          {name}
        </h1>

        {/* Same quick-info treatment as a course page, carrying the sample size
            behind every rating shown below. */}
        {headerStats.length > 0 && (
          <div className="grid grid-cols-2 md:inline-flex md:flex-nowrap rounded-xl border border-border/40 bg-secondary/10 w-fit min-w-0 ml-3 md:ml-4">
            {headerStats.map((stat, i) => (
              <div
                key={stat.label}
                className={cn(
                  'flex flex-col md:flex-row md:items-center gap-0.5 md:gap-2 p-3 shrink-0',
                  i % 2 === 0 && 'border-r border-border/40',
                  i < 2 && 'border-b md:border-b-0 border-border/40',
                  i === 1 && 'md:border-r md:border-border/40'
                )}
              >
                <span className="text-[15px] font-bold text-muted-foreground uppercase tracking-tight shrink-0">
                  {stat.label}:
                </span>
                <span className="text-[18px] font-bold text-foreground tabular-nums">{stat.value}</span>
              </div>
            ))}
          </div>
        )}

      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
        <div className="space-y-4 pl-3 md:pl-4">
          {!canViewEvals && !authLoading && (
            <EvalLoginGate title={`${name}'s reviews are Stanford-only`} />
          )}

          {(isLoading || (authLoading && !canViewEvals)) && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Loading evaluations...</span>
            </div>
          )}

          {canViewEvals && evaluations !== null && hasError && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Could not load evaluation data.
            </div>
          )}

          {canViewEvals && evaluations !== null && !hasError && evaluations.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No evaluations on record for {name}. Our records only go back to <strong>Fall 2021</strong>.
            </div>
          )}

          {canViewEvals && evaluations !== null && evaluations.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {RATING_CATEGORIES.map(cat => {
                  const score = metrics[cat]
                  return (
                    <div key={cat} className="rounded-xl border border-border/40 bg-secondary/10 px-4 py-3 space-y-2">
                      <div className="text-[13px] font-bold text-muted-foreground uppercase tracking-tight">
                        {CATEGORY_LABELS[cat].replace('Instruction ', '')}
                      </div>
                      {score === undefined ? (
                        <div className="text-[15px] text-muted-foreground">--</div>
                      ) : cat === 'hours' ? (
                        <div className="text-[18px] font-bold tabular-nums">{score.toFixed(1)}<span className="text-[13px] font-medium text-muted-foreground ml-1">hrs/wk</span></div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <ScoreBadge score={score} size="md" />
                          <div className="flex-1 h-1.5 bg-secondary/60 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', barFill(score))} style={{ width: `${(score / 5) * 100}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {terms.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTermFilter('all')}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      activeTermFilter === 'all' ? 'bg-foreground text-background' : 'bg-secondary/50 hover:bg-secondary text-muted-foreground'
                    )}
                  >
                    All ({evaluations.length})
                  </button>
                  {terms.map(term => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setActiveTermFilter(term)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        activeTermFilter === term ? 'bg-foreground text-background' : 'bg-secondary/50 hover:bg-secondary text-muted-foreground'
                      )}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              )}

              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="w-full justify-start bg-transparent border-b border-border/40 rounded-none h-auto p-0 gap-8 mb-4">
                  <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>Overview</TabsTrigger>
                  <TabsTrigger value="courses" className={TAB_TRIGGER_CLASS}>
                    Courses
                    <span className="ml-1.5 text-[15px] font-bold text-muted-foreground tabular-nums">{courseStats.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="comments" className={TAB_TRIGGER_CLASS}>
                    Comments
                    <span className="ml-1.5 text-[15px] font-bold text-muted-foreground tabular-nums">{comments.length}</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="focus-visible:outline-none focus-visible:ring-0">
                  <EvaluationOverview evaluations={filtered} />
                </TabsContent>
                <TabsContent value="courses" className="focus-visible:outline-none focus-visible:ring-0">
                  <CoursesTaught stats={courseStats} />
                </TabsContent>
                <TabsContent value="comments" className="focus-visible:outline-none focus-visible:ring-0">
                  <CommentsPanel comments={comments} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:h-fit">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <h2 className="text-[20px] font-bold text-foreground">Upcoming classes</h2>
            {upcoming.length > 0 && (
              <div className="text-[15px] text-muted-foreground font-medium">
                {upcoming.length} {upcoming.length === 1 ? 'Class' : 'Classes'}
              </div>
            )}
          </div>
          {upcoming.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">
              Not listed for any published term.
            </p>
          ) : (
            <div className="space-y-2">
              {upcoming.map(course => (
                <Link
                  key={course.id}
                  href={`/${encodeURIComponent(course.id)}`}
                  className="block rounded-xl border border-border/40 bg-secondary/10 px-4 py-3 hover:bg-secondary/20 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-destructive">{course.subject} {course.code}</span>
                    {qualityByCourse.get(course.id) != null && (
                      <ScoreBadge score={qualityByCourse.get(course.id)!} size="sm" />
                    )}
                  </div>
                  <div className="text-sm text-foreground font-medium leading-snug mt-0.5">
                    {decodeHtmlEntities(course.title)}
                  </div>
                  {course.terms.length > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-1">{course.terms.join(', ')}</div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function CoursesTaught({ stats }: { stats: CourseStat[] }) {
  if (stats.length === 0) {
    return <div className="text-center py-6 text-sm text-muted-foreground">No courses on record.</div>
  }

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      {stats.map(stat => (
        <Link
          key={stat.courseId}
          href={`/${encodeURIComponent(stat.courseId)}`}
          className="grid gap-2 px-4 py-3 items-center border-b border-border/30 last:border-0 hover:bg-secondary/20 transition-colors"
          style={{ gridTemplateColumns: '1fr repeat(2, minmax(44px, 60px))' }}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {stat.subject} {stat.code}
              {stat.title && <span className="font-normal text-muted-foreground"> — {stat.title}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-2">
              <span>{stat.terms.join(', ')}</span>
              {stat.commentCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare size={10} />
                  {stat.commentCount}
                </span>
              )}
            </div>
          </div>
          <div className="flex justify-center">
            {stat.scores.quality !== undefined
              ? <ScoreBadge score={stat.scores.quality} size="sm" />
              : <span className="text-xs text-muted-foreground">--</span>}
          </div>
          <div className="flex justify-center text-xs font-semibold text-foreground tabular-nums">
            {stat.scores.hours !== undefined ? `${stat.scores.hours.toFixed(0)}h` : <span className="font-normal text-muted-foreground">--</span>}
          </div>
        </Link>
      ))}
    </div>
  )
}
