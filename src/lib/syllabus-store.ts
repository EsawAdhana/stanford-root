import { create } from 'zustand'
import { supabase } from './supabase'
import { getUserId } from './get-user-id'

// --- Domain allowlist for submitted URLs ---

const ALLOWED_DOMAINS = ['.edu', '.github.com', '.github.io', '.google.com']
const ALLOWED_EXACT = ['github.com', 'github.io', 'google.com']

export function isAllowedUrl (url: string): { valid: boolean, reason?: string } {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      return { valid: false, reason: 'URL must use HTTPS' }
    }
    const hostname = parsed.hostname.toLowerCase()
    const allowed =
      ALLOWED_DOMAINS.some(suffix => hostname.endsWith(suffix)) ||
      ALLOWED_EXACT.some(domain => hostname === domain)
    if (!allowed) {
      return { valid: false, reason: 'Only .edu, GitHub, and Google domains are accepted' }
    }
    return { valid: true }
  } catch {
    return { valid: false, reason: 'Invalid URL format' }
  }
}

// --- Types ---

interface OfficialVoteTally {
  up: number
  down: number
  userVote: number // 1, -1, or 0
}

export interface SyllabusSubmission {
  id: number
  url: string
  label: string
  score: number
  userId: string
  userVote: number
  createdAt: string
}

interface SyllabusState {
  officialVotes: Record<string, OfficialVoteTally>
  submissions: Record<string, SyllabusSubmission[]>
  loading: Record<string, boolean>

  fetchSyllabusData: (courseId: string, term: string) => Promise<void>
  castOfficialVote: (courseId: string, term: string, vote: 1 | -1) => Promise<void>
  submitLink: (courseId: string, term: string, url: string, label: string) => Promise<{ ok: boolean, reason?: string }>
  deleteSubmission: (submissionId: number, courseId: string, term: string) => Promise<void>
  voteOnSubmission: (submissionId: number, vote: 1 | -1, courseId: string, term: string) => Promise<void>
}

function makeKey (courseId: string, term: string) {
  return `${courseId}:${term}`
}

