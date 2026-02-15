"use client";

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CourseItem } from '@/utils/transcriptParser';
import { CourseCard } from '@/components/course-card';
import { Course } from '@/types/course';
import { cn } from '@/lib/utils';
import { GripVertical, Info } from 'lucide-react';
import Link from 'next/link';

interface DraggableCourseProps {
    course: CourseItem;
    id: string; // Unique ID for dnd (e.g. course code or instance ID)
}

// Helper to adapt CourseItem to Course for the UI
const toCourse = (item: CourseItem): Course => {
    const parts = item.code.split(' ');
    const subject = parts[0] || 'UNK';

    return {
        id: item.code,
        subject: subject,
        code: parts.slice(1).join(' ') || item.code,
        title: item.title,
        description: '',
        units: item.units.toString(),
        grading: '',
        instructors: [],
        term: item.term,
        // Add color/styling based on status if needed
    };
};

export function DraggableCourse({ course, id }: DraggableCourseProps) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: id,
        data: { course }, // Pass data for drop handler
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "relative touch-none",
                isDragging ? "z-50 opacity-80" : ""
            )}
            {...attributes}
            {...listeners}
        >
            <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link
                    href={`/courses/${course.code}`}
                    target="_blank"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="cursor-pointer text-gray-400 hover:text-blue-500 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="View Course Details"
                >
                    <Info size={14} />
                </Link>
                <div className="cursor-grab active:cursor-grabbing text-gray-400 p-0.5">
                    <GripVertical size={14} />
                </div>
            </div>
            {/* Use a simplified view or the full card associated with visual tweaks */}
            <div className="bg-white dark:bg-gray-800 border rounded-lg p-3 shadow-sm text-sm hover:shadow-md transition-shadow group">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="font-bold text-blue-600 dark:text-blue-400">{course.code}</div>
                        <div className="font-medium line-clamp-1" title={course.title}>{course.title}</div>
                    </div>
                    <div className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                        {course.units}u
                    </div>
                </div>
                <div className="mt-2 flex justify-between items-end text-xs text-gray-500">
                    <span>{course.term}</span>
                    {course.grade && <span>{course.grade}</span>}
                </div>
            </div>
        </div>
    );
}
