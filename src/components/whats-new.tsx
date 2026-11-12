'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/lib/cart-store';
import { useAuthStore } from '@/lib/auth-store';
import { cartHydrated } from '@/lib/cart-hydration';
import { track } from '@/lib/analytics';
import { isReturningVisitor, isSharedSchedulePath, onceForPageLoad } from '@/lib/whats-new';
import { readSeen, useWhatsNewStore } from '@/lib/whats-new-store';

/**
 * A one-time carousel announcing the November 2026 schedule features and the
 * Stanford Root MCP (its last slide links to /connect).
 *
 * Opens by itself once per browser, and only for people who have used the
 * schedule before (a saved class in this browser when the page loaded, or
 * signed in). A first-time visitor, including one who adds a class during this
 * visit, has nothing to compare against, so it would only be in their way.
 * Anyone can open it from the header's New button, which has a dot until the
 * card has been opened (lib/whats-new-store).
 */

/** Wait for the page to settle so the card never lands on top of a loading screen. */
const SHOW_DELAY_MS = 1200;

const SLIDES = [
  {
    title: 'Plan A and Plan B',
    body: 'Keep a backup schedule for a quarter and switch between them. The table on the right compares units and hours a week for each plan.',
    image: '/whats-new/plans.png',
    imageDark: '/whats-new/plans-dark.png',
    alt: 'Plan A and Plan B side by side in the schedule page totals table',
  },
  {
    title: 'Finals week',
    body: 'Flip the calendar to Finals week to see when each exam is, and which ones land at the same time.',
    image: '/whats-new/finals.png',
    imageDark: '/whats-new/finals-dark.png',
    alt: 'The Finals week view showing three exams across Monday to Wednesday',
  },
  {
    title: 'Share your schedule',
    body: "Send friends a read-only link of the classes you plan on taking.",
    image: '/whats-new/share.png',
    imageDark: '/whats-new/share-dark.png',
    alt: 'A shared schedule opened from a link',
  },
  {
    title: 'Stanford Root in Claude',
    body: "MCP lets AI assistants like Claude and Codex use other apps. Connect Stanford Root and ask things like \"find me a 1 or 2 unit class people enjoy\": it searches courses, reads evaluations and adds classes to your Stanford Root schedule.",
    image: '/whats-new/mcp.png',
    imageDark: '/whats-new/mcp-dark.png',
    alt: 'Example questions to ask Stanford Root from Claude',
  },
] as const;

/** Longest wait for the first session check before treating the visitor as signed out. */
const AUTH_WAIT_MS = 5000;

function firstSessionCheck(): Promise<boolean> {
  return new Promise(resolve => {
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      resolve(useAuthStore.getState().user !== null);
    };
    const timer = setTimeout(done, AUTH_WAIT_MS);
    const unsubscribe = useAuthStore.subscribe(s => { if (!s.isLoading) done(); });
    if (!useAuthStore.getState().isLoading) done();
  });
}

/**
 * Whether this page load belongs to a returning student, decided once from
 * the cart as it was read back from storage and the first session check.
 * Adding a first class later in the visit must not make the card appear.
 */
const returningAtLoad = onceForPageLoad(async () => {
  await cartHydrated;
  const savedClasses = useCartStore.getState().items.length;
  const signedIn = await firstSessionCheck();
  return isReturningVisitor({ savedClasses, signedIn });
});

// Take the cart snapshot as soon as this module loads, which is during the
// first render of the app, before the visitor can add anything.
if (typeof window !== 'undefined') void returningAtLoad();

export function WhatsNew() {
  const pathname = usePathname();
  const open = useWhatsNewStore(s => s.open);
  const setOpen = useWhatsNewStore(s => s.setOpen);

  useEffect(() => {
    // A shared schedule is someone else's page; do not interrupt its viewer.
    if (isSharedSchedulePath(pathname)) return;
    if (readSeen()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    returningAtLoad().then(returning => {
      if (cancelled || !returning) return;
      timer = setTimeout(() => {
        if (cancelled || readSeen()) return;
        useWhatsNewStore.getState().show();
        track('whats_new_shown', { path: pathname ?? '', source: 'auto' });
      }, SHOW_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  const contentRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Every opening starts on the first slide, including a reopen from the header.
  useEffect(() => { if (open) setIndex(0); }, [open]);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;
  const close = () => setOpen(false);
  const go = (next: number) => setIndex(Math.max(0, Math.min(SLIDES.length - 1, next)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        ref={contentRef}
        className="max-w-lg gap-0 p-0 overflow-hidden max-h-[92dvh] flex flex-col border-0 sm:rounded-xl focus:outline-none"
        // Focus the dialog itself rather than its first button, so no button
        // opens already ringed, while the arrow keys work at once and Tab
        // stays inside the card instead of walking the page behind it.
        onOpenAutoFocus={e => {
          e.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowRight') go(index + 1);
          if (e.key === 'ArrowLeft') go(index - 1);
        }}
      >
        {/* Its own close button: the default one sat directly on the screenshot. */}
        <DialogClose className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-md transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
        {/* The screenshot sits on a grey panel with rounded top corners and a
            shadow, so it reads as a picture of the app without a hard border. */}
        <div className="shrink-0 bg-muted/70 px-6 pt-6">
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-lg bg-background shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            {/* A light and a dark capture of the app; the theme's class on
                html decides which one shows. */}
            <Image
              key={slide.image}
              src={slide.image}
              alt={slide.alt}
              fill
              sizes="(max-width: 640px) 100vw, 464px"
              className="object-cover object-left-top dark:hidden"
              priority={index === 0}
            />
            <Image
              key={slide.imageDark}
              src={slide.imageDark}
              alt={slide.alt}
              fill
              sizes="(max-width: 640px) 100vw, 464px"
              className="hidden object-cover object-left-top dark:block"
              priority={index === 0}
            />
          </div>
        </div>

        {/* Every slide's text sits in the same grid cell, only the current one
            visible, so the card keeps the height of the longest slide and the
            buttons do not jump. Shorter slides are centred in that space. */}
        <div className="grid items-center px-6 pt-6 overflow-y-auto">
          {SLIDES.map((s, i) => (
            <div
              key={s.title}
              className={`col-start-1 row-start-1 flex flex-col gap-1.5 ${i === index ? '' : 'invisible'}`}
              aria-hidden={i !== index}
            >
              {/* Identical markup on every slide, so each one measures the same. */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What&apos;s new &middot; {i + 1} of {SLIDES.length}
              </p>
              <p className="text-xl font-semibold leading-none tracking-tight text-foreground">{s.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
          ))}
          <DialogTitle className="sr-only">{slide.title}</DialogTitle>
          <DialogDescription className="sr-only">{slide.body}</DialogDescription>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-6">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${s.title} (${i + 1} of ${SLIDES.length})`}
                onClick={() => go(i)}
                className={`h-2 rounded-full transition-all ${i === index ? 'w-5 bg-primary' : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              // On the narrowest phones the last slide has no room for three
              // buttons; the dots and arrow keys still go back.
              <Button variant="ghost" className={last ? 'max-xs:hidden' : undefined} onClick={() => go(index - 1)}>Back</Button>
            )}
            {last ? (
              <>
                <Button asChild onClick={() => { track('whats_new_clicked', { target: 'connect' }); close(); }}>
                  <Link href="/connect">Set it up</Link>
                </Button>
                <Button variant="outline" onClick={close}>Done</Button>
              </>
            ) : (
              <Button onClick={() => go(index + 1)}>Next</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
