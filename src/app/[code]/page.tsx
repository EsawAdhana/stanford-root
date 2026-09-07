import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { Course } from '@/types/course';
import { compareCourseCodes } from '@/lib/utils';
import { SITE_URL } from '@/lib/site';
import {
    getAllCourseIdsFromDump,
    getAllSubjectsFromDump,
    getCourseFromDump,
    getDepartmentFromDump,
    resolveCourseIdFromDump,
    type DumpDeptCourse,
} from '@/lib/catalog-dump';
import { CourseView, courseMetadata } from './course-view';
import { DepartmentView } from './department-view';

// Cache the server render (metadata + SSR summary + JSON-LD) for a day.
export const revalidate = 86400;

/**
 * Prerender every course and department page at build time. The catalog is a
 * local JSON file, so this needs no database, and it is what makes these pages
 * CDN-cacheable instead of re-rendered per view.
 */
export async function generateStaticParams() {
    const [ids, subjects] = await Promise.all([
        getAllCourseIdsFromDump(),
        getAllSubjectsFromDump(),
    ]);
    return [...ids, ...subjects].map(code => ({ code }));
}

type Resolved =
    | { kind: 'course'; course: Course }
    | { kind: 'department'; subject: string; courses: DumpDeptCourse[] };

/**
 * One root segment serves both `/CS` and `/CS106B`. That is only unambiguous
 * because no subject in the catalog is also a course id, which
 * tests/root-code-routing.test.ts asserts over the committed dump.
 *
 * Shared by generateMetadata and the page so a redirect or a 404 fires before
 * the response streams, producing a real 308/404 status rather than a 200
 * carrying a "not found" body.
 */
const resolveCode = cache(async (raw: string): Promise<Resolved> => {
    const code = decodeURIComponent(raw);

    const subjects = await getAllSubjectsFromDump();
    if (subjects.includes(code)) {
        const courses = (await getDepartmentFromDump(code))
            .sort((a, b) => compareCourseCodes(a.code, b.code));
        if (courses.length > 0) return { kind: 'department', subject: code, courses };
    }

    const course = await getCourseFromDump(code);
    if (course) return { kind: 'course', course };

    // Casing and spacing only: `/cs106a` and `/CS%20106A` both belong at `/CS106A`.
    const canonicalId = await resolveCourseIdFromDump(code);
    if (canonicalId) permanentRedirect(`/${encodeURIComponent(canonicalId)}`);

    const upper = code.toUpperCase();
    if (upper !== code && subjects.includes(upper)) {
        permanentRedirect(`/${encodeURIComponent(upper)}`);
    }

    notFound();
});

export async function generateMetadata({
    params,
}: {
    params: Promise<{ code: string }>;
}): Promise<Metadata> {
    const { code } = await params;
    const resolved = await resolveCode(code);

    if (resolved.kind === 'course') return courseMetadata(resolved.course);

    const { subject, courses } = resolved;
    const title = `${subject} Courses at Stanford (${courses.length}) — Stanford Root`;
    const description =
        `All ${courses.length} ${subject} courses in Stanford's catalog with student evaluation ` +
        `ratings, hours per week, and sections. ` +
        courses.slice(0, 3).map(c => `${c.subject} ${c.code}`).join(', ') +
        ', and more.';
    const path = `/${encodeURIComponent(subject)}`;

    return {
        title,
        description,
        alternates: { canonical: path },
        openGraph: { title, description, url: `${SITE_URL}${path}`, type: 'website' },
    };
}

export default async function CodePage({
    params,
}: {
    params: Promise<{ code: string }>;
}) {
    const { code } = await params;
    const resolved = await resolveCode(code);

    return resolved.kind === 'course'
        ? <CourseView course={resolved.course} />
        : <DepartmentView subject={resolved.subject} courses={resolved.courses} />;
}
