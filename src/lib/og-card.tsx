import { ImageResponse } from 'next/og'
import { getDefaultViewFromDump, type ShareCardCourse } from '@/lib/catalog-dump'

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

export const OG_ALT =
  'Stanford Root: the course catalog, with student evaluation scores and hours per week'

/**
 * The card is the browse view, drawn.
 *
 * Every length below is the real CSS pixel value from the component it copies,
 * multiplied by SCALE. 1200x630 is exactly 1.25x a 960x504 viewport, which is
 * past the `md` breakpoint, so this is the desktop layout at 1.25x zoom rather
 * than a re-proportioned impression of it. Keeping the numbers in app units is
 * the point: a value here can be diffed against site-header.tsx,
 * filter-sidebar.tsx, course-list.tsx and course-card.tsx.
 *
 * 1.5x an 800px viewport was the first attempt and overflowed: at 800 the
 * header's controls and the two sort selects need more room than the app gives
 * them, so "Log in" and "A-Z" ran off the right edge.
 */
const SCALE = 1.25
const px = (appPixels: number) => appPixels * SCALE

// Dark theme tokens, resolved. Alpha variants are pre-composited over the
// surface behind them, because satori has no rgba-over-parent blending.
const BG = '#181715' //            --background            30 6% 9%
const CARD = '#201f1d' //          --card                  30 6% 12%
const FG = '#f6f5f4' //            --foreground            40 8% 96%
const FG_80 = '#c9c8c7' //         foreground/80
const MUTED = '#aaa6a1' //         --muted-foreground      30 5% 65%
const MUTED_50 = '#615f5b' //      muted-foreground/50
const MUTED_40 = '#52504d' //      muted-foreground/40
const MUTED_BG = '#2d2b29' //      --muted / --secondary   30 5% 17%
const INPUT = '#33312e' //         --input                 30 5% 19%
const BORDER_60 = '#2e2d2a' //     border/60 over --card
const BORDER_50 = '#282724' //     border/50 over --background
const BORDER_40 = '#252321' //     border/40
const BORDER_30 = '#211f1e' //     border/30
const SECONDARY_40 = '#211f1d' //  secondary/40 over --background
const SECONDARY_20 = '#1c1b19' //  secondary/20
const CARDINAL = '#da2f2f' //      --primary               0 70% 52%
const PRIMARY_05 = '#221818' //    primary/5
const PRIMARY_30 = '#521e1e' //    primary/30

/** Same bands as getRatingColor() in course-card.tsx, dark-mode variants. */
function ratingColor(rating: string): string {
  const value = Number(rating)
  if (value >= 4.5) return '#34d399' // emerald-400
  if (value >= 4.0) return '#4ade80' // green-400
  if (value >= 3.5) return '#facc15' // yellow-400
  if (value >= 3.0) return '#fb923c' // orange-400
  return '#f87171' //                   red-400
}

/**
 * Google's CSS API hands back a woff2 to a modern browser and a plain ttf to
 * anything else; satori only reads the latter, hence the vintage user agent.
 *
 * A failure here is not worth failing a build over: the card falls back to
 * satori's built-in face, which is a worse-looking share image and nothing more.
 */
async function loadGoogleFont(family: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${family}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const url = (await res.text()).match(/src: url\((https:[^)]+)\) format\('truetype'\)/)?.[1]
    if (!url) return null
    const font = await fetch(url)
    return font.ok ? await font.arrayBuffer() : null
  } catch {
    return null
  }
}

const row = { display: 'flex', alignItems: 'center' } as const
const col = { display: 'flex', flexDirection: 'column' } as const

