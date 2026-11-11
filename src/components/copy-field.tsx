'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

/** One line of text to paste somewhere else, with a button that copies it. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the text stays selectable.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 pl-3 pr-1.5 py-1.5">
      <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm text-foreground select-all">{value}</code>
      <Button type="button" variant="outline" size="sm" className="w-20 shrink-0" aria-label={`Copy ${label}`} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
