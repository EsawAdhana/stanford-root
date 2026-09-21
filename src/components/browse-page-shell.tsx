/**
 * Static browse layout shell used as the Suspense fallback so the first paint
 * matches the resolved page geometry (header + sidebar + list) instead of a
 * centered spinner that snaps into place.
 */
export function BrowsePageShell() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <header className="flex-none h-14 sm:h-16 md:h-16 border-b border-border/50 flex items-center gap-2 md:gap-4 bg-background/90 backdrop-blur-xl justify-between px-2 sm:px-0">
        <div className="flex items-center gap-2 md:gap-4 shrink-0 md:w-[270px] pl-2 sm:pl-4 md:pl-0 md:justify-center">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-muted/40 shrink-0 md:hidden" />
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-muted/40 shrink-0 hidden md:block" />
          <div className="hidden sm:block h-8 w-[8.5rem] rounded bg-muted/40" />
        </div>
        <div className="flex-1 flex flex-col justify-center px-1 sm:px-2 md:px-0 min-w-0">
          <div className="h-10 rounded-xl bg-muted/40" />
        </div>
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0 pr-2 sm:pr-4 md:pr-6">
          <div className="h-9 w-9 rounded-full bg-muted/40" />
          <div className="h-9 w-9 md:w-[5.5rem] rounded-lg bg-muted/40" />
          <div className="h-9 w-16 rounded-lg bg-muted/40" />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[280px] border-r border-border/40 bg-background hidden md:block overflow-y-auto shrink-0 p-4 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-muted/30" />
          ))}
        </aside>
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-secondary/20 relative">
          <div className="shrink-0 border-b border-border/30 bg-background z-10 flex items-center gap-1 flex-nowrap py-2 pl-2 pr-2">
            <div className="h-7 flex-1 rounded-md bg-muted/50" />
            <div className="h-5 w-16 rounded bg-muted/50" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden p-2 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/30" />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
