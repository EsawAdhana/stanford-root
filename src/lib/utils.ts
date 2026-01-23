import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn (...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Very lightweight heuristic mapping for Stanford subjects.
// This is only used for filtering facets, so it's intentionally best-effort.
export function getSchoolFromSubject (subject: string) {
  if (!subject) return ''

  const s = subject.trim().toUpperCase()

  const engineering = new Set([
    'AA', 'AFRICAAM', // keep unknowns out of eng
    'BIOE', 'CS', 'CME', 'EE', 'MS&E', 'MSE', 'ENGR', 'ME', 'MATSCI', 'ENERGY', 'STS'
  ])

  const business = new Set(['GSBGEN', 'MGTECON', 'STRAMGT', 'FINANCE', 'OIT', 'HRMGT'])
  const education = new Set(['EDUC', 'EDUCATION'])
  const law = new Set(['LAW'])
  const medicine = new Set(['MED', 'SURG', 'PEDS', 'OBGYN', 'PSYC', 'PSY', 'PATH', 'ANAT'])
  const sustainability = new Set(['SUST', 'EARTHSYS', 'CEE', 'ENV', 'ENVRES'])

  if (engineering.has(s)) return 'Engineering'
  if (business.has(s)) return 'Business'
  if (education.has(s)) return 'Education'
  if (law.has(s)) return 'Law'
  if (medicine.has(s)) return 'Medicine'
  if (sustainability.has(s)) return 'Sustainability'

  // Default bucket
  return 'Humanities & Sciences'
}

export function getDepartmentUrl (code: string) {
  const c = (code || '').toUpperCase()

  const map: Record<string, string> = {
    AA: 'https://aa.stanford.edu/',
    BIOE: 'https://bioengineering.stanford.edu/',
    CEE: 'https://cee.stanford.edu/',
    CHEM: 'https://chemistry.stanford.edu/',
    CHEMENG: 'https://cheme.stanford.edu/',
    CLASSICS: 'https://classics.stanford.edu/',
    COMM: 'https://comm.stanford.edu/',
    CS: 'https://cs.stanford.edu/',
    ECON: 'https://economics.stanford.edu/',
    EDUC: 'https://ed.stanford.edu/',
    EE: 'https://ee.stanford.edu/',
    ENGLISH: 'https://english.stanford.edu/',
    GSBGEN: 'https://www.gsb.stanford.edu/',
    HISTORY: 'https://history.stanford.edu/',
    LAW: 'https://law.stanford.edu/',
    LINGUIST: 'https://linguistics.stanford.edu/',
    MATH: 'https://mathematics.stanford.edu/',
    MATSCI: 'https://mse.stanford.edu/',
    ME: 'https://me.stanford.edu/',
    MED: 'https://med.stanford.edu/',
    MUSIC: 'https://music.stanford.edu/',
    'MS&E': 'https://msande.stanford.edu/',
    PHIL: 'https://philosophy.stanford.edu/',
    PHYSICS: 'https://physics.stanford.edu/',
    POLISCI: 'https://politicalscience.stanford.edu/',
    PSYCH: 'https://psychology.stanford.edu/',
    SOC: 'https://sociology.stanford.edu/',
    STATS: 'https://statistics.stanford.edu/',
    TAPS: 'https://taps.stanford.edu/'
  }

  if (map[c]) return map[c]

  return `https://www.stanford.edu/search/?q=${encodeURIComponent(`${code} department`)}`
}

function convertTermToCode (term: string): string {
  // Convert "Winter 2026" -> "W26", "Autumn 2025" -> "F25", etc.
  if (!term) return ''
  
  const parts = term.split(' ')
  if (parts.length < 2) return ''
  
  const season = parts[0].toUpperCase()
  const year = parts[1]
  
  // Map season to code: Autumn/Fall -> F, Winter -> W, Spring -> S, Summer -> U
  let seasonCode = ''
  if (season === 'AUTUMN' || season === 'FALL') {
    seasonCode = 'F'
  } else if (season === 'WINTER') {
    seasonCode = 'W'
  } else if (season === 'SPRING') {
    seasonCode = 'S'
  } else if (season === 'SUMMER') {
    seasonCode = 'U'
  } else {
    // Fallback to first letter if unknown
    seasonCode = season.charAt(0)
  }
  
  // Get last 2 digits of year
  const yearCode = year.slice(-2)
  
  return `${seasonCode}${yearCode}`
}

export function getSyllabusUrl (subject: string, code: string, classId?: number, term?: string, sectionNumber?: string) {
  // Stanford syllabus URLs use format: {termCode}-{subject}-{code}-{section}
  // e.g., W26-ATHLETIC-60-01
  if (term) {
    const termCode = convertTermToCode(term)
    const subjectClean = (subject || '').replace(/\s+/g, '').toUpperCase()
    const codeClean = (code || '').replace(/\s+/g, '').toUpperCase()
    
    // Use provided section number, or default to "01" if missing
    const sectionToUse = (sectionNumber && sectionNumber.trim() !== '') 
      ? sectionNumber.replace(/\s+/g, '').padStart(2, '0')
      : '01'
    
    // Validate all required parts are present
    if (termCode && subjectClean && codeClean && sectionToUse) {
      const courseIdentifier = `${termCode}-${subjectClean}-${codeClean}-${sectionToUse}`
      // The identifier appears twice in the URL path
      return `https://syllabus.stanford.edu/syllabus/doWebAuth/${courseIdentifier}/${courseIdentifier}`
    }
  }
  
  // Fallback: Try classId-based URL if available
  if (classId) {
    return `https://syllabus.stanford.edu/syllabus/#/viewSyllabus/${classId}`
  }
  
  // Final fallback: Course code-based search
  const subjectClean = (subject || '').replace(/\s+/g, '')
  const codeClean = (code || '').replace(/\s+/g, '')
  const courseCode = `${subjectClean}${codeClean}`
  
  return `https://syllabus.stanford.edu/syllabus/#/search?q=${encodeURIComponent(courseCode)}`
}
