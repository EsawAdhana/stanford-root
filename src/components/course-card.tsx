import React from 'react';
import { Course } from '@/types/course';
import { cn, getDepartmentUrl } from '@/lib/utils';
import { Calendar, User, BookOpen } from 'lucide-react';
import { InstructorList } from './instructor-list';

interface CourseCardProps {
  course: Course;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const CourseCard = React.memo(({ course, style, onClick }: CourseCardProps) => {
  return (
    <div 
      style={style} 
      className="p-3"
    >
      <div 
        className="h-full w-full rounded-2xl bg-card text-card-foreground shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition-all duration-300 cursor-pointer flex flex-col p-6 group border border-border/50 hover:border-primary/20 relative overflow-hidden"
        onClick={onClick}
      >
        <div className="flex justify-between items-start mb-3">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-destructive tracking-wide uppercase opacity-90 group-hover:opacity-100 transition-opacity">
              <a 
                href={getDepartmentUrl(course.subject)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:underline"
                title={`Visit ${course.subject} Department Website`}
              >
                {course.subject}
              </a>
              {' '}{course.code}
            </span>
          </div>
          <div className="bg-secondary/60 text-secondary-foreground text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ml-2">
            {course.selectedUnits !== undefined
              ? `${course.selectedUnits} ${course.selectedUnits === 1 ? 'Unit' : 'Units'}`
              : `${course.units} ${course.units.toString().trim() === '1' ? 'Unit' : 'Units'}`}
          </div>
        </div>
        
        <h3 className="font-semibold text-lg leading-tight mb-3 line-clamp-2 text-foreground/95" title={course.title}>
          {course.title}
        </h3>

        <div className="mt-auto pt-4 border-t border-dashed border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2 max-w-[65%]">
             <InstructorList instructors={course.instructors} />
          </div>
          
          {/* Show either single term or multiple terms */}
          {(course.terms && course.terms.length > 0) ? (
            <div className="flex items-center gap-1.5 font-medium opacity-80 shrink-0">
              <Calendar size={12} className="shrink-0" />
              <span className="truncate max-w-[80px] text-right">
                {course.terms.length} {course.terms.length === 1 ? 'Term' : 'Terms'}
              </span>
            </div>
          ) : course.term ? (
            <div className="flex items-center gap-1.5 font-medium opacity-80 shrink-0">
              <Calendar size={12} className="shrink-0" />
              <span className="truncate max-w-[80px] text-right">{course.term.split(' ')[0]}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

CourseCard.displayName = 'CourseCard';
