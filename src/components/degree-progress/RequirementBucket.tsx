"use client";

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { CourseItem, Requirement } from '@/utils/transcriptParser';
import { DraggableCourse } from './DraggableCourse';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle } from 'lucide-react';
import { useDegreeStore } from '@/stores/degree-store';

interface RequirementBucketProps {
    requirement: Requirement;
    assignedCourses: CourseItem[];
}

export function RequirementBucket({ requirement, assignedCourses }: RequirementBucketProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: requirement.id,
        data: { requirement }, // Pass data for drop handler
    });

    const { actions } = useDegreeStore();

    const isSatisfied = requirement.satisfied ||
        (assignedCourses.length > 0 &&
            (!requirement.missingUnits || assignedCourses.reduce((sum, c) => sum + c.units, 0) >= (requirement.requiredParam || 0)) // simplistic logic
        );

    const statusColor = isSatisfied ? "border-green-200 bg-green-50/30" :
        isOver ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20" :
            "border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/50";

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "border-2 border-dashed rounded-xl p-4 transition-colors min-h-[160px] flex flex-col gap-3",
                statusColor
            )}
        >
            <div className="flex justify-between items-start border-b border-gray-200/50 pb-2">
                <div className="flex gap-2 items-center">
                    {isSatisfied ? <CheckCircle2 className="text-green-500 h-5 w-5" /> : <Circle className="text-gray-300 h-5 w-5" />}
                    <span className="font-semibold text-sm">{requirement.name}</span>
                </div>
                <span className="text-xs text-gray-500">
                    {requirement.requiredParam ? `${requirement.requiredParam} Units` : ''}
                </span>
            </div>

            <div className="flex-1 flex flex-col gap-2 relative min-h-[50px]">
                {assignedCourses.map((course) => (
                    <div key={`${requirement.id}-${course.code}`} className="relative group">
                        <DraggableCourse course={course} id={`${requirement.id}:${course.code}`} />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.removeCourseFromRequirement(course.code, requirement.id);
                            }}
                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 w-4 h-4 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
                            title="Remove"
                        >
                            ×
                        </button>
                    </div>
                ))}

                {assignedCourses.length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-xs text-gray-400 italic text-center p-4">
                        Drag matching courses here
                    </div>
                )}
            </div>
        </div>
    );
}
