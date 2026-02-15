'use client';

import React from 'react';
import Link from 'next/link';
import { useCourseStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface CourseDescriptionProps {
    description: string;
    className?: string;
}

export function CourseDescription({ description, className }: CourseDescriptionProps) {
    const { courses } = useCourseStore();

    if (!description) return null;

    // Helper to render description with clickable course links
    const renderDescriptionWithLinks = (text: string) => {
        // Regex to find potential course codes (e.g. "CS 106A", "MATH 51")
        // Matches: Word boundary, 2-4 uppercase letters, space, 1-3 digits, optional letter suffix, word boundary
        const courseRegex = /\b([A-Z]{2,4})\s+(\d{1,3}[A-Z]?)\b/g;

        const parts = [];
        let lastIndex = 0;
        let match;

        while ((match = courseRegex.exec(text)) !== null) {
            // Add text before match
            if (match.index > lastIndex) {
                parts.push(text.substring(lastIndex, match.index));
            }

            const subject = match[1];
            const code = match[2];
            const fullCode = `${subject} ${code}`;

            // Find course in store
            const targetCourse = courses.find(c => c.subject === subject && c.code === code);

            if (targetCourse) {
                parts.push(
                    <Link
                        key={`${match.index}-${fullCode}`}
                        href={`/courses/${targetCourse.id}`}
                        className="text-primary hover:underline font-medium"
                        onClick={(e) => {
                            e.stopPropagation();
                        }}
                    >
                        {fullCode}
                    </Link>
                );
            } else {
                parts.push(fullCode);
            }

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            parts.push(text.substring(lastIndex));
        }

        return parts;
    };

    return (
        <div className={className}>
            <p className="text-muted-foreground text-base leading-relaxed font-normal">
                {renderDescriptionWithLinks(description)}
            </p>
        </div>
    )
}