export const useSyllabusStore = create<SyllabusState>((set, get) => ({
  officialVotes: {},
  submissions: {},
  loading: {},

  // --- Fetch all data for a course+term ---
  fetchSyllabusData: async (courseId, term) => {
    const key = makeKey(courseId, term)
    if (get().loading[key]) return

    set(s => ({ loading: { ...s.loading, [key]: true } }))
    const userId = getUserId()

    try {
      // Official votes
      const { data: votes } = await supabase
        .from('syllabus_votes')
        .select('vote, user_id')
        .eq('course_id', courseId)
        .eq('term', term)

      let up = 0
      let down = 0
      let userVote = 0
      for (const v of (votes || [])) {
        if (v.vote === 1) up++
        else if (v.vote === -1) down++
        if (v.user_id === userId) userVote = v.vote
      }

      // Submissions
      const { data: subs } = await supabase
        .from('syllabus_submissions')
        .select('id, url, label, score, user_id, created_at')
        .eq('course_id', courseId)
        .eq('term', term)
        .order('score', { ascending: false })

      // User's votes on submissions
      const subIds = (subs || []).map(s => s.id)
      const userSubVotes: Record<number, number> = {}
      if (subIds.length > 0) {
        const { data: subVotes } = await supabase
          .from('syllabus_submission_votes')
          .select('submission_id, vote')
          .eq('user_id', userId)
          .in('submission_id', subIds)

        for (const sv of (subVotes || [])) {
          userSubVotes[sv.submission_id] = sv.vote
        }
      }

      const mapped: SyllabusSubmission[] = (subs || []).map(s => ({
        id: s.id,
        url: s.url,
        label: s.label || '',
        score: s.score || 0,
        userId: s.user_id,
        userVote: userSubVotes[s.id] || 0,
        createdAt: s.created_at
      }))

      set(s => ({
        officialVotes: { ...s.officialVotes, [key]: { up, down, userVote } },
        submissions: { ...s.submissions, [key]: mapped },
        loading: { ...s.loading, [key]: false }
      }))
    } catch (err) {
      console.error('Error fetching syllabus data:', err)
      set(s => ({ loading: { ...s.loading, [key]: false } }))
    }
  },

  // --- Vote on the official link ---
  castOfficialVote: async (courseId, term, vote) => {
    const userId = getUserId()
    const key = makeKey(courseId, term)
    const current = get().officialVotes[key] || { up: 0, down: 0, userVote: 0 }
    const newVote = current.userVote === vote ? 0 : vote

    // Optimistic update
    const optimistic = { ...current }
    if (current.userVote === 1) optimistic.up--
    if (current.userVote === -1) optimistic.down--
    if (newVote === 1) optimistic.up++
    if (newVote === -1) optimistic.down++
    optimistic.userVote = newVote
    set(s => ({ officialVotes: { ...s.officialVotes, [key]: optimistic } }))

    try {
      if (newVote === 0) {
        await supabase
          .from('syllabus_votes')
          .delete()
          .eq('course_id', courseId)
          .eq('term', term)
          .eq('user_id', userId)
      } else {
        await supabase
          .from('syllabus_votes')
          .upsert(
            { course_id: courseId, term, user_id: userId, vote: newVote },
            { onConflict: 'course_id,term,user_id' }
          )
      }
    } catch (err) {
      console.error('Error casting official vote:', err)
      get().fetchSyllabusData(courseId, term)
    }
  },

  // --- Submit a community link ---
  submitLink: async (courseId, term, url, label) => {
    const validation = isAllowedUrl(url)
    if (!validation.valid) return { ok: false, reason: validation.reason }

    const userId = getUserId()

    try {
      const { error } = await supabase
        .from('syllabus_submissions')
        .insert({ course_id: courseId, term, user_id: userId, url: url.trim(), label: label.trim() })

      if (error) throw error

      // Refresh
      await get().fetchSyllabusData(courseId, term)
      return { ok: true }
    } catch (err) {
      console.error('Error submitting link:', err)
      return { ok: false, reason: 'Failed to submit. Try again.' }
    }
  },

  // --- Delete own submission ---
  deleteSubmission: async (submissionId, courseId, term) => {
    const userId = getUserId()
    const key = makeKey(courseId, term)
    const subs = get().submissions[key] || []
    const sub = subs.find(s => s.id === submissionId)
    if (!sub || sub.userId !== userId) return

    // Optimistic removal
    set(s => ({
      submissions: {
        ...s.submissions,
        [key]: subs.filter(item => item.id !== submissionId)
      }
    }))

    try {
      await supabase
        .from('syllabus_submissions')
        .delete()
        .eq('id', submissionId)
        .eq('user_id', userId)
    } catch (err) {
      console.error('Error deleting submission:', err)
      get().fetchSyllabusData(courseId, term)
    }
  },

  // --- Vote on a community submission ---
  voteOnSubmission: async (submissionId, vote, courseId, term) => {
    const userId = getUserId()
    const key = makeKey(courseId, term)
    const subs = get().submissions[key] || []
    const sub = subs.find(s => s.id === submissionId)
    if (!sub) return

    const newVote = sub.userVote === vote ? 0 : vote
    const scoreDelta = newVote - sub.userVote

    // Optimistic update
    set(s => ({
      submissions: {
        ...s.submissions,
        [key]: subs.map(item =>
          item.id === submissionId
            ? { ...item, userVote: newVote, score: item.score + scoreDelta }
            : item
        )
      }
    }))

    try {
      if (newVote === 0) {
        await supabase
          .from('syllabus_submission_votes')
          .delete()
          .eq('submission_id', submissionId)
          .eq('user_id', userId)
      } else {
        await supabase
          .from('syllabus_submission_votes')
          .upsert(
            { submission_id: submissionId, user_id: userId, vote: newVote },
            { onConflict: 'submission_id,user_id' }
          )
      }

      // Recalculate and persist the cached score
      const { data: allVotes } = await supabase
        .from('syllabus_submission_votes')
        .select('vote')
        .eq('submission_id', submissionId)

      const netScore = (allVotes || []).reduce((sum: number, v: { vote: number }) => sum + v.vote, 0)

      // Auto-remove submissions with 3+ net downvotes
      if (netScore <= -3) {
        await supabase
          .from('syllabus_submissions')
          .delete()
          .eq('id', submissionId)

        set(s => ({
          submissions: {
            ...s.submissions,
            [key]: (s.submissions[key] || []).filter(item => item.id !== submissionId)
          }
        }))
        return
      }

      await supabase
        .from('syllabus_submissions')
        .update({ score: netScore })
        .eq('id', submissionId)

      // Sync local state with real score
      set(s => ({
        submissions: {
          ...s.submissions,
          [key]: (s.submissions[key] || []).map(item =>
            item.id === submissionId ? { ...item, score: netScore } : item
          )
        }
      }))
    } catch (err) {
      console.error('Error voting on submission:', err)
      get().fetchSyllabusData(courseId, term)
    }
  }
}))
