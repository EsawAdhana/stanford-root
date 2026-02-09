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
import { CalendarDays, LogOut } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

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
      <header className="flex-none h-16 border-b border-border/50 flex items-center px-6 gap-6 bg-background/90 backdrop-blur-xl sticky top-0 z-30 transition-all duration-300 justify-between">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-2.5 min-w-[160px] group">
          <Logo className="h-8 w-8 transition-transform duration-300 group-hover:scale-105" />
          <h1 className="text-xl tracking-tight font-[family-name:var(--font-outfit)] font-bold text-primary select-none">
            Root
          </h1>
        </Link>

        {/* Center: Search */}
        <div className="flex-1 flex justify-center max-w-3xl">
          <SearchBar />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center justify-end gap-2 min-w-[160px]">
          <Link href={scheduleHref}>
            <Button
              variant="ghost"
              className="relative rounded-full h-9 px-4 text-sm font-medium gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-all"
            >
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">Schedule</span>
            </Button>
          </Link>

          {user && (
            <div className="flex items-center gap-1.5 ml-1">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt=""
                  className="h-7 w-7 rounded-full ring-2 ring-border/60 ring-offset-1 ring-offset-background"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary ring-2 ring-border/60 ring-offset-1 ring-offset-background">
                  {(user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <button
                type="button"
                onClick={signOut}
                className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-secondary/80 transition-all"
                title="Sign out"
              >
                <LogOut size={14} />
              </button>
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
