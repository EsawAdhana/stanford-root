export interface ParsedCourse {
  code: string // "CS 106B"
  title: string
  term?: string // "AU/23"
  units?: number
  grade?: string // "A", "IP", etc.
  requirementCategory?: string
}

export interface ParsedAudit {
  metadata: {
    studentName?: string
    studentId?: string
    auditDate?: string
    degree?: string
    major?: string
    subplan?: string
  }
  summary: {
    unitsRequired?: number
    unitsCompleted?: number
    unitsInProgress?: number
    unitsNeeded?: number
    cumulativeGpa?: number
  }
  sections: {
    name: string
    courses: ParsedCourse[]
  }[]
}

export interface RemainingCourse {
  code: string
  title: string
  requirementCategory: string
  quartersOffered: string[] // e.g., ["Autumn 2025", "Spring 2026"]
}
