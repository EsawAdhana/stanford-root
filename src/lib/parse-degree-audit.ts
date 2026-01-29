import type { ParsedAudit, ParsedCourse } from '@/types/degree-audit'

export function parseDegreeAudit (rawText: string): ParsedAudit {
  // 1. Clean the text: Remove extra whitespace and normalize
  const cleanLines: string[] = []
  for (const line of rawText.split('\n')) {
    // Remove source tags and clean up
    const cleaned = line.replace(/[<>"]/g, '').trim()
    if (cleaned) {
      cleanLines.push(cleaned)
    }
  }

  const fullText = cleanLines.join('\n')

  // 2. Initialize Data Structure
  const data: ParsedAudit = {
    metadata: {},
    summary: {},
    sections: []
  }

  // 3. Extract Metadata
  // Student Name and ID
  const nameMatch = fullText.match(/([A-Za-z]+, [A-Za-z]+) \((\d+)\)/)
  if (nameMatch) {
    data.metadata.studentName = nameMatch[1]
    data.metadata.studentId = nameMatch[2]
  }

  // Audit Date
  const dateMatch = fullText.match(/Audit Date (\d{2} [A-Za-z]+ \d{4})/)
  if (dateMatch) {
    data.metadata.auditDate = dateMatch[1]
  }

  // Degree Program (Naive search based on known format)
  if (fullText.includes('Computer Science (BS), Human-Computer Interaction')) {
    data.metadata.degree = 'Bachelor of Science'
    data.metadata.major = 'Computer Science'
    data.metadata.subplan = 'Human-Computer Interaction'
  }

  // 4. Extract Summary Stats
  const summaryMap: Record<string, RegExp> = {
    unitsRequired: /(\d+) units required\./i,
    unitsCompleted: /(\d+) units completed\./i,
    unitsInProgress: /(\d+) units in progress\./i,
    unitsNeeded: /(\d+) units needed\./i,
    cumulativeGpa: /cumulative GPA.*?is (\d\.\d+)/i
  }

  for (const [key, pattern] of Object.entries(summaryMap)) {
    const match = fullText.match(pattern)
    if (match) {
      const value = parseFloat(match[1])
      if (!isNaN(value)) {
        data.summary[key as keyof typeof data.summary] = value
      }
    }
  }

  // 5. Requirement and Course Parsing Logic
  let currentSection = 'General Information'
  let currentRequirement = 'General'

  // Regex for a Course Line: e.g., "CS 106B-Programming Abstractions"
  const coursePattern = /^([A-Z&]{2,8})\s?(\d+[A-Z]*)\s?-(.*)/
  const termPattern = /\b(AU|WI|SP|SU)\/(\d{2})\b/ // e.g., AU/23
  const gradePattern = /^(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|CR|S|NC|IP|T)$/
  const unitsPattern = /^(?:UNITS|ANTS|LUNETS|LANTS|UMTS)?\s?(\d{1,2})$/

  const sectionsMap: Record<string, ParsedCourse[]> = {}
  let lastCourse: ParsedCourse | null = null

  // Iterating through lines to build hierarchy
  for (const line of cleanLines) {
    // A. Detect Section Headers
    if (line.startsWith('Way-') || line.includes('General Education')) {
      currentSection = 'General Education (Ways)'
      currentRequirement = line.split(':')[0] || line
    } else if (line.includes('Computer Science BS') || line.includes('Engineering Requirements')) {
      currentSection = 'Major Requirements'
    } else if (line.includes('University General Electives')) {
      currentSection = 'University Electives'
    } else if (line.includes('Writing and Rhetoric')) {
      currentSection = 'Writing Requirements'
    }

    // B. Detect Specific Sub-Requirements within Sections
    if ((line.includes('Required') || line.includes('Elective')) && line.length < 40) {
      currentRequirement = line
    }

    // Ensure section exists in map
    if (!sectionsMap[currentSection]) {
      sectionsMap[currentSection] = []
    }

    // C. Detect Courses
    const courseMatch = line.match(coursePattern)
    if (courseMatch) {
      const dept = courseMatch[1]
      const num = courseMatch[2]
      const title = courseMatch[3].trim()

      const newCourse: ParsedCourse = {
        code: `${dept} ${num}`,
        title,
        term: undefined,
        units: undefined,
        grade: undefined,
        requirementCategory: currentRequirement
      }

      sectionsMap[currentSection].push(newCourse)
      lastCourse = newCourse
      continue
    }

    // D. Detect Attributes (Term, Grade, Units) for the *last found course*
    if (lastCourse) {
      // Check Term
      const tMatch = line.match(termPattern)
      if (tMatch && !lastCourse.term) {
        lastCourse.term = `${tMatch[1]}/${tMatch[2]}`
      }

      // Check Grade (Clean up OCR noise)
      const cleanWord = line.replace(/GRACIE|GRADE|SHADE/g, '').trim()
      const gMatch = cleanWord.match(gradePattern)
      if (gMatch && !lastCourse.grade) {
        lastCourse.grade = gMatch[1]
      } else if (cleanWord.includes('IP') && !lastCourse.grade) {
        lastCourse.grade = 'In Progress'
      }

      // Check Units
      const uMatch = line.trim().match(unitsPattern)
      if (uMatch && !lastCourse.units) {
        const val = parseInt(uMatch[1], 10)
        if (val > 0 && val < 20) {
          lastCourse.units = val
        }
      }
    }
  }

  // 6. Reformat into final JSON list
  for (const [sectionName, courses] of Object.entries(sectionsMap)) {
    if (courses.length > 0) {
      data.sections.push({
        name: sectionName,
        courses
      })
    }
  }

  return data
}
