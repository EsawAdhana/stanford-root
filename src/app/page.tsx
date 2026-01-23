'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { CourseList } from '@/components/course-list';
import { SearchBar } from '@/components/search-bar';
import { FilterSidebar } from '@/components/filter-sidebar';
import { CourseDetail } from '@/components/course-detail';
import { Logo } from '@/components/logo';
import { useQueryState } from 'nuqs';
import { Course } from '@/types/course';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/lib/cart-store';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

function HomeContent() {
  const [selectedCourseId, setSelectedCourseId] = useQueryState('courseId');
  const cartItems = useCartStore(state => state.items);
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams()

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
      <header className="flex-none h-20 border-b border-border/40 flex items-center px-8 gap-8 bg-background/80 backdrop-blur-xl sticky top-0 z-30 transition-all duration-300 justify-between">
        <Link href="/" className="flex items-center gap-3 min-w-[200px] hover:opacity-80 transition-opacity cursor-pointer">
            <Logo className="h-9 w-9 shadow-primary/20" />
            <h1 className="text-2xl tracking-tight text-foreground font-[family-name:var(--font-outfit)] font-medium">
                Navi<span className="font-bold text-primary">Greater</span>
            </h1>
        </Link>
        
        <div className="flex-1 flex justify-center max-w-4xl">
            <SearchBar />
        </div>
        
        <div className="flex items-center justify-end gap-4 min-w-[200px]">
            <Link href={scheduleHref}>
                <Button 
                    variant="outline" 
                    className="relative rounded-full h-11 px-6 border-border/60 hover:bg-secondary/80 hover:border-border transition-all shadow-sm font-medium gap-2"
                >
                    <ShoppingBag className="h-4 w-4" />
                    <span>My Schedule</span>
                </Button>
            </Link>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[300px] border-r border-border/40 bg-card/50 hidden md:block backdrop-blur-sm z-10 pt-4">
            <FilterSidebar />
        </aside>

        {/* Course List */}
        <main className="flex-1 flex flex-col min-w-0 bg-secondary/30 relative">
             {/* Subtle gradient overlay */}
             <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-transparent pointer-events-none z-0" />
             <div className="z-10 h-full">
                <CourseList onCourseClick={handleCourseClick} />
             </div>
        </main>

        {/* Detail View (Side Panel style) */}
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
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
