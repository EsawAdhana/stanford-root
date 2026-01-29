'use client'

import { useState } from 'react'
import { DegreeAuditUploader } from './degree-audit-uploader'
import { RemainingCoursesList } from './remaining-courses-list'
import { Button } from './ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ParsedAudit, RemainingCourse } from '@/types/degree-audit'

export function DegreeAuditPanel () {
  const [remainingCourses, setRemainingCourses] = useState<RemainingCourse[]>([])
  const [parsedAudit, setParsedAudit] = useState<ParsedAudit | null>(null)
  const [showResults, setShowResults] = useState(false)

  const handleUploadComplete = (data: {
    parsedAudit: ParsedAudit
    remainingCourses: RemainingCourse[]
  }) => {
    setParsedAudit(data.parsedAudit)
    setRemainingCourses(data.remainingCourses)
    setShowResults(true)
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold mb-2">My Academic Path</h2>
          <p className="text-muted-foreground">
            Upload your MAP PDF to see which courses you still need to take
          </p>
        </div>

        <DegreeAuditUploader onUploadComplete={handleUploadComplete} />
      </div>

      {showResults && remainingCourses.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Remaining Courses</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowResults(!showResults)}
              className="gap-2"
            >
              {showResults ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Show
                </>
              )}
            </Button>
          </div>

          {showResults && (
            <RemainingCoursesList courses={remainingCourses} />
          )}
        </div>
      )}

      {showResults && remainingCourses.length === 0 && (
        <div className="border border-border rounded-lg p-6 text-center">
          <p className="text-muted-foreground">
            No remaining courses found. You may have completed all requirements!
          </p>
        </div>
      )}
    </div>
  )
}
