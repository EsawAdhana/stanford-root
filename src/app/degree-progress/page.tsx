"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragEndEvent,
    useDroppable
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useDegreeStore, isCourseAssigned } from '@/stores/degree-store';
import { MajorSelector } from '@/components/degree-progress/MajorSelector';
import { CourseSearch } from '@/components/degree-progress/CourseSearch';
import { RequirementBucket } from '@/components/degree-progress/RequirementBucket';
import { DraggableCourse } from '@/components/degree-progress/DraggableCourse';
import { getRequirementsForMajor, getGerRequirements } from '@/utils/requirements-loader';
import { Requirement, CourseItem } from '@/utils/transcriptParser';

export default function DegreeProgressPage() {
    const { selectedMajorId, completedCourses, requirementMappings, actions } = useDegreeStore();
    const [activeId, setActiveId] = useState<string | null>(null);
    const [activeCourse, setActiveCourse] = useState<CourseItem | null>(null);

    // Load requirements for the selected major
    // We use useMemo but logically this should change when selectedMajorId changes
    const majorRequirements = useMemo(() => {
        if (!selectedMajorId) return [];
        return getRequirementsForMajor(selectedMajorId);
    }, [selectedMajorId]);

    // Load GER requirements
    const gerRequirements = useMemo(() => {
        return getGerRequirements();
    }, []);

    // Sidebar "Unassigned" Droppable
    const { setNodeRef: setUnassignedRef } = useDroppable({
        id: 'unassigned-bucket',
    });

    // Filter courses that are NOT assigned to any requirement
    // (unless we allow multiple assignments, but store assumes single for now)
    const unassignedCourses = useMemo(() => {
        return completedCourses.filter(c => !isCourseAssigned({ requirementMappings } as any, c.code));
    }, [completedCourses, requirementMappings]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // Prevent accidental drags on click
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        setActiveId(active.id as string);
        // Find the course object from active.data or search
        if (active.data.current?.course) {
            setActiveCourse(active.data.current.course);
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        const course = active.data.current?.course as CourseItem;

        if (!over || !course) {
            setActiveId(null);
            setActiveCourse(null);
            return;
        }

        const overId = over.id as string;

        if (overId === 'unassigned-bucket') {
            // Remove from any requirement it might be in
            // We iterate to find where it is
            for (const [reqId, courses] of Object.entries(requirementMappings)) {
                if (courses.some(c => c.code === course.code)) {
                    actions.removeCourseFromRequirement(course.code, reqId);
                    break;
                }
            }
        } else {
            // It's a requirement bucket (ID is the reqId)
            // Check if it's already there? Handled by store
            actions.assignCourseToRequirement(course, overId);
        }

        setActiveId(null);
        setActiveCourse(null);
    };

    return (
        <div className="container mx-auto p-6 max-w-[95rem] min-h-screen">
            <h1 className="text-3xl font-bold mb-6">Degree Progress</h1>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Left Sidebar: Controls & Unassigned */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border shadow-sm">
                        <MajorSelector />
                    </div>

                    <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border shadow-sm space-y-4">
                        <h2 className="font-semibold text-lg">Add Courses</h2>
                        <CourseSearch />
                    </div>

                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <div
                            ref={setUnassignedRef}
                            className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border-2 border-dashed border-gray-200 min-h-[300px]"
                        >
                            <h2 className="font-semibold text-sm mb-3">Unassigned Courses</h2>
                            <div className="space-y-2">
                                {unassignedCourses.map(course => (
                                    <DraggableCourse key={course.code} course={course} id={`unassigned:${course.code}`} />
                                ))}
                                {unassignedCourses.length === 0 && (
                                    <div className="text-xs text-gray-400 text-center py-4">
                                        No unassigned courses. Add some above!
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Main Content: Requirements Map */}
                        <div className="lg:col-span-3 space-y-8">
                            {/* GER Section */}
                            <div>
                                <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100 flex items-center gap-2">
                                    <span className="text-cardinal-red">●</span> General Education
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {gerRequirements.map(req => {
                                        // Merge basic req data with assigned courses from store
                                        const assigned = requirementMappings[req.id] || [];

                                        return (
                                            <RequirementBucket
                                                key={req.id}
                                                requirement={req}
                                                assignedCourses={assigned}
                                            />
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Major Section */}
                            <div>
                                <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100 flex items-center gap-2">
                                    <span className="text-cardinal-red">●</span> Major Requirements
                                </h2>
                                {!selectedMajorId ? (
                                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-xl text-gray-400">
                                        <p className="text-lg">Please select a major to view requirements.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                        {majorRequirements.map(req => {
                                            // Merge basic req data with assigned courses from store
                                            const assigned = requirementMappings[req.id] || [];

                                            return (
                                                <RequirementBucket
                                                    key={req.id}
                                                    requirement={req}
                                                    assignedCourses={assigned}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <DragOverlay>
                            {activeCourse ? (
                                <div className="opacity-90 rotate-3 scale-105 cursor-grabbing">
                                    <div className="bg-white dark:bg-gray-800 border-2 border-blue-500 rounded-lg p-3 shadow-xl w-64">
                                        <div className="font-bold text-blue-600">{activeCourse.code}</div>
                                        <div className="text-sm truncate">{activeCourse.title}</div>
                                    </div>
                                </div>
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                </div>
            </div>
        </div>
    );
}
