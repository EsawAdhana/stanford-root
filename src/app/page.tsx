'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { CourseList } from '@/components/course-list';
import { SearchBar } from '@/components/search-bar';
import { FilterSidebar } from '@/components/filter-sidebar';
import { CourseDetail } from '@/components/course-detail';
import { Logo } from '@/components/logo';
import { AuthGate } from '@/components/auth-gate';
import { useAuthStore } from '@/lib/auth-store';
import { useQueryState } from 'nuqs';
import { Course } from '@/types/course';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/lib/cart-store';
import Link from 'next/link';
import { CalendarDays, LogOut, SlidersHorizontal, Menu } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader, SheetDescription } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function HomeContent() {
  const [selectedCourseId, setSelectedCourseId] = useQueryState('courseId');
  const cartItems = useCartStore(state => state.items);
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams()
  const { user, signOut } = useAuthStore()

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleCourseClick = (course: Course) => {
    setSelectedCourseId(course.id);
  };

  const scheduleHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('courseId')
    const qs = params.toString()
    return qs ? `/schedule?${qs}` : '/schedule'
  }, [searchParams])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
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

          <Link href="/" className="flex items-center gap-2.5 md:min-w-[120px] group">
            <Logo className="h-10 w-10 transition-transform duration-300 group-hover:scale-105" />
            <h1 className="text-2xl tracking-tight font-[family-name:var(--font-outfit)] font-bold text-primary select-none hidden sm:block">
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

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[280px] border-r border-border/40 bg-background hidden md:block overflow-y-auto custom-scrollbar">
          <FilterSidebar />
        </aside>

        {/* Course List */}
        <main className="flex-1 flex flex-col min-w-0 bg-secondary/20 relative">
          <CourseList onCourseClick={handleCourseClick} />
        </main>

        {/* Detail View */}
        {selectedCourseId && (
          <CourseDetail
            courseId={selectedCourseId}
            onClose={() => setSelectedCourseId(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-8 w-8 rounded-xl bg-primary/10 animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    }>
      <AuthGate>
        <HomeContent />
      </AuthGate>
    </Suspense>
  );
}
