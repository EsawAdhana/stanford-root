'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { VList, VListHandle } from 'virtua';
import { useCourseStore } from '@/lib/store';
import { useFilteredCourses } from '@/hooks/use-filtered-courses';
import { CourseCard } from './course-card';
import { Course } from '@/types/course';
import { cn } from '@/lib/utils';

interface CourseListProps {
  onCourseClick: (course: Course) => void;
}

export function CourseList({ onCourseClick }: CourseListProps) {
  const { fetchCourses } = useCourseStore();
  const { courses, isLoading } = useFilteredCourses();
  const vListRef = useRef<VListHandle>(null);

  // Load data on mount
  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  // Compute indices for each letter
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
    return <div className="p-8 text-center">Loading courses...</div>;
  }

  return (
    <div className="flex-1 h-full w-full overflow-hidden flex flex-col relative">
      <div className="px-4 py-3 text-sm font-medium text-muted-foreground border-b bg-background shadow-sm z-10 flex justify-between items-center">
        <span>Showing {courses.length.toLocaleString()} classes</span>
      </div>
      
      <div className="flex-1 min-h-0 relative group">
        {courses.length === 0 ? (
           <div className="p-8 text-center text-muted-foreground">No courses found.</div>
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
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 z-20 bg-background/80 backdrop-blur-sm p-1 rounded-full shadow-sm border border-border/40 opacity-50 group-hover:opacity-100 transition-opacity">
                    {sortedLetters.map(letter => (
                        <button
                            key={letter}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleScrollToLetter(letter);
                            }}
                            className="text-[10px] font-bold text-muted-foreground hover:text-primary hover:scale-125 transition-all w-4 h-4 flex items-center justify-center leading-none"
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
