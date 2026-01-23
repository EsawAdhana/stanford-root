import { useState, useEffect, useMemo } from 'react'
import { Course } from '@/types/course'

interface EvaluationData {
  course: string
  term: string
  report: {
    quantitative: Array<{
      question: string
      tables: any[][]
    }>
    qualitative: Array<{
      question: string
      comments: string[]
    }>
  }
}

interface ParsedEvaluation {
  qualityOfInstruction?: {
    average: string
    responses: string
    distribution: Array<{ label: string; count: string; percentage: string }>
  }
  hoursPerWeek?: {
    average: string
    responses: string
    distribution: Array<{ hours: string; count: string; percentage: string }>
  }
  qualitativeComments: string[]
  allQuantitative: Array<{
    question: string
    average?: string
    responses?: string
    distribution?: any[]
  }>
  allQualitative: Array<{
    question: string
    comments: string[]
  }>
  term: string
}

// Normalize course identifier for matching
function normalizeCourseId(subject: string, code: string): string {
  return `${subject} ${code}`.trim().toUpperCase()
}

// Find evaluation data for a course
function findEvaluationsForCourse(
  evaluations: EvaluationData[],
  course: Course,
  term?: string
): ParsedEvaluation[] {
  const normalizedCourseId = normalizeCourseId(course.subject, course.code)
  
  // Filter evaluations that match the course
  const matchingEvaluations = evaluations.filter(evalData => {
    const evalCourseId = evalData.course.trim().toUpperCase()
    return evalCourseId === normalizedCourseId
  })

  // If term is specified, filter by term
  const filteredEvaluations = term
    ? matchingEvaluations.filter(evalData => evalData.term === term)
    : matchingEvaluations

  return filteredEvaluations.map(evalData => parseEvaluation(evalData))
}

// Parse a single evaluation report
function parseEvaluation(evalData: EvaluationData): ParsedEvaluation {
  const result: ParsedEvaluation = {
    qualitativeComments: [],
    allQuantitative: [],
    allQualitative: [],
    term: evalData.term
  }

  // Parse quantitative questions
  for (const q of evalData.report.quantitative) {
    const question = q.question.toLowerCase()
    
    // Quality of instruction
    if (question.includes('quality of instruction') || question.includes('quality of the instruction')) {
      const tables = q.tables
      if (tables && tables.length >= 2) {
        const summaryRow = tables[1][0]
        if (summaryRow && summaryRow.length >= 2) {
          result.qualityOfInstruction = {
            average: summaryRow[1] || 'N/A',
            responses: summaryRow[0] || 'N/A',
            distribution: tables[0].map((row: any[]) => ({
              label: row[0] || '',
              count: row[2] || '0',
              percentage: row[3] || '0%'
            }))
          }
        }
      }
    }
    
    // Hours per week
    if (question.includes('hours per week') || question.includes('hours per week on average')) {
      const tables = q.tables
      if (tables && tables.length >= 2) {
        const summaryRow = tables[1][0]
        if (summaryRow && summaryRow.length >= 2) {
          result.hoursPerWeek = {
            average: summaryRow[1] || 'N/A',
            responses: summaryRow[0] || 'N/A',
            distribution: tables[0].map((row: any[]) => ({
              hours: row[0] || '',
              count: row[2] || '0',
              percentage: row[3] || '0%'
            }))
          }
        }
      }
    }

    // Store all quantitative questions
    const summaryRow = q.tables?.[1]?.[0]
    result.allQuantitative.push({
      question: q.question,
      average: summaryRow?.[1],
      responses: summaryRow?.[0],
      distribution: q.tables?.[0]
    })
  }

  // Parse qualitative questions
  for (const q of evalData.report.qualitative) {
    const question = q.question.toLowerCase()
    
    // "What would you like to say" comments
    if (question.includes('what would you like to say') || question.includes('considering taking it')) {
      result.qualitativeComments = q.comments || []
    }

    // Store all qualitative questions
    result.allQualitative.push({
      question: q.question,
      comments: q.comments || []
    })
  }

  return result
}

export function useCourseEvaluations(course: Course | null, term?: string) {
  const [evaluations, setEvaluations] = useState<EvaluationData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadEvaluations() {
      try {
        setIsLoading(true)
        setError(null)
        
        const response = await fetch('/data/stanford_evals_ALL.json')
        if (!response.ok) {
          throw new Error('Failed to load evaluation data')
        }
        
        const data: EvaluationData[] = await response.json()
        
        if (mounted) {
          setEvaluations(data)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Unknown error'))
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    loadEvaluations()

    return () => {
      mounted = false
    }
  }, [])

  const parsedEvaluations = useMemo(() => {
    if (!course || evaluations.length === 0) return []
    return findEvaluationsForCourse(evaluations, course, term)
  }, [course, evaluations, term])

  // Get the most recent evaluation or the one matching the term
  const primaryEvaluation = parsedEvaluations.length > 0 ? parsedEvaluations[0] : null

  return {
    evaluation: primaryEvaluation,
    allEvaluations: parsedEvaluations,
    isLoading,
    error
  }
}
