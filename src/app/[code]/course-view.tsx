import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { Course, Section } from '@/types/course';
import {
    abbreviateGer,
    compareCourseCodes,
    decodeHtmlEntities,
    formatComponent,
    formatLevel,
    isAllowedGer,
    parseUnitsOptions,
} from '@/lib/utils';
import { stripSeconds } from '@/lib/schedule-utils';
import { isWimCourse } from '@/lib/wim-courses';
import { compareTerms } from '@/lib/terms';
import { SITE_URL } from '@/lib/site';
import { getDepartmentFromDump } from '@/lib/catalog-dump';
import { CoursePageClient } from './course-page-client';

function plainText(html: string): string {
    return decodeHtmlEntities((html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** GER abbreviations for the course (from sections + WIM injection). */
function gersForCourse(course: Course): string[] {
    const set = new Set<string>();
    course.sections?.forEach((s) => s.gers?.forEach((g) => { if (isAllowedGer(g)) set.add(abbreviateGer(g)); }));
    if (isWimCourse(course.subject, course.code)) set.add('WIM');
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** schema.org/Course structured data for rich results. */
function courseJsonLd(course: Course) {
    const code = `${course.subject} ${course.code}`;
    const terms = Array.from(new Set((course.sections || []).map((s) => s.term).filter(Boolean)))
        .sort(compareTerms);

    const instanceByTerm = terms.map((term) => {
        const instructors = Array.from(
            new Set(
                (course.sections || [])
                    .filter((s) => s.term === term)
                    .flatMap((s) => s.meetings?.flatMap((m) => m.instructors || []) || [])
            )
        );
        return {
            '@type': 'CourseInstance',
            name: `${code} — ${term}`,
            courseMode: 'onsite',
            ...(instructors.length > 0 && {
                instructor: instructors.map((name) => ({
                    '@type': 'Person',
                    name: decodeHtmlEntities(name),
                })),
            }),
        };
    });

    return {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: `${code}: ${decodeHtmlEntities(course.title)}`,
        courseCode: code,
        description: plainText(course.description).slice(0, 500) ||
            `Details, sections, and student evaluations for ${code} at Stanford.`,
        url: `${SITE_URL}/${encodeURIComponent(course.id)}`,
        provider: {
            '@type': 'CollegeOrUniversity',
            name: 'Stanford University',
            sameAs: 'https://www.stanford.edu',
        },
        ...(instanceByTerm.length > 0 && { hasCourseInstance: instanceByTerm }),
    };
}

/** Server-rendered, crawlable course summary. Visually hidden (`sr-only`) so
 *  users never see it stacked above the header during hydration; crawlers still
 *  read the DOM. Shown as a fallback only if the client fails to load. */
function CourseSummary({ course }: { course: Course }) {
    const code = `${course.subject} ${course.code}`;
    const description = plainText(course.description);
    const unitOpts = parseUnitsOptions(course.units ?? '');
    const unitsLabel = unitOpts.length > 1 ? `${unitOpts[0]}-${unitOpts[unitOpts.length - 1]}` : (unitOpts[0]?.toString() ?? '');
    const gers = gersForCourse(course);
    const terms = Array.from(new Set((course.sections || []).map((s) => s.term).filter(Boolean)))
        .sort(compareTerms);

    const sectionsByTerm = terms.map((term) => {
        const seen = new Set<number>();
        const secs = (course.sections || []).filter((s) => {
            if (s.term !== term || seen.has(s.classId)) return false;
            seen.add(s.classId);
            return true;
        });
        return { term, secs };
    });

    return (
        <section id="ssr-course-summary" aria-label={`${code} overview`} className="sr-only mx-auto max-w-3xl px-5 py-8">
            <h1 className="text-2xl font-bold">{code}: {decodeHtmlEntities(course.title)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
                {[unitsLabel && `${unitsLabel} units`, course.grading, gers.length > 0 && `GER: ${gers.join(', ')}`]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
            {description && <p className="mt-4 leading-relaxed">{description}</p>}
            {terms.length > 0 && (
                <p className="mt-4 text-sm">Offered in {terms.join(', ')} at Stanford University.</p>
            )}
            {sectionsByTerm.map(({ term, secs }) => (
                secs.length > 0 && (
                    <div key={term} className="mt-6">
                        <h2 className="text-lg font-semibold">{term} sections</h2>
                        <ul className="mt-2 space-y-1 text-sm">
                            {secs.map((s: Section) => {
                                const m = s.meetings?.[0];
                                const days = m?.days?.trim() || 'TBA';
                                const time = m?.time ? stripSeconds(m.time) : 'TBA';
                                const instructors = (m?.instructors || []).map(decodeHtmlEntities).join(', ');
                                const level = formatLevel(s.classLevel || course.code);
                                return (
                                    <li key={s.classId}>
                                        {formatComponent(s.component)} — {days} {time}
                                        {m?.location ? ` — ${m.location}` : ''}
                                        {instructors ? ` — ${instructors}` : ''}
                                        {level ? ` (${level})` : ''}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )
            ))}
        </section>
    );
}

/** Server-rendered links to nearby courses in the same department. Visually hidden
 *  (`sr-only`) so crawlers get internal links between course pages without cluttering
 *  the UI — department browse pages cover human navigation. */
async function RelatedCourses({ course }: { course: Course }) {
    const deptCourses = (await getDepartmentFromDump(course.subject))
        .sort((a, b) => compareCourseCodes(a.code, b.code));
    const others = deptCourses.filter((c) => c.id !== course.id);
    if (others.length === 0) return null;

    // Window of 12 courses around this one in code order (neighbors are the
    // most relevant: same level, often the same series).
    const idx = deptCourses.findIndex((c) => c.id === course.id);
    const center = idx === -1 ? 0 : idx;
    const start = Math.max(0, Math.min(center - 6, others.length - 12));
    const related = others.slice(start, start + 12);

    return (
        <section aria-label={`More ${course.subject} courses`} className="sr-only">
            <div className="mx-auto max-w-3xl px-5 py-8">
                <h2 className="text-lg font-semibold">More {course.subject} courses</h2>
                <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
                    {related.map((c) => (
                        <li key={c.id}>
                            <Link
                                href={`/${encodeURIComponent(c.id)}`}
                                prefetch={false}
                                className="text-muted-foreground hover:text-primary transition-colors"
                            >
                                {c.subject} {c.code}: {decodeHtmlEntities(c.title)}
                            </Link>
                        </li>
                    ))}
                </ul>
                <p className="mt-4 text-sm text-muted-foreground">
                    <Link
                        href={`/${encodeURIComponent(course.subject)}`}
                        prefetch={false}
                        className="underline hover:text-primary transition-colors"
                    >
                        All {course.subject} courses
                    </Link>
                    {' · '}
                    <Link href="/departments" prefetch={false} className="underline hover:text-primary transition-colors">
                        All departments
                    </Link>
                </p>
            </div>
        </section>
    );
}

/** Title, description and canonical for one course, served at `/<COURSEID>`. */
export function courseMetadata(course: Course): Metadata {
    const code = `${course.subject} ${course.code}`;
    const title = `${code}: ${decodeHtmlEntities(course.title)} — Stanford Root`;
    const blurb = plainText(course.description);
    const desc = (
        `Student reviews, ratings, hours/week, sections, and syllabus for ${code} at Stanford. ` +
        blurb
    ).slice(0, 300);
    const path = `/${encodeURIComponent(course.id)}`;

    return {
        title,
        description: desc,
        alternates: { canonical: path },
        openGraph: {
            title,
            description: desc,
            url: `${SITE_URL}${path}`,
            type: 'article',
        },
    };
}

/** The interactive course page plus the crawlable summary underneath it. */
export function CourseView({ course }: { course: Course }) {
    return (
        <>
            <script
                type="application/ld+json"
                // Escape < so a title or description containing "</script>"
                // cannot close this tag. No catalog row does today.
                dangerouslySetInnerHTML={{ __html: JSON.stringify(courseJsonLd(course)).replace(/</g, '\\u003c') }}
            />
            <CoursePageClient initialCourse={course} />
            <CourseSummary course={course} />
            {/* SEO-only; must not block the interactive course view on a slow dept scan. */}
            <Suspense fallback={null}>
                <RelatedCourses course={course} />
            </Suspense>
        </>
    );
}