/** Chevron on the sort selects and the collapsed sidebar sections. */
function Chevron({ size, dir }: { size: number; dir: 'down' | 'right' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d={dir === 'down' ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'}
        stroke={MUTED}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** filter-sidebar.tsx: a bare input checkbox, accent-primary. */
function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        ...row,
        justifyContent: 'center',
        width: px(16),
        height: px(16),
        borderRadius: px(3),
        background: checked ? CARDINAL : 'transparent',
        border: `${px(1)}px solid ${checked ? CARDINAL : MUTED}`,
      }}
    >
      {checked ? (
        <svg width={px(10)} height={px(10)} viewBox="0 0 24 24" fill="none">
          <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  )
}

/** filter-sidebar.tsx section heading: text-xs semibold uppercase tracking-wider. */
function SectionLabel({ children }: { children: string }) {
  return (
    <span
      style={{
        fontSize: px(12),
        fontWeight: 600,
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: px(0.6),
        paddingLeft: px(4),
      }}
    >
      {children}
    </span>
  )
}

/** course-card.tsx */
function CourseCard({ course }: { course: ShareCardCourse }) {
  return (
    <div
      style={{
        ...col,
        borderRadius: px(12),
        background: CARD,
        border: `${px(1)}px solid ${BORDER_60}`,
        padding: `${px(16)}px ${px(16)}px`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: px(6) }}>
        <span style={{ fontSize: px(15), fontWeight: 700, color: CARDINAL }}>{course.code}</span>
        <div style={{ ...col, alignItems: 'flex-end' }}>
          <span style={{ fontSize: px(13), fontWeight: 800 }}>{course.units}</span>
          {course.hours ? (
            <span style={{ fontSize: px(13), fontWeight: 500, marginTop: px(2) }}>{course.hours}</span>
          ) : null}
          {course.rating ? (
            <span
              style={{
                fontSize: px(13),
                fontWeight: 600,
                color: ratingColor(course.rating),
                marginTop: px(2),
              }}
            >
              {course.rating}/5.0
            </span>
          ) : null}
        </div>
      </div>
      <span style={{ fontSize: px(16), fontWeight: 600, marginBottom: px(12), lineHeight: 1.25 }}>
        {course.title}
      </span>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: px(10),
          borderTop: `${px(1)}px solid ${BORDER_30}`,
        }}
      >
        <span style={{ fontSize: px(13), fontWeight: 500, color: MUTED }}>{course.instructor}</span>
        <span style={{ fontSize: px(13), fontWeight: 500, color: MUTED }}>{course.terms}</span>
      </div>
    </div>
  )
}

