"use client";

import React, { useEffect, useState } from 'react';
import { useDegreeStore } from '@/stores/degree-store';
import majorsData from '../../../stanford_majors_data.json';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Map the raw JSON data to a usable format
// The JSON is an array of objects
const MAJORS = (majorsData as any[]).map((m) => ({
    id: m.name, // using name as ID for now since it's unique enough
    name: m.name,
}));

export function MajorSelector() {
    const { selectedMajorId, actions } = useDegreeStore();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <div className="h-10 w-full bg-gray-100 animate-pulse rounded-md" />;

    return (
        <div className="w-full max-w-sm">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Select Major Track
            </label>
            <Select
                value={selectedMajorId || ''}
                onValueChange={(val) => actions.selectMajor(val)}
            >
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a major..." />
                </SelectTrigger>
                <SelectContent>
                    {MAJORS.map((major) => (
                        <SelectItem key={major.id} value={major.id}>
                            {major.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
