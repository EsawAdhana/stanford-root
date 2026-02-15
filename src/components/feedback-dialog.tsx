'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const MAX_LENGTH = 2000
const TYPES = [
  { value: 'feedback', label: 'Feedback' },
  { value: 'request', label: 'Request or idea' }
] as const

export function FeedbackDialog () {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [type, setType] = useState<string>('feedback')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  async function handleSubmit (e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) {
      toast.error('Please enter your feedback')
      return
    }
    if (t.length > MAX_LENGTH) {
      toast.error(`Please keep it under ${MAX_LENGTH} characters`)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, type })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to send feedback')
        return
      }
      toast.success('Thanks! Your feedback was sent.', { duration: 2000 })
      setText('')
      setType('feedback')
      setOpen(false)
    } catch {
      toast.error('Failed to send feedback')
    } finally {
      setSubmitting(false)
    }
  }

  const floatingButton = (
    <div className="fixed bottom-6 right-6 z-[9999]">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            title="Leave feedback"
            aria-label="Leave feedback"
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              'bg-white/90 text-muted-foreground border border-border/60 shadow-sm',
              'hover:bg-white hover:text-foreground hover:border-border hover:shadow',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'transition-colors dark:bg-white/10 dark:border-white/20 dark:hover:bg-white/20'
            )}
          >
            <HelpCircle className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Feedback</DialogTitle>
            <DialogDescription>
              Leave feedback (reactions, praise, bugs) or a request/idea. It goes straight to the team.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="feedback-type" className="text-sm font-medium">
                Type
              </label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="feedback-type">
                  <SelectValue placeholder="Choose type" />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label htmlFor="feedback-text" className="text-sm font-medium">
                Your message
              </label>
              <textarea
                id="feedback-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's on your mind?"
                className={cn(
                  'flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
                  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50 resize-y'
                )}
                maxLength={MAX_LENGTH}
                disabled={submitting}
                rows={4}
              />
              <p className="text-xs text-muted-foreground text-right">
                {text.length} / {MAX_LENGTH}
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send feedback'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )

  if (!mounted || typeof document === 'undefined') return null
  return createPortal(floatingButton, document.body)
}
