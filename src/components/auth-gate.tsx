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

function MarqueeRow ({ items, duration, reverse = false }: { items: string[], duration: string, reverse?: boolean }) {
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
              className="inline-block rounded-full border border-border/40 bg-background/80 px-4 py-1.5 text-sm text-muted-foreground/25 font-medium whitespace-nowrap"
            >
              {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AuthGate ({ children }: { children: React.ReactNode }) {
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
    return (
      <div className="relative flex h-screen flex-col items-center justify-center bg-background overflow-hidden">
        {/* Scrolling text background — fills entire screen */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-3">
          <MarqueeRow items={ROW_3} duration="37s" />
          <MarqueeRow items={ROW_1} duration="44s" reverse />
          <MarqueeRow items={ROW_2} duration="33s" />
          <MarqueeRow items={[...ROW_3].reverse()} duration="41s" reverse />
          <MarqueeRow items={ROW_1} duration="35s" />
          <MarqueeRow items={ROW_2} duration="40s" reverse />
          <MarqueeRow items={ROW_3} duration="32s" />
          <MarqueeRow items={[...ROW_1].reverse()} duration="38s" reverse />
          <MarqueeRow items={ROW_2} duration="42s" />
          <MarqueeRow items={ROW_3} duration="36s" reverse />
          <MarqueeRow items={ROW_1} duration="34s" />
          <MarqueeRow items={[...ROW_2].reverse()} duration="39s" reverse />
          <MarqueeRow items={ROW_3} duration="43s" />
          <MarqueeRow items={ROW_1} duration="31s" reverse />
          <MarqueeRow items={ROW_2} duration="37s" />
        </div>

        {/* Center fade overlay so text is readable */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(var(--background))_30%,_transparent_70%)]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center px-6">
          <Logo className="h-24 w-24 mb-8" />

          <h1 className="text-5xl sm:text-6xl font-[family-name:var(--font-outfit)] font-bold tracking-tight leading-[1.1] text-center">
            <span className="text-primary">Everything Stanford,</span>
            <br />
            <span className="text-foreground">in one place.</span>
          </h1>

          <p className="mt-5 text-center text-base sm:text-lg text-muted-foreground max-w-sm leading-relaxed">
            Course search, evals, syllabi, and scheduling&nbsp;&mdash;
            without juggling five tabs.
          </p>

          <button
            type="button"
            onClick={signInWithGoogle}
            className="mt-10 w-full max-w-xs flex items-center justify-center rounded-2xl bg-background text-foreground border border-border px-8 py-4 font-semibold text-[15px] shadow-sm transition-all duration-200 hover:bg-secondary active:bg-secondary/80"
          >
            Log in through Stanford
          </button>
        </div>

        {/* Footer */}
        <div className="absolute bottom-6 z-10 flex items-center gap-3 text-[11px] text-muted-foreground/30">
          <Link href="/privacy" className="hover:text-muted-foreground transition-colors">
            Privacy Policy
          </Link>
          <span>&middot;</span>
          <Link href="/terms" className="hover:text-muted-foreground transition-colors">
            Terms of Service
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
