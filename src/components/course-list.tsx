'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { VList, VListHandle } from 'virtua';
import { useCourseStore } from '@/lib/store';
import { useFilteredCourses } from '@/hooks/use-filtered-courses';
import { CourseCard } from './course-card';
import { Course } from '@/types/course';
import { SearchX } from 'lucide-react';

interface CourseListProps {
  onCourseClick: (course: Course) => void;
}

export function CourseList({ onCourseClick }: CourseListProps) {
  const { fetchCourses } = useCourseStore();
  const { courses, isLoading } = useFilteredCourses();
  const vListRef = useRef<VListHandle>(null);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const letterMap = useMemo(() => {
    const map = new Map<string, number>();
    courses.forEach((course, index) => {
      const firstChar = course.subject.charAt(0).toUpperCase();
      if (!map.has(firstChar)) {
        map.set(firstChar, index);
      }
    });
    return map;
  }, [courses]);

  const sortedLetters = useMemo(() => {
    return Array.from(letterMap.keys()).sort();
  }, [letterMap]);

  const handleScrollToLetter = (letter: string) => {
    const index = letterMap.get(letter);
    if (index !== undefined && vListRef.current) {
      vListRef.current.scrollToIndex(index, { align: 'start' });
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <div className="flex-1 h-full w-full overflow-hidden flex flex-col relative">
      {/* Results bar */}
      <div className="px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border/30 bg-background/80 backdrop-blur-sm z-10 flex items-center gap-2">
        <span>
          <span className="tabular-nums font-semibold text-foreground/70">{courses.length.toLocaleString()}</span>
          {' '}classes
        </span>
      </div>

      <div className="flex-1 min-h-0 relative group">
        {courses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <SearchX size={32} className="text-muted-foreground/30" />
            <p className="text-sm font-medium">No courses match your filters.</p>
            <p className="text-xs text-muted-foreground/60">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <>
            <VList ref={vListRef} className="h-full w-full scrollbar-hide pb-8">
              {courses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onClick={() => onCourseClick(course)}
                />
              ))}
            </VList>

            {/* Alphabet Scrubber */}
            {sortedLetters.length > 1 && (
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex flex-col gap-px z-20 bg-background/90 backdrop-blur-md py-1.5 px-0.5 rounded-full shadow-sm border border-border/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {sortedLetters.map(letter => (
                  <button
                    key={letter}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScrollToLetter(letter);
                    }}
                    className="text-[9px] font-bold text-muted-foreground/50 hover:text-primary hover:scale-150 transition-all w-3.5 h-3.5 flex items-center justify-center leading-none rounded-full hover:bg-primary/5"
                    title={`Jump to ${letter}`}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
