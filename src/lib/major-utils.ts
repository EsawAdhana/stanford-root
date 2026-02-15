import majorDataRaw from '../../stanford_majors_data.json';

export interface Major {
    name: string;
    link: string;
    description: string;
    requirements: Record<string, any>;
}

export interface Minor {
    name: string;
    link: string;
    description: string;
    requirements: Record<string, any>;
}

export interface Track {
    id: string;
    name: string;
}

export interface CourseLevel {
    dept: string;
    minLevel: number;
}

const majorData = majorDataRaw as any[];

/**
 * Get all majors from the Stanford majors data
 */
export function getAllMajors(): Major[] {
    return majorData.filter((program: any) =>
        program.name.includes('(BS)') ||
        program.name.includes('(BA)') ||
        program.name.includes('(BAS)')
    ) as Major[];
}

/**
 * Get all minors from the Stanford majors data
 */
export function getAllMinors(): Minor[] {
    return majorData.filter((program: any) =>
        program.name.includes('(Minor)')
    ) as Minor[];
}

/**
 * Get a specific major by its name
 */
export function getMajorById(id: string): Major | null {
    const major = majorData.find((program: any) => program.name === id);
    return major as Major || null;
}

/**
 * Get tracks/subplans for a specific major
 * For CS: AI, Systems, Theory, HCI, etc.
 * For Biology: Biochemistry/Biophysics, CMO, Computational, etc.
 */
export function getTracksForMajor(majorId: string): Track[] {
    const major = getMajorById(majorId);
    if (!major) return [];

    const tracks: Track[] = [];

    // Look for "Subplan Requirements" or similar sections
    const requirements = major.requirements;

    // For Computer Science, look for subplan requirements
    if (majorId === 'Computer Science (BS)') {
        const subplanReq = requirements['Computer Science Subplan Requirements'];
        if (subplanReq && subplanReq.fullText) {
            const text = subplanReq.fullText;
            // Extract track names from the text
            const trackPatterns = [
                'Artificial Intelligence',
                'Individually Designed',
                'Computational Biology',
                'Computer Engineering',
                'Visual Computing',
                'Human-Computer Interaction',
                'Information',
                'Systems',
                'Theory',
                'Unspecialized'
            ];

            trackPatterns.forEach(track => {
                if (text.includes(track)) {
                    tracks.push({ id: track, name: track });
                }
            });
        }
    }

    // For Biology, look for subplan sections
    if (majorId === 'Biology (BS)') {
        const reqKeys = Object.keys(requirements);
        const subplanKeys = reqKeys.filter(key =>
            key.includes('Subplan') && !key.includes('Requirements')
        );

        subplanKeys.forEach(key => {
            const cleanName = key.replace(' Subplan Electives', '').replace(' Electives', '');
            tracks.push({ id: cleanName, name: cleanName });
        });
    }

    return tracks;
}

/**
 * Extract required departments from a major's requirements
 */
export function getRequiredDepartments(majorId: string, track?: string): string[] {
    const major = getMajorById(majorId);
    if (!major) return [];

    const departments = new Set<string>();
    const requirements = major.requirements;

    // Extract course codes from all requirements
    const extractDepartments = (obj: any) => {
        if (typeof obj === 'string') {
            // Match course codes like "CS106A", "MATH51", etc.
            const matches = obj.match(/\b([A-Z]+)\d+[A-Z]?\b/g);
            if (matches) {
                matches.forEach(code => {
                    const dept = code.match(/^[A-Z]+/)?.[0];
                    if (dept) departments.add(dept);
                });
            }
        } else if (Array.isArray(obj)) {
            obj.forEach(item => extractDepartments(item));
        } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach(value => extractDepartments(value));
        }
    };

    // If track is specified, look for track-specific requirements
    if (track) {
        const trackReq = Object.keys(requirements).find(key =>
            key.toLowerCase().includes(track.toLowerCase())
        );
        if (trackReq) {
            extractDepartments(requirements[trackReq]);
        }
    } else {
        // Extract from all requirements
        extractDepartments(requirements);
    }

    return Array.from(departments).sort();
}

/**
 * Get required course levels for filtering (e.g., CS courses 100+)
 */
export function getRequiredCourseLevels(majorId: string, track?: string): CourseLevel[] {
    const major = getMajorById(majorId);
    if (!major) return [];

    const levels: CourseLevel[] = [];

    // For CS majors, add CS 100+ requirement
    if (majorId === 'Computer Science (BS)') {
        levels.push({ dept: 'CS', minLevel: 100 });

        // For specific tracks, add additional requirements
        if (track === 'Artificial Intelligence') {
            // AI track typically requires 200-level courses
            levels.push({ dept: 'CS', minLevel: 200 });
        }
    }

    // For Biology majors, add BIO 100+ requirement
    if (majorId === 'Biology (BS)') {
        levels.push({ dept: 'BIO', minLevel: 100 });
    }

    return levels;
}

/**
 * Get core required courses for a major
 */
export function getCoreRequirements(majorId: string, track?: string): string[] {
    const major = getMajorById(majorId);
    if (!major) return [];

    const coreCourses: string[] = [];
    const requirements = major.requirements;

    // Look for "Core" requirements
    const coreReq = requirements['Computer Science Core (15 units)'] ||
        requirements['Core Program Requirements'] ||
        requirements['Engineering Fundamentals'];

    if (coreReq && coreReq.courses) {
        coreCourses.push(...coreReq.courses);
    }

    return coreCourses;
}

/**
 * Check if a course matches the major requirements
 */
