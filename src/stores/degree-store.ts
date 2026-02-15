import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CourseItem, Requirement } from '@/utils/transcriptParser';

interface DegreeState {
    selectedMajorId: string | null;
    // All courses the user has taken/planned (similar to a transcript)
    completedCourses: CourseItem[];
    // Mapping of Requirement ID -> List of Course Items assigned to it
    // We use CourseItem[] here because a single requirement might be satisfied 
    // by multiple courses (e.g. "Electives" or "Math Sequence")
    requirementMappings: Record<string, CourseItem[]>;

    // Onboarding state
    hasCompletedOnboarding: boolean;
    coTermStatus: boolean;
    selectedMinorId: string | null;
    selectedTrack: string | null;

    actions: {
        selectMajor: (majorId: string) => void;

        addCompletedCourse: (course: CourseItem) => void;
        removeCompletedCourse: (courseCode: string) => void;

        // Drag & Drop Logic
        // Assign a course to a specific requirement bucket
        assignCourseToRequirement: (course: CourseItem, requirementId: string) => void;
        // Remove a course from a requirement bucket (moves back to "Unassigned" implicit pool)
        removeCourseFromRequirement: (courseCode: string, requirementId: string) => void;

        // Onboarding
        completeOnboarding: (majorId: string | null, coTerm: boolean, minorId: string | null, track: string | null) => void;

        // Reset/Clear
        resetProgress: () => void;
    };
}

// Helper to determine if a course is assigned to ANY requirement
export const isCourseAssigned = (state: DegreeState, courseCode: string): boolean => {
    return Object.values(state.requirementMappings).some(courses =>
        courses.some(c => c.code === courseCode)
    );
};

export const useDegreeStore = create<DegreeState>()(
    persist(
        (set, get) => ({
            selectedMajorId: null,
            completedCourses: [],
            requirementMappings: {},
            hasCompletedOnboarding: false,
            coTermStatus: false,
            selectedMinorId: null,
            selectedTrack: null,

            actions: {
                selectMajor: (majorId) => set({ selectedMajorId: majorId }),

                addCompletedCourse: (course) => set((state) => {
                    // Avoid duplicates based on code
                    if (state.completedCourses.some(c => c.code === course.code)) return state;
                    return { completedCourses: [...state.completedCourses, course] };
                }),

                removeCompletedCourse: (courseCode) => set((state) => {
                    // Also remove from any mappings
                    const newMappings = { ...state.requirementMappings };
                    for (const reqId in newMappings) {
                        newMappings[reqId] = newMappings[reqId].filter(c => c.code !== courseCode);
                    }
                    return {
                        completedCourses: state.completedCourses.filter(c => c.code !== courseCode),
                        requirementMappings: newMappings,
                    };
                }),

                assignCourseToRequirement: (course, requirementId) => set((state) => {
                    const currentCoursesInReq = state.requirementMappings[requirementId] || [];
                    // Avoid duplicates in the same requirement
                    if (currentCoursesInReq.some(c => c.code === course.code)) return state;

                    // Optional: Logic to remove from other requirements if mutual exclusivity is desired?
                    // For now, let's assume a course can only satisfy ONE requirement at a time for simplicity in UI,
                    // but the data model supports multiple. Let's enforce single-assignment for this MVP.

                    const newMappings = { ...state.requirementMappings };

                    // Remove from all other buckets first
                    for (const key in newMappings) {
                        newMappings[key] = newMappings[key].filter(c => c.code !== course.code);
                    }

                    // Add to target bucket
                    newMappings[requirementId] = [...(newMappings[requirementId] || []), course];

                    return { requirementMappings: newMappings };
                }),

                removeCourseFromRequirement: (courseCode, requirementId) => set((state) => {
                    const currentCourses = state.requirementMappings[requirementId] || [];
                    return {
                        requirementMappings: {
                            ...state.requirementMappings,
                            [requirementId]: currentCourses.filter(c => c.code !== courseCode),
                        }
                    };
                }),

                completeOnboarding: (majorId, coTerm, minorId, track) => set({
                    selectedMajorId: majorId,
                    coTermStatus: coTerm,
                    selectedMinorId: minorId,
                    selectedTrack: track,
                    hasCompletedOnboarding: true,
                }),

                resetProgress: () => set({
                    selectedMajorId: null,
                    completedCourses: [],
                    requirementMappings: {},
                    hasCompletedOnboarding: false,
                    coTermStatus: false,
                    selectedMinorId: null,
                    selectedTrack: null,
                }),
            },
        }),
        {
            name: 'degree-progress-storage',
            partialize: (state) => ({
                selectedMajorId: state.selectedMajorId,
                completedCourses: state.completedCourses,
                requirementMappings: state.requirementMappings,
                hasCompletedOnboarding: state.hasCompletedOnboarding,
                coTermStatus: state.coTermStatus,
                selectedMinorId: state.selectedMinorId,
                selectedTrack: state.selectedTrack,
            }),
        }
    )
);
