import type { Metadata, ResolvingMetadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { CopyField } from '@/components/copy-field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MCP_URL } from '@/lib/site'
import { STARTERS } from '@/lib/mcp/prompts'
import { pageMetadata } from '@/lib/page-metadata'

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, {
    title: 'MCP — Stanford Root',
    description: 'Use Stanford Root from Claude, Codex, or any MCP client: search courses, read evaluations, and plan your saved schedule.',
    path: '/connect',
  })
}

const CLIENTS = [
  {
    id: 'claude',
    name: 'Claude',
    steps: ['Open Customize, then Connectors.', 'Choose Add, then Add custom connector.', 'Name it Stanford Root, paste the address above, and add it.'],
  },
  { id: 'claude-code', name: 'Claude Code', command: `claude mcp add --transport http stanford-root ${MCP_URL}`, steps: ['Run /mcp inside Claude Code and choose stanford-root to sign in.'] },
  { id: 'codex', name: 'Codex', command: `codex mcp add stanford-root --url ${MCP_URL}`, then: 'codex mcp login stanford-root', steps: [] },
  {
    id: 'other',
    name: 'Other',
    steps: ['Add a remote (Streamable HTTP) MCP server in your client and give it the address above.', 'It signs in with OAuth, so there is no API key to copy.'],
  },
]

export default function ConnectPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 border-b border-border/50" />}>
        <SiteHeader />
      </Suspense>
      <div className="mx-auto w-full max-w-3xl px-6 py-12 flex-1">
        <h1 className="text-3xl font-bold text-foreground mb-3">Stanford Root MCP</h1>
        <p className="text-sm text-foreground/80 leading-relaxed mb-6">
          Search courses, read evaluations, and plan your saved schedule from Claude, Codex, or any MCP client. It plans. It
          never enrolls you in anything.
        </p>

        <CopyField value={MCP_URL} label="the MCP address" />
        <p className="mt-2 text-xs text-muted-foreground">Paste it exactly as shown, with the www.</p>

        <div className="space-y-10 mt-10 text-sm text-foreground/80 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Add it</h2>
            <Tabs defaultValue="claude" className="w-full">
              <TabsList>
                {CLIENTS.map(c => (
                  <TabsTrigger key={c.id} value={c.id} className="max-xs:px-2 max-xs:text-xs">
                    {c.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {CLIENTS.map(c => (
                <TabsContent key={c.id} value={c.id} className="space-y-3">
                  {c.command && <CopyField value={c.command} label={`the ${c.name} command`} />}
                  {c.then && <CopyField value={c.then} label={`the ${c.name} sign-in command`} />}
                  {c.steps.length > 0 && (
                    <ol className="list-decimal pl-5 space-y-1">
                      {c.steps.map(step => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  )}
                </TabsContent>
              ))}
            </Tabs>
            <p className="mt-4">
              The first time, a Stanford Root page opens in your browser. Sign in with your Stanford account and choose Allow.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Things to ask</h2>
            <ul className="divide-y divide-border border border-border rounded-md">
              {STARTERS.map(s => (
                <li key={s.name} className="px-4 py-2.5 text-foreground">
                  {s.example}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">What it can do</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Search the catalog with the site&apos;s filters, and check sections and live seats.</li>
              <li>Read course and instructor evaluations, which need a Stanford sign-in here just as on the site.</li>
              <li>Add classes to your saved schedule and change sections. Removing a class always asks you first.</li>
              <li>Import and export your schedule as a calendar file.</li>
            </ul>
            <p className="mt-4">
              Disconnect an app any time from{' '}
              <Link href="/connected-apps" className="text-primary hover:underline">
                Connected apps
              </Link>
              . The{' '}
              <Link href="/privacy" className="text-primary hover:underline">
                privacy policy
              </Link>{' '}
              says what a connected app can access.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
