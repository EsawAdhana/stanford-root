'use client'

import React, { useState, useEffect } from 'react'
import { ThumbsUp, ThumbsDown, Plus, Link2, X, Loader2, Trash2 } from 'lucide-react'
import { useSyllabusStore, isAllowedUrl } from '@/lib/syllabus-store'
import { getUserId } from '@/lib/get-user-id'
import { cn } from '@/lib/utils'

interface SyllabusVotingProps {
  courseId: string
  term: string
}

export function SyllabusVoting ({ courseId, term }: SyllabusVotingProps) {
  const {
    officialVotes, submissions, loading,
    fetchSyllabusData, castOfficialVote, submitLink, deleteSubmission, voteOnSubmission
  } = useSyllabusStore()

  const currentUserId = typeof window !== 'undefined' ? getUserId() : ''

  const [showForm, setShowForm] = useState(false)
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('Course Website')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const LABEL_OPTIONS = ['Syllabus', 'Course Website','GitHub', 'Other']

  const key = `${courseId}:${term}`
  const votes = officialVotes[key] || { up: 0, down: 0, userVote: 0 }
  const subs = submissions[key] || []
  const isLoading = loading[key]

  useEffect(() => {
    if (courseId && term) fetchSyllabusData(courseId, term)
  }, [courseId, term, fetchSyllabusData])

  const handleSubmit = async () => {
    setError('')
    const validation = isAllowedUrl(url)
    if (!validation.valid) {
      setError(validation.reason || 'Invalid URL')
      return
    }
    setIsSubmitting(true)
    const result = await submitLink(courseId, term, url, label)
    setIsSubmitting(false)
    if (result.ok) {
      setUrl('')
      setLabel('')
      setShowForm(false)
    } else {
      setError(result.reason || 'Failed to submit')
    }
  }

  if (isLoading && !votes.up && !votes.down && subs.length === 0) {
    return null // Silent initial load
  }

  return (
    <div className="space-y-3">
      {/* Official link feedback */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Is the syllabus available?</span>
        <button
          type="button"
          onClick={() => castOfficialVote(courseId, term, 1)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
            votes.userVote === 1
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          )}
          title="Yes, the syllabus is avaiable"
        >
          <ThumbsUp size={12} />
          {votes.up > 0 && <span className="tabular-nums">{votes.up}</span>}
        </button>
        <button
          type="button"
          onClick={() => castOfficialVote(courseId, term, -1)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
            votes.userVote === -1
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          )}
          title="No, the syllabus is not available"
        >
          <ThumbsDown size={12} />
          {votes.down > 0 && <span className="tabular-nums">{votes.down}</span>}
        </button>
      </div>

      {/* Warning when 3+ users report the link as unavailable */}
      {votes.down >= 3 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/15 border border-amber-200/60 dark:border-amber-700/30 rounded-lg">
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            Several users have reported this syllabus link as unavailable.
          </span>
        </div>
      )}

      {/* Community-submitted links */}
      {subs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Community links
          </div>
          {subs.map(sub => (
            <div
              key={sub.id}
              className="flex items-center gap-2 px-3 py-2 bg-secondary/20 rounded-lg border border-border/30"
            >
              <a
                href={sub.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline truncate flex items-center gap-1.5 min-w-0 flex-1"
                title={sub.url}
              >
                <Link2 size={10} className="shrink-0" />
                {sub.label || (() => { try { return new URL(sub.url).hostname } catch { return sub.url } })()}
              </a>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => voteOnSubmission(sub.id, 1, courseId, term)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    sub.userVote === 1
                      ? 'text-emerald-600'
                      : 'text-muted-foreground/50 hover:text-foreground'
                  )}
                >
                  <ThumbsUp size={10} />
                </button>
                <span className={cn(
                  'text-[10px] tabular-nums min-w-[16px] text-center font-semibold',
                  sub.score > 0 ? 'text-emerald-600' : sub.score < 0 ? 'text-red-500' : 'text-muted-foreground'
                )}>
                  {sub.score}
                </span>
                <button
                  type="button"
                  onClick={() => voteOnSubmission(sub.id, -1, courseId, term)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    sub.userVote === -1
                      ? 'text-red-500'
                      : 'text-muted-foreground/50 hover:text-foreground'
                  )}
                >
                  <ThumbsDown size={10} />
                </button>
                {sub.userId === currentUserId && (
                  <button
                    type="button"
                    onClick={() => deleteSubmission(sub.id, courseId, term)}
                    className="p-1 rounded text-muted-foreground/40 hover:text-red-500 transition-colors ml-0.5"
                    title="Delete your submission"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Submit link toggle / form */}
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus size={12} />
          Know the correct link? Submit it here!
        </button>
      ) : (
        <div className="space-y-2 p-3 bg-secondary/15 rounded-lg border border-border/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Submit a syllabus link</span>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError('') }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
          <input
            type="url"
            value={url}
            onChange={e => { setUrl(e.target.value); setError('') }}
            placeholder="https://..."
            className="w-full bg-background border border-border/50 rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex flex-wrap gap-1.5">
            {LABEL_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setLabel(opt)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                  label === opt
                    ? 'bg-foreground text-background'
                    : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          {error && <div className="text-[10px] text-red-500">{error}</div>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !url.trim()}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">Only HTTPS links on .edu, GitHub, or Google domains are accepted.</p>
        </div>
      )}
    </div>
  )
}
