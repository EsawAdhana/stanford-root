'use client'

import { DegreeAuditPanel } from '@/components/degree-audit-panel'
import { Logo } from '@/components/logo'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function DegreeAuditPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-30">
        <div className="container mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Logo className="h-9 w-9 shadow-primary/20" />
            <h1 className="text-2xl tracking-tight text-foreground font-[family-name:var(--font-outfit)] font-medium">
              <span className="font-bold text-primary">Stanford Root</span>
            </h1>
          </Link>
          <Link href="/">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Courses
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-8 py-12">
        <DegreeAuditPanel />
      </main>
    </div>
  )
}
