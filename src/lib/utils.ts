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
