/** Allowed analytics event names — shared by the client `track()` helper and the
 *  /api/track route so unknown events are rejected at the boundary. */
export const ANALYTICS_EVENTS = [
  'page_viewed',
  'search_performed',
  'course_added_to_schedule',
  'login_nudge_shown',
  'eval_gate_viewed',
  'login_started',
  'login_completed',
  'login_failed',
  'app_crashed',
  'schedule_synced',
  'ics_exported',
  'ics_imported',
  'schedule_times_notice_shown',
  // Added for src/components/schedule-source-notice.tsx (written by a concurrent
  // session on 2026-08-25); the component already emits it.
  'schedule_source_notice_shown',
  'finals_week_viewed',
  'schedule_share_copied',
  'plan_created',
  'plan_switched',
  'plan_deleted',
] as const

export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number]

export const ALLOWED_EVENTS = new Set<string>(ANALYTICS_EVENTS)
