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

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, initialize, signInWithGoogle } = useAuthStore()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const unsubscribe = initialize()
    const timer = setTimeout(() => setTimedOut(true), 3000)
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [initialize])

  if (isLoading && !timedOut) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
      </div>
    )
  }

  if (!user) {
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

    // Helper to shuffle array
    const shuffle = (array: string[]) => {
      const newArray = [...array]
      for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
      }
      return newArray
    }

    // Create 15 rows of randomized content
    const rows = Array.from({ length: 15 }, () => shuffle(ALL_PHRASES).slice(0, 12))

    return (
      <div className="relative min-h-[100dvh] flex flex-col items-center justify-center bg-background overflow-hidden selection:bg-primary/20">
        {/* Scrolling text background — fills entire screen edge-to-edge */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between -my-2 sm:-my-8 opacity-[0.4] dark:opacity-[0.25]">
          {rows.map((rowItems, i) => (
            <MarqueeRow
              key={i}
              items={rowItems}
              duration={`${30 + (i % 5) * 5 + Math.random() * 10}s`}
              reverse={i % 2 === 1}
            />
          ))}
        </div>

        {/* Center fade overlay so text is readable */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(var(--background))_0%,_transparent_80%)] sm:bg-[radial-gradient(ellipse_at_center,_hsl(var(--background))_20%,_transparent_100%)]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center px-6 py-8 sm:py-0 animate-fade-in-up">
          <div className="mb-6 sm:mb-8 relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary to-orange-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
            <Logo className="h-20 w-20 sm:h-24 sm:w-24 relative rounded-2xl" />
          </div>

          <h1 className="text-4xl sm:text-7xl font-[family-name:var(--font-outfit)] font-bold tracking-tight leading-[1.1] text-center text-foreground">
            Everything <span className="text-primary">Stanford</span>,
            <br />
            in one place.
          </h1>

          <p className="mt-4 sm:mt-6 text-center text-base sm:text-xl text-muted-foreground/80 max-w-lg leading-relaxed font-light">
            Course search, evals, syllabi, and scheduling&nbsp;&mdash;
            <br className="hidden sm:block" />
            without juggling five different tabs.
          </p>

          <div className="mt-8 sm:mt-12 flex flex-col items-center gap-4 w-full max-w-xs">
            <button
              type="button"
              onClick={signInWithGoogle}
              className="w-full relative group flex items-center justify-center gap-3 rounded-xl bg-foreground text-background px-8 py-3.5 sm:py-4 font-semibold text-[15px] shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
            >
              {/* Icon removed as requested */}
              <span>Log in with Stanford</span>
            </button>
          </div>

        </div>

        {/* Footer */}
        <div className="absolute bottom-6 z-10 flex items-center gap-4 text-xs font-medium text-muted-foreground/40">
          <Link href="/privacy" className="hover:text-primary transition-colors">
            Privacy
          </Link>
          <span className="w-1 h-1 rounded-full bg-current opacity-30" />
          <Link href="/terms" className="hover:text-primary transition-colors">
            Terms
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
