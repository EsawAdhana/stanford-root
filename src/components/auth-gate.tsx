'use client'

import React, { useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { Logo } from './logo'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'

const PHRASES = [
  'Find courses.',
  'Read syllabi.',
  'Browse evaluations.',
  'Build your schedule.',
  'Filter by WAYS.',
  'Detect time conflicts.',
  'Compare sections.',
  'Check enrollment.',
  'Plan your degree.',
  'Explore departments.',
  'Read student reviews.',
  'Find open seats.',
  'Search by instructor.',
  'Filter by units.',
  'View meeting times.',
]

// Duplicate so the scroll loops seamlessly
const ROW_1 = PHRASES.slice(0, 8)
const ROW_2 = PHRASES.slice(5).concat(PHRASES.slice(0, 3))
const ROW_3 = [...PHRASES].reverse().slice(0, 8)

function MarqueeRow({ items, duration, reverse = false }: { items: string[], duration: string, reverse?: boolean }) {
  return (
    <div className="flex overflow-hidden whitespace-nowrap select-none">
      <div
        className={reverse ? 'animate-marquee-reverse' : 'animate-marquee'}
        style={{ animationDuration: duration }}
      >
        <div className="flex gap-3 pr-3">
          {[...items, ...items].map((text, i) => (
            <span
              key={i}
              className="inline-block rounded-full border border-border/40 bg-background/80 px-4 py-1.5 text-base sm:text-lg text-muted-foreground/40 font-medium whitespace-nowrap"
            >
              {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function FeatureCard({ icon: Icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <div className="flex flex-col items-start p-6 rounded-2xl bg-secondary/10 border border-border/40 hover:bg-secondary/20 transition-colors">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, initialize, signInWithGoogle } = useAuthStore()
  // We remove the timedOut state and logic to allow immediate rendering of the landing page
  // for better SEO and perceived performance.

  useEffect(() => {
    const unsubscribe = initialize()
    return () => {
      unsubscribe()
    }
  }, [initialize])

  // Show loading spinner ONLY if we are fairly certain a user MIGHT be logged in
  // checking local storage or cookie existence syncronously would be ideal but simple approach:
  // if isLoading is true, we simply render the landing page. The "flicker" of landing page -> app
  // is better than spinner -> app for new users, and for existing users auth is usually fast.
  // HOWEVER, for a smoother experience, we can keep a small loading state IF we want,
  // but for Google Verification, showing the content immediately is safer.

  if (user) {
    return <>{children}</>
  }

  // If loading or not logged in, show Landing Page.
  // This ensures bots always see content.

  // Extended phrase list for variety
  const ALL_PHRASES = [
    'Find courses.', 'Read syllabi.', 'Browse evaluations.', 'Build your schedule.',
    'Filter by WAYS.', 'Detect time conflicts.', 'Compare sections.', 'Check enrollment.',
    'Plan your degree.', 'Explore departments.', 'Read student reviews.', 'Find open seats.',
    'Search by instructor.', 'Filter by units.', 'View meeting times.', 'Export to calendar.',
    'Ace your quarter.', 'Plan in seconds.', 'Visualize your week.', 'Track requirements.',
    'Discover gems.', 'Avoid 8am classes.', 'Optimize your path.', 'Graduate on time.',
    'Master your major.', 'Simplifying Stanford.', 'Analyze trends.', 'Smart scheduling.',
    'Search historically.', 'Review professors.', 'Mockup schedules.', 'Waitlist tracking.',
    'Unit planning.', 'Search efficiently.', 'Fast & responsive.', 'Mobile friendly.',
    'Degree progress.', 'Major requirements.', 'GER fulfillment.', 'Language requirements.',
    'Writing requirements.', 'Visualize workload.', 'Balance your life.', 'Academic roadmap.',
  ]

  // Create 15 rows of deterministic content to allow SSR consistency
  const rows = Array.from({ length: 15 }, (_, i) => {
    // Simple deterministic rotation based on row index
    const offset = (i * 7) % ALL_PHRASES.length
    return [...ALL_PHRASES.slice(offset), ...ALL_PHRASES.slice(0, offset)].slice(0, 12)
  })

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20">

      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center min-h-[90vh] overflow-hidden">

        {/* Scrolling text background — fills entire screen edge-to-edge */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between -my-2 sm:-my-8 opacity-[0.4] dark:opacity-[0.25]">
          {rows.map((rowItems, i) => (
            <MarqueeRow
              key={i}
              items={rowItems}
              // Deterministic duration based on index
              duration={`${40 + (i % 3) * 5 + (i * 0.5)}s`}
              reverse={i % 2 === 1}
            />
          ))}
        </div>

        {/* Center fade overlay so text is readable */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(var(--background))_0%,_transparent_80%)] sm:bg-[radial-gradient(ellipse_at_center,_hsl(var(--background))_20%,_transparent_100%)]" />

        {/* Hero Content */}
        <div className="relative z-10 flex flex-col items-center px-6 py-8 sm:py-0 animate-fade-in-up text-center max-w-4xl mx-auto">
          <div className="mb-6 sm:mb-8 relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary to-orange-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
            <Logo className="h-20 w-20 sm:h-24 sm:w-24 relative rounded-2xl shadow-2xl" />
          </div>

          <h1 className="text-5xl sm:text-7xl font-[family-name:var(--font-outfit)] font-bold tracking-tight leading-[1.1] text-foreground mb-6">
            Everything <span className="text-primary">Stanford</span>,
            <br />
            in one place.
          </h1>

          <p className="text-lg sm:text-2xl text-muted-foreground/80 max-w-2xl leading-relaxed font-light mb-10">
            The ultimate tool for course discovery, scheduling, and degree planning.
            Built by students, for students.
          </p>

          <div className="flex flex-col items-center gap-4 w-full max-w-xs">
            {isLoading ? (
              <button disabled className="w-full flex items-center justify-center gap-3 rounded-xl bg-muted text-muted-foreground px-8 py-3.5 sm:py-4 font-semibold text-[15px]">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Checking session...</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="w-full relative group flex items-center justify-center gap-3 rounded-xl bg-foreground text-background px-8 py-3.5 sm:py-4 font-semibold text-[15px] shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
              >
                <span>Log in with Stanford</span>
              </button>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Valid @stanford.edu email required.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-6 border-t border-border/40 bg-muted/20">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-12 text-xs font-medium text-muted-foreground/60">


          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>

          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>

          <span className="">
            &copy; {new Date().getFullYear()} Stanford Root
          </span>
        </div>
      </footer>

    </div>
  )
}