export function courseMatchesRequirements(
    courseCode: string,
    majorId: string,
    track?: string,
    filterType?: 'departments' | 'levels' | 'core'
): boolean {
    const courseDept = courseCode.match(/^[A-Z]+/)?.[0];
    const courseLevel = parseInt(courseCode.match(/\d+/)?.[0] || '0');

    if (!courseDept) return false;

    if (filterType === 'departments') {
        const requiredDepts = getRequiredDepartments(majorId, track);
        return requiredDepts.includes(courseDept);
    }

    if (filterType === 'levels') {
        const requiredLevels = getRequiredCourseLevels(majorId, track);
        return requiredLevels.some(
            level => level.dept === courseDept && courseLevel >= level.minLevel
        );
    }

    if (filterType === 'core') {
        const coreCourses = getCoreRequirements(majorId, track);
        return coreCourses.some(core => core.includes(courseCode));
    }

    return false;
}

export interface RequirementCategory {
    id: string;
    name: string;
    courses: string[];
    description?: string;
}

/**
 * Extract requirement categories from a major's subplan
 * For CS AI track, this would return categories like:
 * - AI Methods (CS221, CS229, etc.)
 * - Natural Language Processing (CS224N, CS224S, etc.)
 * - Vision (CS131, CS231A, CS231N)
 * - Robotics (CS123, CS223A, etc.)
 */
export function getRequirementCategories(majorId: string, track?: string): RequirementCategory[] {
    const major = getMajorById(majorId);
    if (!major) return [];

    const categories: RequirementCategory[] = [];
    const requirements = major.requirements;

    // For CS major with AI track
    if (majorId === 'Computer Science (BS)' && track === 'Artificial Intelligence') {
        const aiSubplan = requirements['Artificial Intelligence Subplan'];
        if (aiSubplan && aiSubplan.fullText) {
            const text = aiSubplan.fullText;

            // Extract Area I: AI Methods
            const aiMethodsMatch = text.match(/Area I: AI Methods[\s\S]*?(?=OR|Area II)/);
            if (aiMethodsMatch) {
                const courses = extractCourseCodes(aiMethodsMatch[0]);
                if (courses.length > 0) {
                    categories.push({
                        id: 'ai-methods',
                        name: 'AI Methods',
                        courses,
                        description: 'Core AI methodology courses'
                    });
                }
            }

            // Extract Area II: Natural Language Processing
            const nlpMatch = text.match(/Area II: Natural Language Processing[\s\S]*?(?=OR|Area III)/);
            if (nlpMatch) {
                const courses = extractCourseCodes(nlpMatch[0]);
                if (courses.length > 0) {
                    categories.push({
                        id: 'nlp',
                        name: 'Natural Language Processing',
                        courses,
                        description: 'NLP and language understanding courses'
                    });
                }
            }

            // Extract Area III: Vision
            const visionMatch = text.match(/Area III: Vision[\s\S]*?(?=OR|Area IV)/);
            if (visionMatch) {
                const courses = extractCourseCodes(visionMatch[0]);
                if (courses.length > 0) {
                    categories.push({
                        id: 'vision',
                        name: 'Computer Vision',
                        courses,
                        description: 'Computer vision and image processing courses'
                    });
                }
            }

            // Extract Area IV: Robotics
            const roboticsMatch = text.match(/Area IV: Robotics[\s\S]*?(?=Additional Areas|OR)/);
            if (roboticsMatch) {
                const courses = extractCourseCodes(roboticsMatch[0]);
                if (courses.length > 0) {
                    categories.push({
                        id: 'robotics',
                        name: 'Robotics',
                        courses,
                        description: 'Robotics and autonomous systems courses'
                    });
                }
            }
        }
    }

    // For other majors/tracks, extract from their subplan requirements
    // This is a simplified version - can be expanded for other majors
    if (track && categories.length === 0) {
        const trackKey = Object.keys(requirements).find(key =>
            key.toLowerCase().includes(track.toLowerCase()) &&
            key.toLowerCase().includes('subplan')
        );

        if (trackKey) {
            const trackReq = requirements[trackKey];
            if (trackReq && trackReq.courses) {
                categories.push({
                    id: 'track-requirements',
                    name: `${track} Requirements`,
                    courses: trackReq.courses.map((c: string) => extractCourseCode(c)).filter(Boolean) as string[],
                    description: `Required courses for ${track} track`
                });
            }
        }
    }

    return categories;
}

/**
 * Helper function to extract course codes from text
 * Matches patterns like "CS221", "MATH51", etc.
 */
function extractCourseCodes(text: string): string[] {
    const matches = text.match(/\b([A-Z&]+\d+[A-Z]?)\b/g);
    if (!matches) return [];

    // Remove duplicates and filter out invalid codes
    return Array.from(new Set(matches)).filter(code => {
        // Must have at least one letter and one number
        return /[A-Z]/.test(code) && /\d/.test(code);
    });
}

/**
 * Helper function to extract a single course code from a course string
 * "CS221 - Artificial Intelligence" -> "CS221"
 */
function extractCourseCode(courseString: string): string | null {
    const match = courseString.match(/^([A-Z&]+\d+[A-Z]?)/);
    return match ? match[1] : null;
}

/**
 * Get all courses that satisfy a requirement category
 */
export function getCoursesForCategory(category: RequirementCategory): string[] {
    return category.courses;
}

/**
 * Check if a course is in a requirement category
 */
export function courseInCategory(courseCode: string, category: RequirementCategory): boolean {
    return category.courses.some(reqCourse => {
        // Match course code (e.g., "CS221" matches "CS221 - AI")
        return reqCourse.startsWith(courseCode) || reqCourse === courseCode;
    });
}
