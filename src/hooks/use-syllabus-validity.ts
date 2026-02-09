import { useState, useEffect } from 'react'

interface SyllabusValidityResult {
  isValid: boolean | null // null = unknown/checking, true = likely valid, false = likely invalid
  isChecking: boolean
}

export function useSyllabusValidity (url: string | null): SyllabusValidityResult {
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    if (!url) {
      setIsValid(null)
      setIsChecking(false)
      return
    }

    let cancelled = false

    async function checkUrl () {
      if (!url) return
      setIsChecking(true)
      setIsValid(null)

      try {
        // Try to validate the URL by checking if it follows the expected pattern
        // and attempting a lightweight check
        const urlObj = new URL(url)
        
        // Validate URL structure
        if (!urlObj.hostname.includes('syllabus.stanford.edu')) {
          if (!cancelled) {
            setIsValid(false)
            setIsChecking(false)
          }
          return
        }

        // Try to fetch with a short timeout
        // Note: CORS may prevent us from reading the response, but we can try
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000)

        try {
          // Use a simple fetch to see if the URL is reachable
          // With CORS restrictions, we can't read the status, but if it doesn't throw
          // we can assume it's at least a valid URL structure
          await fetch(url, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: controller.signal,
            cache: 'no-store'
          })

          clearTimeout(timeoutId)

          if (!cancelled) {
            // If the request doesn't throw, assume it's potentially valid
            // (we can't know for sure due to CORS, but structure looks good)
            setIsValid(true)
            setIsChecking(false)
          }
        } catch (fetchError) {
          clearTimeout(timeoutId)
          
          if (!cancelled) {
            // If fetch fails, mark as unknown (could be CORS, network, or invalid URL)
            setIsValid(null)
            setIsChecking(false)
          }
        }
      } catch (error) {
        if (!cancelled) {
          // Invalid URL format
          setIsValid(false)
          setIsChecking(false)
        }
      }
    }

    // Small delay to avoid checking on every render
    const timeoutId = setTimeout(checkUrl, 200)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [url])

  return { isValid, isChecking }
}
