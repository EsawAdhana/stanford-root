'use client';

import React, { useMemo } from 'react';
import { SearchBar } from '@/components/search-bar';
import { MobileFilterMenu } from '@/components/mobile-filter-menu';
import { Logo } from '@/components/logo';
import { useAuthStore } from '@/lib/auth-store';
import { StanfordLoginButton } from '@/components/stanford-login-button';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import Link from 'next/link';
import { CalendarDays, LogOut } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function SiteHeader() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isFaq = pathname.toLowerCase() === '/faq';
    const isCatalog = pathname === '/';
    // Scoped selectors so the header (mounted on every page) doesn't re-render
    // on unrelated auth-store changes (e.g. isSigningIn toggles).
    const user = useAuthStore(s => s.user);
    const isLoading = useAuthStore(s => s.isLoading);
    const signOut = useAuthStore(s => s.signOut);

    const scheduleHref = useMemo(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('courseId');
        const qs = params.toString();
        return qs ? `/schedule?${qs}` : '/schedule';
    }, [searchParams]);

    // Logo: from another page → catalog with search preserved; already on catalog → catalog with search cleared
    const homeHref = useMemo(() => {
        if (pathname === '/') return '/';
        const params = new URLSearchParams(searchParams.toString());
        params.delete('courseId');
        const qs = params.toString();
        return qs ? `/?${qs}` : '/';
    }, [pathname, searchParams]);

    return (
        <header className="flex-none h-14 sm:h-16 md:h-16 border-b border-border/50 flex items-center gap-2 md:gap-4 bg-background/90 backdrop-blur-xl sticky top-0 z-30 transition-all duration-300 justify-between px-2 sm:px-0">
            {/* Left: Logo + Filters (sheet) */}
            <div className="flex items-center gap-2 md:gap-4 shrink-0 md:w-[270px] pl-2 sm:pl-4 md:pl-0 md:justify-center">
                {isCatalog && <MobileFilterMenu />}

                <Link href={homeHref} className="flex items-center gap-2.5 md:min-w-[120px] group py-1 px-1 sm:px-2 -ml-1 sm:-ml-2 rounded-lg hover:bg-secondary/50 transition-colors">
                    <Logo className="h-9 w-9 sm:h-10 sm:w-10 shrink-0" />
                    <h1 className="font-display text-3xl tracking-tight text-foreground select-none hidden sm:block whitespace-nowrap">
                        Stanford Root
                    </h1>
                </Link>
            </div>

            {isCatalog && (
                <div className="flex-1 flex flex-col justify-center md:justify-start px-1 sm:px-2 md:px-0 min-w-0">
                    <div className="w-full">
                        <SearchBar />
                    </div>
                </div>
            )}

            {/* Right: Actions */}
            <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0 pr-2 sm:pr-4 md:pr-6">
                <ThemeToggle />

                {!isFaq && (
                    <Button
                        asChild
                        variant="ghost"
                        className="relative rounded-lg h-9 w-9 px-0 md:w-auto md:px-4 text-sm font-medium gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-all"
                    >
                        <Link href={scheduleHref} aria-label="Schedule">
                            <CalendarDays className="h-5 w-5 md:h-4 md:w-4" />
                            <span className="hidden md:inline">Schedule</span>
                        </Link>
                    </Button>
                )}

                {!user && !isLoading && (
                    <StanfordLoginButton
                        source="header"
                        size="default"
                        signingInLabel="Signing in…"
                        className="ml-1 rounded-lg h-9 px-4 text-sm font-medium gap-2"
                    >
                        Log in
                    </StanfordLoginButton>
                )}

                {user && (
                    <div className="flex items-center gap-1.5 ml-1">
                        <Popover>
                            <PopoverTrigger asChild>
                                <button aria-label="Account menu" className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full transition-transform active:scale-95">
                                    {user.user_metadata?.avatar_url ? (
                                        <img
                                            src={user.user_metadata.avatar_url}
                                            alt=""
                                            className="h-8 w-8 rounded-full ring-2 ring-border/60 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary ring-2 ring-border/60 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all">
                                            {(user.email || '?')[0].toUpperCase()}
                                        </div>
                                    )}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-1" align="end" sideOffset={8}>
                                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/40 mb-1">
                                    {user.email}
                                </div>
                                <button
                                    onClick={signOut}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-sm transition-colors"
                                >
                                    <LogOut className="h-4 w-4" />
                                    Sign out
                                </button>
                            </PopoverContent>
                        </Popover>
                    </div>
                )}
            </div>
        </header>
    );
}
