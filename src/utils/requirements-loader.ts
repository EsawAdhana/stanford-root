import majorsData from '../../stanford_majors_data.json';
import { Requirement } from './transcriptParser';

import gerData from '../../stanford_ger_data.json';

// Type for the raw major data from JSON
interface MajorData {
    name: string;
    requirements: Record<string, {
        fullText: string;
        courses: string[];
    }>;
}

export function getRequirementsForMajor(majorName: string): Requirement[] {
    const major = (majorsData as unknown as MajorData[]).find(m => m.name === majorName);
    if (!major) return [];

    // Convert the dictionary to an array of Requirements
    return Object.entries(major.requirements).map(([reqName, reqData]) => {
        // Initial parsing of "fullText" to guess units/count if possible
        // This is a naive heuristic since the text is unstructured natural language
        let requiredParam = 0;
        let missingUnits = 0;

        const unitsMatch = reqData.fullText.match(/(\d+)\s+units/i);
        if (unitsMatch) requiredParam = parseInt(unitsMatch[1]);

        return {
            id: reqName, // Use the name as ID for simplicity
            name: reqName,
            satisfied: false, // Default
            courses: [], // Initially empty, will be populated by store mappings
            requiredParam: requiredParam,
            missingUnits: requiredParam, // Assume all missing initially
            // We could store the "potential" courses here if we wanted to show suggestions
            // potentialCourses: reqData.courses 
        };
    });
}

export function getGerRequirements(): Requirement[] {
    const requirements: Requirement[] = [];
    // @ts-ignore
    const source = gerData.requirements;

    // 1. COLLEGE
    if (source.COLLEGE) {
        requirements.push({
            id: 'GER-COLLEGE',
            name: 'COLLEGE (Civic, Liberal, and Global Education)',
            satisfied: false,
            courses: [],
            requiredParam: 2, // 2 courses
            missingCourses: 2
        });
    }

    // 2. Writing
    if (source.Writing) {
        // WR 1
        requirements.push({
            id: 'GER-Writing-WR1',
            name: 'Writing 1 (WR 1)',
            satisfied: false,
            courses: [],
            requiredParam: 1,
            missingCourses: 1
        });
        // WR 2
        requirements.push({
            id: 'GER-Writing-WR2',
            name: 'Writing 2 (WR 2)',
            satisfied: false,
            courses: [],
            requiredParam: 1,
            missingCourses: 1
        });
        // WIM
        requirements.push({
            id: 'GER-Writing-WIM',
            name: 'Writing in the Major (WIM)',
            satisfied: false,
            courses: [],
            requiredParam: 1,
            missingCourses: 1
        });
    }

    // 3. Language
    if (source.Language) {
        requirements.push({
            id: 'GER-Language',
            name: 'Language Requirement',
            satisfied: false,
            courses: [],
            requiredParam: 12, // Approx 1 year = ~12 units
            missingUnits: 12
        });
    }

    // 4. Ways
    if (source.Ways && source.Ways.subRequirements) {
        // @ts-ignore
        source.Ways.subRequirements.forEach((way: any) => {
            requirements.push({
                id: `GER-${way.code}`,
                name: `${way.code}: ${way.name}`,
                satisfied: false,
                courses: [],
                requiredParam: way.count, // Usually courses, sometimes units (Ways-CE)
                missingCourses: way.count
            });
        });
    }

    return requirements;
}
