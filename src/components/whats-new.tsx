'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/lib/cart-store';
import { useAuthStore } from '@/lib/auth-store';
import { cartHydrated } from '@/lib/cart-hydration';
import { track } from '@/lib/analytics';

/**
 * A one-time card announcing the November 2026 schedule features.
 *
 * Shown once per browser, and only to people who have used the schedule
 * before (a saved class in this browser, or signed in). A first-time visitor
 * arriving on a course page from a search engine has nothing to compare
 * against, so a "what's new" card would only be in their way.
 *
 * Bump SEEN_KEY for the next announcement; the old key is simply ignored.
 */
const SEEN_KEY = 'whats-new-seen:2026-11-schedule';

/** Wait for the page to settle so the card never lands on top of a loading screen. */
const SHOW_DELAY_MS = 1200;

const ITEMS = [
  {
    title: 'Plan A and Plan B',
    body: 'Keep a backup schedule for a quarter and switch between them. Each plan shows its units and hours a week.',
    image: '/whats-new/plans.png',
    alt: 'The schedule page with Plan A and Plan B tabs above the calendar',
  },
  {
    title: 'Finals week',
    body: 'See when each final exam is, and which ones land at the same time.',
    image: '/whats-new/finals.png',
    alt: 'The Finals week view showing exam times for each class',
  },
  {
    title: 'Share your schedule',
    body: 'Send friends a read-only link. It shows your classes, not your name.',
    image: '/whats-new/share.png',
    alt: 'A shared schedule opened from a link',
  },
] as const;

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    // Storage blocked (private mode): never nag, since we could not remember a dismissal.
    return true;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    // Nothing to do; the card will not show again this session either way.
  }
}

export function WhatsNew() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // A shared schedule is someone else's page; do not interrupt its viewer.
    if (pathname?.startsWith('/s')) return;
    if (alreadySeen()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cartHydrated.then(() => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled || alreadySeen()) return;
        const returning = useCartStore.getState().items.length > 0 || useAuthStore.getState().user !== null;
        if (!returning) return;
        markSeen();
        setOpen(true);
        track('whats_new_shown', { path: pathname ?? '' });
      }, SHOW_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md gap-5 p-0 overflow-hidden max-h-[90dvh] flex flex-col">
        <DialogHeader className="px-6 pt-6 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What&apos;s new</p>
          <DialogTitle className="text-xl">Three new ways to plan your quarter</DialogTitle>
          <DialogDescription className="sr-only">
            Plan A and Plan B, a Finals week view, and shareable schedule links.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-4 px-6 overflow-y-auto">
          {ITEMS.map(item => (
            <li key={item.title} className="flex gap-4 items-start">
              <div className="relative h-[72px] w-[112px] shrink-0 overflow-hidden rounded-md border bg-muted">
                <Image src={item.image} alt={item.alt} fill sizes="112px" className="object-cover object-left-top" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground leading-snug">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter className="flex-row justify-end gap-2 border-t px-6 py-4 sm:space-x-0">
          <Button variant="outline" onClick={close}>Got it</Button>
          {pathname !== '/schedule' && (
            <Button asChild onClick={() => { track('whats_new_clicked', {}); close(); }}>
              <Link href="/schedule">Open my schedule</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
