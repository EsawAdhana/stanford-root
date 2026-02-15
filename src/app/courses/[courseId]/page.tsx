'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCourseStore } from '@/lib/store';
import { SiteHeader } from '@/components/site-header';
import { CourseDetailContent } from '@/components/course-detail-content';
import { useCartStore } from '@/lib/cart-store';

export default function CoursePage() {
    const params = useParams();
    const courseId = params.courseId as string;
    const [mounted, setMounted] = useState(false);

    const { courses, fetchCourses, hasLoaded } = useCourseStore();
    const { getItem } = useCartStore();

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        fetchCourses();
    }, [fetchCourses]);

    const course = useMemo(() => {
        let found = courses.find(c => c.id === courseId);
        if (!found) {
            const cartItem = getItem(courseId);
            if (cartItem) found = cartItem;
        }
        return found;
    }, [courses, courseId, getItem]);

    // Same initial output on server and first client render to avoid hydration mismatch
    if (!mounted) {
        return (
            <div className="min-h-screen bg-background flex flex-col">
                <SiteHeader />
                <main className="flex-1 bg-background">
                    <div className="flex flex-1 items-center justify-center">
                        <div className="flex flex-col items-center gap-3 animate-fade-in">
                            <div className="h-8 w-8 rounded-xl bg-primary/10 animate-pulse" />
                            <span className="text-sm text-muted-foreground">Loading course details...</span>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <SiteHeader />
            <main className="flex-1 bg-background">
                {!hasLoaded && !course ? (
                    <div className="flex flex-1 items-center justify-center">
                        <div className="flex flex-col items-center gap-3 animate-fade-in">
                            <div className="h-8 w-8 rounded-xl bg-primary/10 animate-pulse" />
                            <span className="text-sm text-muted-foreground">Loading course details...</span>
                        </div>
                    </div>
                ) : !course ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4">
                        <h1 className="text-2xl font-bold">Course Not Found</h1>
                        <p className="text-muted-foreground">The course you are looking for does not exist or has been removed.</p>
                    </div>
                ) : (
                    <CourseDetailContent course={course} />
                )}
            </main>
        </div>
    );
}
