import { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

export interface CourseItem {
    code: string;
    title: string;
    units: number;
    grade: string;
    term: string;
    status: 'Completed' | 'In Progress' | 'Planned';
}

export interface Requirement {
    id: string; // e.g. "Way-AQR", "Engr-Fundamentals", "HCI-Depth"
    name: string;
    satisfied: boolean;
    courses: CourseItem[];
    // Gap Attributes
    missingUnits?: number;
    missingCourses?: number;
    requiredParam?: number; // e.g. 13 units, 2 classes
    // Optional sub-requirements or details could be added here if needed for deeper recursion, 
    // but a flat list of requirements with clear IDs might be easier to manage for now.
    // For nested structures like Depth -> Sub-Reqs, we might need a recursive type or just specific handling.
    subRequirements?: Requirement[];
}

export interface DegreeProgress {
    studentName: string;
    totalUnits: number;
    totalUnitsNeeded: number;
    requirements: Requirement[];
    unusedElectives: CourseItem[];
}

const BULLET_CHAR = '•';
const COURSE_REGEX = /^\s*(.+?)\s+([A-Z]{2}\/\d{2})\s+(\d+)\s+([A-Z\+\-]+|S|CR|NC|IP|T|L|RP)$/;
const TERM_REGEX = /([A-Z]{2}\/\d{2})/;

export async function parseMapPdf(file: File): Promise<{ degreeProgress: DegreeProgress, debugText: string }> {
    // Dynamically import pdfjs-dist 
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        let lastY = -1;
        let pageText = '';

        for (const item of textContent.items) {
            if (!('str' in item)) continue;
            const currentY = item.transform[5];

            if (lastY !== -1 && Math.abs(currentY - lastY) > 4) {
                pageText += '\n';
            } else if (lastY !== -1) {
                pageText += ' ';
            }

            pageText += item.str;
            lastY = currentY;
        }
        fullText += pageText + '\n';
    }

    const debugText = fullText;
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // --- State for Parsing ---
    let studentName = "Student"; // Default
    let totalUnits = 0;
    const totalUnitsNeeded = 180;

    const requirements: Requirement[] = [];
    const allParsedCourses: CourseItem[] = [];
    const usedCourseCodes = new Set<string>(); // To track what is used in requirements

    // Helper to parse a course line
    const parseCourseLine = (line: string): CourseItem | null => {
        if (!TERM_REGEX.test(line)) return null;

        const match = line.match(COURSE_REGEX);
        if (match) {
            const [, title, term, unitsStr, grade] = match;
            const units = parseInt(unitsStr, 10);
            const codeMatch = title.match(/^([A-Z]+&?[A-Z]*\s+\d+[A-Z]*)/);
            const courseCode = codeMatch ? codeMatch[1].trim() : title.split('-')[0].trim();

            let status: 'Completed' | 'In Progress' | 'Planned' = 'Completed';
            if (['IP', 'T', 'L', 'RP'].includes(grade) || grade.startsWith('IP')) status = 'In Progress';

            return { code: courseCode, title: title.trim(), units, grade, term, status };
        } else {
            // Fallback
            const termMatch = line.match(TERM_REGEX);
            if (termMatch && termMatch.index) {
                const term = termMatch[0];
                const beforeTerm = line.substring(0, termMatch.index).trim();
                const afterTerm = line.substring(termMatch.index + term.length).trim();
                const afterParts = afterTerm.split(/\s+/);
                if (afterParts.length >= 2) {
                    const unitsStr = afterParts[0];
                    const grade = afterParts.slice(1).join(' ');
                    let title = beforeTerm.replace(/^[^a-zA-Z0-9]+/, '').trim();
                    if (title.endsWith('-')) title = title.substring(0, title.length - 1).trim();
                    const units = parseInt(unitsStr, 10);
                    if (!isNaN(units)) {
                        const codeMatch = title.match(/^([A-Z]+&?[A-Z]*\s+\d+[A-Z]*)/);
                        const courseCode = codeMatch ? codeMatch[1].trim() : title.split('-')[0].trim();
                        let status: 'Completed' | 'In Progress' | 'Planned' = 'Completed';
                        if (['IP', 'T', 'L', 'RP'].includes(grade) || grade.startsWith('IP')) status = 'In Progress';
                        return { code: courseCode, title, units, grade, term, status };
                    }
                }
            }
        }
        return null;
    };

    // --- Specific Parsers ---

    let currentContext = 'Global'; // Global, Ways, Writing, Major, Senior, Electives
    let currentReq: Requirement | null = null;

    for (const line of lines) {
        // 1. Context Switching logic (Header Detection)
        if (line.includes("Bachelor of Science")) {
            // Extract Name if possible
        }

        if (line.includes("Total Units")) {
            const unitsMatch = line.match(/(\d+)\s+units completed/i);
            if (unitsMatch) {
                // Logic if needed
            }
        }

        // Parsing Ways
        if (line.includes("Ways")) currentContext = 'Ways';
        if (line.includes("Writing in the Major") && currentContext !== 'Major') currentContext = 'Writing'; // WIM can be in Major too
        if (line.includes("Computer Science (BS)")) currentContext = 'Major';
        if (line.includes("University General Electives")) currentContext = 'Electives';

        // --- Logic per Context ---

        const course = parseCourseLine(line);
        if (course) {
            allParsedCourses.push(course);

            // If we are in a specific requirement, add it
            if (currentReq) {
                currentReq.courses.push(course);
                usedCourseCodes.add(course.code);
            } else if (currentContext === 'Electives') {
                // Will handle at the end
            }
        } else {
            // Logic to create new Requirements based on headers/text within Context

            if (currentContext === 'Ways' && line.includes('Way-')) {
                const name = line.replace(/^[•●■]\s*/, '').split('(')[0].trim();
                const satisfied = line.includes('✔') || line.toLowerCase().includes('complete');

                currentReq = {
                    id: name,
                    name: name,
                    satisfied: satisfied,
                    courses: [],
                    missingCourses: line.includes('needed') ? 1 : 0
                };
                requirements.push(currentReq);
            }

            if (currentContext === 'Writing') {
                if (line.includes('PWR 1')) {
                    currentReq = { id: 'PWR-1', name: 'PWR 1', satisfied: false, courses: [] };
                    requirements.push(currentReq);
                } else if (line.includes('PWR 2')) {
                    currentReq = { id: 'PWR-2', name: 'PWR 2', satisfied: false, courses: [] };
                    requirements.push(currentReq);
                } else if (line.includes('Writing in the Major') && !line.includes('Ways')) {
                    currentReq = { id: 'WIM', name: 'Writing in the Major', satisfied: false, courses: [] };
                    requirements.push(currentReq);
                }
            }

            if (currentContext === 'Major') {
                if (line.includes('Engineering Fundamentals')) {
                    currentReq = { id: 'Engr-Fundamentals', name: 'Engineering Fundamentals', satisfied: false, courses: [], requiredParam: 13, missingUnits: 13 };
                    requirements.push(currentReq);
                } else if (line.includes('Technology in Society')) {
                    currentReq = { id: 'Tech-Society', name: 'Technology in Society', satisfied: false, courses: [] };
                    requirements.push(currentReq);
                } else if (line.includes('Depth')) {
                    currentReq = { id: 'Depth', name: line.trim(), satisfied: false, courses: [], subRequirements: [] };
                    requirements.push(currentReq);
                } else if (line.includes('Senior Project')) {
                    currentReq = { id: 'Senior-Project', name: 'Senior Project', satisfied: false, courses: [] };
                    requirements.push(currentReq);
                } else if (line.includes('Core')) {
                    currentReq = { id: 'CS-Core', name: 'Computer Science Core', satisfied: false, courses: [] };
                    requirements.push(currentReq);
                }

                // Gap Detection Logic within valid lines
                if (currentReq) {
                    if (line.includes('units required')) {
                        const reqMatch = line.match(/(\d+)\s+units required/);
                        if (reqMatch) currentReq.requiredParam = parseInt(reqMatch[1]);
                    }
                    if (line.includes('more units')) {
                        const gapMatch = line.match(/need (\d+)\s+more units/);
                        if (gapMatch) currentReq.missingUnits = parseInt(gapMatch[1]);
                        currentReq.satisfied = false;
                    }
                    if (line.includes('required') && line.includes('class')) {
                        const classMatch = line.match(/(\d+)\s+classes required/);
                        if (classMatch) currentReq.requiredParam = parseInt(classMatch[1]);
                    }
                    if (line.includes('more') && line.includes('class')) {
                        const classGapMatch = line.match(/need (\d+)\s+more class/);
                        if (classGapMatch) currentReq.missingCourses = parseInt(classGapMatch[1]);
                        currentReq.satisfied = false;
                    }
                }
            }
        }
    }

    // Post-Processing

    // 1. Total Units
    totalUnits = allParsedCourses.reduce((sum, c) => sum + (isNaN(c.units) ? 0 : c.units), 0);

    // 2. Unused Electives
    const unusedElectives = allParsedCourses.filter(c => !usedCourseCodes.has(c.code));

    // 3. Update Satisfaction 
    requirements.forEach(req => {
        if (req.courses.length > 0 && req.missingUnits === undefined && req.missingCourses === undefined) {
            req.satisfied = true;
        }
        if (req.id === 'Engr-Fundamentals' && req.missingUnits !== undefined) {
            req.satisfied = false;
        }
    });

    const degreeProgress: DegreeProgress = {
        studentName,
        totalUnits,
        totalUnitsNeeded,
        requirements,
        unusedElectives
    };

    return { degreeProgress, debugText };
}
