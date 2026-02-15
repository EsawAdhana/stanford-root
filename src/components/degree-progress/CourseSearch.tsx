"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDegreeStore } from '@/stores/degree-store';
import { CourseItem } from '@/utils/transcriptParser';

// Simplified type for search results from API
interface ApiCourse {
    course_id: string;
    code: string;
    title: string;
    units: any; // could be string or number in DB
    terms?: string[];
}

export function CourseSearch() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ApiCourse[]>([]);
    const [allCourses, setAllCourses] = useState<ApiCourse[]>([]);
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const { actions } = useDegreeStore();
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Load all courses on mount for client-side filtering (simulating what the existing API does)
    useEffect(() => {
        async function fetchCourses() {
            try {
                const res = await fetch('/api/courses');
                if (!res.ok) throw new Error('Failed to fetch courses');
                const data = await res.json();
                setAllCourses(data);
            } catch (err) {
                console.error(err);
            } finally {
                setInitializing(false);
            }
        }
        fetchCourses();
    }, []);

    // Filter logic
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (!query.trim()) {
            setResults([]);
            return;
        }

        setLoading(true);
        debounceRef.current = setTimeout(() => {
            const lowerQ = query.toLowerCase();
            const filtered = allCourses
                .filter(c =>
                    c.code.toLowerCase().includes(lowerQ) ||
                    c.title.toLowerCase().includes(lowerQ)
                )
                .slice(0, 50); // Limit results
            setResults(filtered);
            setLoading(false);
        }, 300);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, allCourses]);

    const handleAddCourse = (course: ApiCourse) => {
        // Convert API course to CourseItem
        // Handle units carefully
        let unitsVal = 0;
        if (typeof course.units === 'number') unitsVal = course.units;
        else if (typeof course.units === 'string') {
            // "3-5" or "4"
            const match = course.units.match(/(\d+)/);
            if (match) unitsVal = parseInt(match[1]);
        }

        const newItem: CourseItem = {
            code: course.code,
            title: course.title,
            units: unitsVal,
            grade: 'Planned', // Default
            term: course.terms?.[0] || 'Unknown',
            status: 'Planned'
        };

        actions.addCompletedCourse(newItem);
        // Optional: clear query or show toast
    };

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                    placeholder={initializing ? "Loading course catalog..." : "Search to add courses..."}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                    disabled={initializing}
                />
                {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />}
            </div>

            {results.length > 0 && (
                <div className="border rounded-md max-h-60 overflow-y-auto bg-white dark:bg-gray-800 shadow-sm">
                    {results.map(course => (
                        <div
                            key={course.course_id}
                            className="p-2 border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex justify-between items-center group cursor-pointer"
                            onClick={() => handleAddCourse(course)}
                        >
                            <div className="flex-1 min-w-0 pr-2">
                                <div className="font-bold text-sm truncate">{course.code}</div>
                                <div className="text-xs text-gray-500 truncate">{course.title}</div>
                            </div>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {!loading && query && results.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-2">No results found</div>
            )}
        </div>
    );
}
