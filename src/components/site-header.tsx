'use client';

import React, { useMemo } from 'react';
import { SearchBar } from '@/components/search-bar';
import { FilterSidebar } from '@/components/filter-sidebar';
import { Logo } from '@/components/logo';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { CalendarDays, LogOut, Menu } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader, SheetDescription } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function SiteHeader() {
    const searchParams = useSearchParams();
    const { user, signOut } = useAuthStore();

    const scheduleHref = useMemo(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('courseId');
        const qs = params.toString();
        return qs ? `/schedule?${qs}` : '/schedule';
    }, [searchParams]);

    return (
        <header className="flex-none h-16 md:h-16 h-auto md:py-0 py-2 border-b border-border/50 flex items-center gap-2 md:gap-4 bg-background/90 backdrop-blur-xl sticky top-0 z-30 transition-all duration-300 justify-between">
            {/* Left: Logo */}
            <div className="flex items-center gap-2 md:gap-4 shrink-0 md:w-[270px] pl-4 md:pl-0 md:justify-center">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="md:hidden -ml-2">
                            <Menu className="h-5 w-5" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 w-[300px]">
                        <SheetHeader>
                            <SheetTitle className="sr-only">Filters</SheetTitle>
                            <SheetDescription className="sr-only">
                                Filter courses by department, term, and other criteria.
                            </SheetDescription>
                        </SheetHeader>
                        <FilterSidebar />
                    </SheetContent>
                </Sheet>

                <Link href="/" className="flex items-center gap-2.5 md:min-w-[120px] group py-1 px-2 -ml-2 rounded-lg hover:bg-secondary/50 transition-colors">
                    <Logo className="h-10 w-10" />
                    <h1 className="text-2xl tracking-tight font-[family-name:var(--font-outfit)] font-bold text-primary select-none hidden sm:block transition-colors duration-300 group-hover:text-cardinal-red">
                        Stanford Root
                    </h1>
                </Link>
            </div>

            {/* Center: Search */}
            <div className="flex-1 flex justify-center md:justify-start px-2 md:px-0 min-w-0">
                <div className="w-full">
                    <SearchBar />
                </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center justify-end gap-2 shrink-0 pr-4 md:pr-6">
                <Button
                    asChild
                    variant="ghost"
                    className="relative rounded-full h-9 w-9 px-0 md:w-auto md:px-4 text-sm font-medium gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-all"
                >
                    <Link href={scheduleHref}>
                        <CalendarDays className="h-5 w-5 md:h-4 md:w-4" />
                        <span className="hidden md:inline">Schedule</span>
                    </Link>
                </Button>

                {user && (
                    <div className="flex items-center gap-1.5 ml-1">
                        <Popover>
                            <PopoverTrigger asChild>
                                <button className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full transition-transform active:scale-95">
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