export async function renderOgCard() {
  const [serif, sans, sansSemi, sansBold, view] = await Promise.all([
    loadGoogleFont('Instrument+Serif'),
    loadGoogleFont('Inter:wght@400'),
    loadGoogleFont('Inter:wght@600'),
    loadGoogleFont('Inter:wght@800'),
    getDefaultViewFromDump(4),
  ])

  const displayFont = serif ? '"Instrument Serif", serif' : 'serif'
  const bodyFont = sans ? '"Inter", sans-serif' : 'sans-serif'

  const fonts = [
    ...(serif ? [{ name: 'Instrument Serif', data: serif, weight: 400 as const, style: 'normal' as const }] : []),
    ...(sans ? [{ name: 'Inter', data: sans, weight: 400 as const, style: 'normal' as const }] : []),
    ...(sansSemi ? [{ name: 'Inter', data: sansSemi, weight: 600 as const, style: 'normal' as const }] : []),
    ...(sansBold ? [{ name: 'Inter', data: sansBold, weight: 800 as const, style: 'normal' as const }] : []),
  ]

  // site-header.tsx
  const header = (
    <div
      style={{
        ...row,
        height: px(64),
        borderBottom: `${px(1)}px solid ${BORDER_50}`,
        flexShrink: 0,
      }}
    >
      <div style={{ ...row, width: px(270), flexShrink: 0, justifyContent: 'center', gap: px(10) }}>
        <svg width={px(40)} height={px(40)} viewBox="0 0 48 48" fill="none">
          <path d="M24 41 V20" stroke={CARDINAL} strokeWidth={3.5} strokeLinecap="round" />
          <path d="M24 30 C15 30 9 24 9 15 C18 15 24 21 24 30 Z" fill={CARDINAL} />
          <path d="M24 24 C33 24 39 18 39 9 C30 9 24 15 24 24 Z" fill={CARDINAL} />
        </svg>
        <span style={{ fontFamily: displayFont, fontSize: px(30), letterSpacing: px(-0.5) }}>
          Stanford Root
        </span>
      </div>

      <div
        style={{
          ...row,
          flexGrow: 1,
          minWidth: 0,
          height: px(40),
          borderRadius: px(12),
          background: SECONDARY_40,
          border: `${px(1)}px solid ${BORDER_50}`,
          paddingLeft: px(14),
          paddingRight: px(12),
          gap: px(10),
        }}
      >
        <svg width={px(16)} height={px(16)} viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke={MUTED_50} strokeWidth="2" />
          <path d="M16.5 16.5 L21 21" stroke={MUTED_50} strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: px(14), color: MUTED_40 }}>Search courses or professors...</span>
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <div
          style={{
            ...row,
            justifyContent: 'center',
            height: px(19),
            paddingLeft: px(6),
            paddingRight: px(6),
            borderRadius: px(6),
            border: `${px(1)}px solid ${BORDER_40}`,
            fontSize: px(11),
            color: MUTED_40,
          }}
        >
          /
        </div>
      </div>

      <div style={{ ...row, flexShrink: 0, gap: px(8), paddingLeft: px(8), paddingRight: px(24) }}>
        <div style={{ ...row, justifyContent: 'center', width: px(36), height: px(36) }}>
          <svg width={px(20)} height={px(20)} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" stroke={MUTED} strokeWidth="2" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
              const r = (deg * Math.PI) / 180
              return (
                <path
                  key={deg}
                  d={`M${12 + Math.cos(r) * 7} ${12 + Math.sin(r) * 7} L${12 + Math.cos(r) * 9.5} ${12 + Math.sin(r) * 9.5}`}
                  stroke={MUTED}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )
            })}
          </svg>
        </div>
        <div style={{ ...row, height: px(36), paddingLeft: px(16), paddingRight: px(16), gap: px(8) }}>
          <svg width={px(16)} height={px(16)} viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="16" rx="2" stroke={MUTED} strokeWidth="2" />
            <path d="M8 3v4M16 3v4M3 11h18" stroke={MUTED} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: px(14), fontWeight: 500, color: MUTED }}>Schedule</span>
        </div>
        <div
          style={{
            ...row,
            height: px(36),
            paddingLeft: px(16),
            paddingRight: px(16),
            borderRadius: px(8),
            background: CARDINAL,
            fontSize: px(14),
            fontWeight: 500,
          }}
        >
          Log in
        </div>
      </div>
    </div>
  )

  // filter-sidebar.tsx
  const sidebar = (
    <div
      style={{
        ...col,
        width: px(280),
        flexShrink: 0,
        borderRight: `${px(1)}px solid ${BORDER_40}`,
        background: BG,
      }}
    >
      <div
        style={{
          ...row,
          paddingLeft: px(16),
          paddingRight: px(16),
          height: px(45),
          borderBottom: `${px(1)}px solid ${BORDER_40}`,
        }}
      >
        <span
          style={{
            fontSize: px(16),
            fontWeight: 600,
            color: FG_80,
            textTransform: 'uppercase',
            letterSpacing: px(0.5),
          }}
        >
          Filters
        </span>
      </div>

      <div style={{ ...col, padding: `${px(12)}px ${px(16)}px`, gap: px(12) }}>
        <div style={{ ...col, gap: px(4) }}>
          {[
            ['Hide conflicting classes', true],
            ['Hide closed & waitlisted', true],
            ['Hide study abroad', true],
            ['New courses only', false],
          ].map(([label, checked]) => (
            <div key={label as string} style={{ ...row, gap: px(8), height: px(32) }}>
              <Checkbox checked={checked as boolean} />
              <span style={{ fontSize: px(14), fontWeight: 500, color: FG_80 }}>{label as string}</span>
            </div>
          ))}
        </div>

        <div style={{ ...col, gap: px(8) }}>
          <SectionLabel>Exclude Keywords</SectionLabel>
          <div
            style={{
              ...row,
              height: px(32),
              borderRadius: px(6),
              border: `${px(1)}px solid ${INPUT}`,
              paddingLeft: px(12),
              fontSize: px(14),
              color: MUTED,
            }}
          >
            Type &amp; press Enter to exclude...
          </div>
        </div>

        <div style={{ ...col, gap: px(12) }}>
          <SectionLabel>Term</SectionLabel>
          <div style={{ ...col, gap: px(4) }}>
            {(view?.termCounts ?? []).map(({ term, count }) => (
              <div key={term} style={{ ...row, paddingTop: px(4), paddingBottom: px(4) }}>
                <Checkbox checked={term === view?.term} />
                <span
                  style={{
                    fontSize: px(14),
                    marginLeft: px(8),
                    flexGrow: 1,
                    fontWeight: term === view?.term ? 500 : 400,
                    color: term === view?.term ? FG : MUTED,
                  }}
                >
                  {term}
                </span>
                <span
                  style={{
                    fontSize: px(12),
                    color: MUTED,
                    background: MUTED_BG,
                    paddingLeft: px(6),
                    paddingRight: px(6),
                    paddingTop: px(2),
                    paddingBottom: px(2),
                    borderRadius: px(999),
                  }}
                >
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...col, gap: px(12) }}>
          <SectionLabel>Departments</SectionLabel>
          <div
            style={{
              ...row,
              height: px(32),
              borderRadius: px(6),
              border: `${px(1)}px solid ${INPUT}`,
              paddingLeft: px(12),
              gap: px(8),
              color: MUTED,
              fontSize: px(14),
              fontWeight: 500,
            }}
          >
            <svg width={px(14)} height={px(14)} viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke={MUTED} strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add Department
          </div>
        </div>

        <div style={{ ...row, justifyContent: 'space-between', height: px(40), paddingRight: px(4) }}>
          <SectionLabel>Format</SectionLabel>
          <Chevron size={px(14)} dir="right" />
        </div>
      </div>
    </div>
  )

  // course-list.tsx results bar
  const resultsBar = (
    <div
      style={{
        ...row,
        flexShrink: 0,
        borderBottom: `${px(1)}px solid ${BORDER_30}`,
        background: BG,
        paddingLeft: px(16),
        paddingRight: px(16),
        paddingTop: px(4),
        paddingBottom: px(2),
        height: px(42),
        fontSize: px(12),
        fontWeight: 500,
        color: MUTED,
      }}
    >
      {[
        ['Sort by:', 'Alphabetical', px(160)],
        ['Order:', 'A–Z', px(120)],
      ].map(([label, value, width]) => (
        <div key={label as string} style={{ ...row, gap: px(8), paddingRight: px(24) }}>
          <span style={{ width: px(56), textAlign: 'right' }}>{label as string}</span>
          <div
            style={{
              ...row,
              justifyContent: 'space-between',
              height: px(32),
              minWidth: width as number,
              borderRadius: px(6),
              border: `${px(1)}px solid ${INPUT}`,
              paddingLeft: px(12),
              paddingRight: px(8),
              color: FG,
            }}
          >
            {value as string}
            <Chevron size={px(14)} dir="down" />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <span>{view ? `${view.total.toLocaleString('en-US')} classes` : ''}</span>
    </div>
  )

  // active-filter-chips.tsx. Dropped entirely with no data, rather than drawn empty.
  const chips = !view ? null : (
    <div style={{ ...row, flexShrink: 0, paddingLeft: px(16), paddingTop: px(8), paddingBottom: px(8) }}>
      <div
        style={{
          ...row,
          gap: px(8),
          height: px(28),
          paddingLeft: px(10),
          paddingRight: px(8),
          borderRadius: px(6),
          background: PRIMARY_05,
          border: `${px(1)}px solid ${PRIMARY_30}`,
          fontSize: px(12),
          fontWeight: 500,
          color: CARDINAL,
        }}
      >
        {view?.term ?? ''}
        <svg width={px(12)} height={px(12)} viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          ...col,
          background: BG,
          color: FG,
          fontFamily: bodyFont,
        }}
      >
        {header}
        <div style={{ display: 'flex', flexGrow: 1 }}>
          {sidebar}
          <div style={{ ...col, flexGrow: 1, minWidth: 0, background: SECONDARY_20 }}>
            {resultsBar}
            {chips}
            <div style={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
              <div style={{ ...col, flexGrow: 1, gap: px(12), paddingLeft: px(16), paddingRight: px(16) }}>
                {(view?.courses ?? []).map(course => (
                  <CourseCard key={course.code} course={course} />
                ))}
              </div>
              {/*
                course-list.tsx overlays this scrubber (absolute right-0, w-5,
                bg-background/80) on top of full-width cards. satori drops
                position:absolute, so it is a sibling column here instead: the
                cards end up w-5 narrower rather than running under it, which
                is invisible at this size because the real overlay is opaque.
              */}
              <div
                style={{
                  ...col,
                  width: px(20),
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(2),
                  background: BG,
                }}
              >
                {(view?.letters ?? []).map(letter => (
                  <span key={letter} style={{ fontSize: px(10), fontWeight: 600, color: MUTED }}>
                    {letter}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  )
}
