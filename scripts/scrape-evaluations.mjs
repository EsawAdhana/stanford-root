#!/usr/bin/env node

/**
 * Fetch Stanford EvaluationKit reports with one manual SSO login, then direct HTTP.
 *
 * Usage:
 *   node --env-file=.env.local scripts/scrape-evaluations.mjs --dry-run
 *   node --env-file=.env.local scripts/scrape-evaluations.mjs
 *   node --env-file=.env.local scripts/scrape-evaluations.mjs --terms W26,Sp26,Su26
 *   node --env-file=.env.local scripts/scrape-evaluations.mjs --course CS106B --dry-run
 *   node --env-file=.env.local scripts/scrape-evaluations.mjs --metrics-only
 *
 * --metrics-only recomputes courses.quality / quality_n / quality_pct /
 * rating_breakdown / cross_list_with from the evaluations already stored, with no
 * scrape and no SSO login. Use it after changing the rating maths.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { addRatingCounts, pooledMean, estimatePrior, shrinkToPrior, scopedPercentileRanks, round3, headlineSampleSize } from '../src/lib/quality-score.mjs'
import { buildCrossListGroups, deriveEvalPairings, normalizeCourseId } from '../src/lib/cross-list.mjs'
import { courseLevelSignature, normalizeTerm, reportIdentity } from '../src/lib/eval-reports.mjs'

const BASE_URL = 'https://stanford.evaluationkit.com'
const SEARCH_URL = `${BASE_URL}/Report/Public/Results`
const REPORT_URL = `${BASE_URL}/Reports/StudentReport.aspx`
const PROFILE_DIR = '.evaluationkit-profile'
const SEARCH_CACHE_DIR = '.eval-search-cache'
// Every term the stored corpus covers, not just the current year's three.
//
// A report is only kept if its course code is in the catalog at scrape time
// (see courseIdsForReport), so a course on hiatus loses the terms it WAS taught:
// CHEM 281 ran Winter 2024 and Winter 2025, was not offered in 2025-26, and so
// was absent from the catalog when the older terms were scraped in Feb 2026 --
// its reports were discarded, and the site showed it unrated once the 2026-27
// catalog brought it back. Re-running an older term against today's catalog is
// what recovers those, so the older codes have to stay addressable.
const TERM_LABELS = {
    F23: 'Fall 2023',
    W24: 'Winter 2024',
    Sp24: 'Spring 2024',
    Su24: 'Summer 2024',
    F24: 'Fall 2024',
    W25: 'Winter 2025',
    Sp25: 'Spring 2025',
    Su25: 'Summer 2025',
    F25: 'Fall 2025',
    W26: 'Winter 2026',
    Sp26: 'Spring 2026',
    Su26: 'Summer 2026',
}
const ALL_TERMS = Object.keys(TERM_LABELS)

// Default to every term, not the current year's three.
//
// The three-term default is what let the hole open in the first place: a course
// absent from the catalog when its term was last scraped never gets another look,
// and the catalog drops courses every year. A full pass used to cost an hour, which
// is why the default was narrow; with the search index cached it is 13s when there
// is nothing new, so there is no longer a reason to skip the older terms. Pass
// --refresh-search for a term that is still publishing evaluations.
const DEFAULT_TERMS = ALL_TERMS

function parseArgs() {
    const args = process.argv.slice(2)
    const opts = { dryRun: false, concurrency: 20, terms: DEFAULT_TERMS, course: null, metrics: true, metricsOnly: false, force: false, repairEmpty: false, refreshSearch: false }
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') opts.dryRun = true
        if (args[i] === '--no-metrics') opts.metrics = false
        if (args[i] === '--metrics-only') opts.metricsOnly = true
        if (args[i] === '--force') opts.force = true
        if (args[i] === '--repair-empty') opts.repairEmpty = true
        if (args[i] === '--refresh-search') opts.refreshSearch = true
        if (args[i] === '--course' && args[i + 1]) opts.course = args[++i].replace(/\s+/g, '').toUpperCase()
        if (args[i] === '--concurrency' && args[i + 1]) opts.concurrency = Math.max(1, Math.min(30, Number(args[++i]) || 20))
        if (args[i] === '--terms' && args[i + 1]) {
            const value = args[++i]
            opts.terms = value.trim().toLowerCase() === 'all'
                ? ALL_TERMS
                : value.split(',').map(term => term.trim()).filter(Boolean)
        }
    }
    for (const term of opts.terms) {
        if (!TERM_LABELS[term]) throw new Error(`Unsupported term ${term}. Supported: ${Object.keys(TERM_LABELS).join(', ')}`)
    }
    return opts
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function decodeHtml(text = '') {
    return text
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
        .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
}

function stripHtml(html = '') {
    return decodeHtml(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function attribute(html, name) {
    return decodeHtml(html.match(new RegExp(`\\b${name}=(?:\"([^\"]*)\"|'([^']*)')`, 'i'))?.slice(1).find(Boolean) || '')
}

function textByClass(html, className) {
    const pattern = new RegExp(
        `<([a-z0-9]+)[^>]*class=(?:\"[^\"]*\\b${className}\\b[^\"]*\"|'[^']*\\b${className}\\b[^']*')[^>]*>([\\s\\S]*?)<\\/\\1>`,
        'i'
    )
    return stripHtml(html.match(pattern)?.[2] || '')
}

function parseSearchResults(html) {
    const starts = [...html.matchAll(/<[^>]+\bclass=(?:"[^"]*"|'[^']*')[^>]*>/gi)]
        .filter(match => attribute(match[0], 'class').split(/\s+/).includes('sr-dataitem'))
    const reports = []
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i].index
        const end = starts[i + 1]?.index ?? html.length
        const item = html.slice(start, end)
        const button = item.match(/<[^>]+class=(?:"[^"]*\bsr-view-report\b[^"]*"|'[^']*\bsr-view-report\b[^']*')[^>]*>/i)?.[0]
        if (!button) continue
        const ids = ['data-id0', 'data-id1', 'data-id2', 'data-id3'].map(name => attribute(button, name))
        if (ids.some(id => !id)) continue
        reports.push({
            reportUrl: ids.join(','),
            courseCode: textByClass(item, 'sr-dataitem-info-code'),
            instructor: textByClass(item, 'sr-dataitem-info-instr'),
            respondents: textByClass(item, 'sr-avg'),
        })
    }
    return reports
}

function requestHeaders(cookie) {
    return {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
}

// Retries have to outlast a slow patch, not just a dropped packet. A 12-term run
// at concurrency 20 pushed EvaluationKit into 30s+ responses: 60 Fall 2024 reports
// were skipped, then three consecutive 30s timeouts on ONE search page threw out of
// searchTerm and killed the whole run partway through Winter 2025. Longer timeout,
// more attempts, slower backoff -- and keep failing loudly at the end rather than
// continuing past a search page, which would silently drop the courses on it.
async function authenticatedFetch(url, cookie, extraHeaders = {}) {
    let lastError
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const response = await fetch(url, {
                headers: { ...requestHeaders(cookie), ...extraHeaders },
                redirect: 'follow',
                signal: AbortSignal.timeout(90000),
            })
            if (response.url.includes('login.stanford.edu') || response.status === 401 || response.status === 403) {
                throw new Error('EvaluationKit session expired. Rerun and sign in again.')
            }
            if (response.ok) return response
            if (response.status < 500) throw new Error(`HTTP ${response.status} for ${url}`)
            lastError = new Error(`HTTP ${response.status} for ${url}`)
        } catch (error) {
            lastError = error
            if (String(error?.message).includes('session expired')) throw error
        }
        await sleep(attempt * 3000)
    }
    throw lastError
}

async function fetchSearchPage(termCode, page, cookie) {
    const params = new URLSearchParams({
        Course: termCode,
        Instructor: '',
        Search: 'true',
        page: String(page),
        _: String(Date.now()),
    })
    const response = await authenticatedFetch(
        `${BASE_URL}/AppApi/Report/PublicReport?${params}`,
        cookie,
        { 'X-Requested-With': 'XMLHttpRequest', Accept: '*/*' }
    )
    const text = await response.text()
    try {
        const json = JSON.parse(text)
        const html = Array.isArray(json.results) ? json.results.join('') : typeof json === 'string' ? json : text
        return { reports: parseSearchResults(html), hasMore: json.hasMore !== false }
    } catch {
        return { reports: parseSearchResults(text), hasMore: false }
    }
}

/**
 * The list of reports EvaluationKit published for a term, cached on disk.
 *
 * Paging it is the dominant cost of a run and it happens before a single report is
 * fetched: Fall 2023 lists 2,986 reports six pages at a time, ~2 min, and a
 * twelve-term pass spent roughly 33 of 58 minutes rediscovering lists it already
 * had. For a term that is over, that list cannot change.
 *
 * Staleness is the operator's call, not this function's: a term still collecting
 * evaluations needs --refresh-search. Nothing here infers which terms those are,
 * because inferring it wrong drops reports with no sign that it happened, which is
 * the whole failure this scraper already had once.
 */
function readSearchCache(termCode) {
    try {
        const cached = JSON.parse(readFileSync(`${SEARCH_CACHE_DIR}/${termCode}.json`, 'utf8'))
        return Array.isArray(cached?.reports) && cached.reports.length > 0 ? cached : null
    } catch {
        return null
    }
}

function writeSearchCache(termCode, reports) {
    mkdirSync(SEARCH_CACHE_DIR, { recursive: true })
    writeFileSync(
        `${SEARCH_CACHE_DIR}/${termCode}.json`,
        JSON.stringify({ termCode, fetchedAt: new Date().toISOString(), reports })
    )
}

async function searchTerm(termCode, cookie, useCache = true) {
    if (useCache) {
        const cached = readSearchCache(termCode)
        if (cached) {
            console.log(`  search index from cache (${cached.fetchedAt.slice(0, 10)}); --refresh-search to re-page`)
            return cached.reports
        }
    }
    const params = new URLSearchParams({ Course: termCode, Instructor: '', Search: 'true' })
    const first = await authenticatedFetch(`${SEARCH_URL}?${params}`, cookie)
    const reports = parseSearchResults(await first.text())
    // An empty first page is indistinguishable from a term that has not published
    // yet, so it is never cached -- caching it would pin the term at zero reports.
    if (reports.length === 0) return reports

    for (let start = 2; ; start += 6) {
        const pages = await Promise.all(
            Array.from({ length: 6 }, (_, offset) => fetchSearchPage(termCode, start + offset, cookie))
        )
        for (const page of pages) reports.push(...page.reports)
        if (pages.some(page => !page.hasMore) || pages.every(page => page.reports.length === 0)) break
    }
    const unique = Array.from(new Map(reports.map(report => [report.reportUrl, report])).values())
    writeSearchCache(termCode, unique)
    return unique
}

function parseReportData(rawQuestions, metadata) {
    const questions = []
    const comments = []
    for (const question of rawQuestions) {
        const text = String(question.QuestionText || '').replace(/All comments are subject to.*$/s, '').trim()
        if (question.QuestionType === 1) {
            comments.push(...String(question.AnswerText || '').split('||').map(value => value.trim()).filter(Boolean))
            continue
        }
        questions.push({
            text,
            type: question.QuestionType === 3 ? 'rating' : 'numeric',
            mean: Number.parseFloat(question.Mean) || 0,
            median: Number.parseFloat(question.Meadian) || 0,
            std: Number.parseFloat(question.STD) || 0,
            responseRate: question.ResponseRate || '',
            options: (question.Options || []).filter(option => option.OptionText !== '').map(option => ({
                text: option.OptionText,
                weight: option.OptionWeight,
                count: option.Frequency,
                pct: option.Percentage,
            })),
        })
    }
    return { ...metadata, questions, comments }
}

async function fetchReport(report, term, cookie) {
    const response = await authenticatedFetch(`${REPORT_URL}?id=${report.reportUrl}`, cookie)
    const html = await response.text()
    const value = html.match(/id="hdnReportData"[^>]*\bvalue="([^"]*)"/i)?.[1]
    if (!value) return null
    const raw = JSON.parse(decodeHtml(value))
    const evaluation = parseReportData(raw, {
        term,
        instructor: report.instructor,
        course_code: report.courseCode,
        respondents: report.respondents,
    })
    return evaluation.questions.length > 0 || evaluation.comments.length > 0 ? evaluation : null
}

function courseIdsForReport(courseCode, termCode, knownCourseIds) {
    const ids = []
    for (const segment of courseCode.split('/')) {
        const parts = segment.trim().split('-')
        if (parts.length < 3 || parts[0] !== termCode) continue
        const id = `${parts[1]}${parts[2]}`.replace(/\s+/g, '').toUpperCase()
        if (knownCourseIds.has(id)) ids.push(id)
    }
    return Array.from(new Set(ids))
}

async function loadAll(supabase, table, columns) {
    const rows = []
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select(columns).range(from, from + 999)
        if (error) throw error
        rows.push(...data)
        if (data.length < 1000) return rows
    }
}

async function loadEmptyEvaluations(supabase, terms) {
    const rows = []
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('evaluations')
            .select('course_id,course_code,term,instructor')
            .in('term', terms)
            .eq('questions', '[]')
            .eq('comments', '[]')
            .range(from, from + 999)
        if (error) throw error
        rows.push(...data)
        if (data.length < 1000) return rows
    }
}

async function login() {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1280, height: 800 },
    })
    const page = context.pages()[0] || await context.newPage()
    await page.goto(SEARCH_URL)
    if (new URL(page.url()).hostname !== 'stanford.evaluationkit.com') {
        console.log('Complete Stanford login and two-step verification in the opened browser.')
    }
    await page.waitForURL(url => url.hostname === 'stanford.evaluationkit.com', {
        timeout: 10 * 60 * 1000,
    })
    const cookies = await context.cookies(BASE_URL)
    const cookie = cookies.map(value => `${value.name}=${value.value}`).join('; ')
    if (!cookie) throw new Error('No EvaluationKit session cookies found')
    return { context, cookie }
}

function category(text) {
    const value = String(text || '').toLowerCase()
    if (value.includes('quality') || value.includes('overall')) return 'quality'
    if (value.includes('how much did you learn')) return 'learning'
    if (value.includes('organized')) return 'organization'
    if (value.includes('hours per week') || (value.includes('hours') && value.includes('week'))) return 'hours'
    return null
}

function median(values) {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function units(value) {
    const matches = String(value || '').match(/\d+(?:\.\d+)?/g)
    return Math.max(...(matches?.map(Number) || [1]))
}

async function refreshMetrics(supabase) {
    console.log('Recomputing course metrics...')
    const [evaluations, courses] = await Promise.all([
        loadAll(supabase, 'evaluations', 'course_id,course_code,term,instructor,questions'),
        loadAll(supabase, 'courses', 'course_id,subject,title,units,quality,quality_n,quality_pct,rank_scope,rating_breakdown'),
    ])
    const courseUnits = new Map(courses.map(course => [course.course_id, units(course.units)]))

    // Metrics are computed per CROSS-LIST GROUP, not per course_id, using the same
    // grouping the course page uses to merge the evaluations it charts.
    //
    // A class's evaluations are filed unevenly across the codes it is listed under:
    // ETHICSOC 185M holds three terms (49 responses) while its PHIL 72 listing holds
    // only the newest (19). Computing per course_id gave the same class two different
    // ratings depending on the URL, and made every listing's headline disagree with the
    // charts underneath it, which pool the group. Pooling the group fixes both and uses
    // all the data.
    // Codes Stanford evaluated jointly are part of the same class even when the catalog
    // title never says so, so feed those pairings into the grouping before using it.
    const catalogIds = new Set(courses.map(course => normalizeCourseId(course.course_id)))
    const pairings = deriveEvalPairings(evaluations, catalogIds)
    const groupInput = courses.map(course => ({
        id: course.course_id,
        title: course.title || '',
        crossListWith: pairings.get(normalizeCourseId(course.course_id)) || [],
    }))
    const groups = buildCrossListGroups(groupInput)
    const groupOfCourse = new Map()
    for (const [canonical, memberIds] of groups) {
        for (const memberId of memberIds) groupOfCourse.set(memberId, canonical)
    }

    // De-duplicate by what the students actually answered, not by row.
    //
    // One report is filed verbatim under every code it cross-lists, 6 are stored twice
    // under a single course_id, AND a co-taught section is filed once per instructor with
    // the same course-level answers -- that last one counted the same students up to
    // thirteen times. Keying on the answer signature collapses all three while keeping
    // genuinely distinct reports: separate sections carry separate course_codes, and the
    // Law School sections that really do rate each instructor differ in the signature.
    const questionsByGroup = new Map()
    const seenReports = new Set()
    let duplicates = 0
    for (const evaluation of evaluations) {
        const canonical = groupOfCourse.get(evaluation.course_id) ?? evaluation.course_id
        const reportKey = `${canonical}||${evaluation.course_code}||${normalizeTerm(evaluation.term)}||${courseLevelSignature(evaluation)}`
        if (seenReports.has(reportKey)) { duplicates++; continue }
        seenReports.add(reportKey)
        if (!questionsByGroup.has(canonical)) questionsByGroup.set(canonical, [])
        questionsByGroup.get(canonical).push(...(evaluation.questions || []))
    }
    console.log(`  ${seenReports.size} distinct reports over ${questionsByGroup.size} classes (${duplicates} duplicate rows skipped)`)

    // One pooled response distribution per class per rating category. Kept separate
    // because the categories are not the same scale -- see adjustAndRank.
    const RATING_CATEGORIES = ['quality', 'learning', 'organization']
    const pooledByCategory = new Map(RATING_CATEGORIES.map(key => [key, new Map()]))
    const hoursByGroup = new Map()

    for (const [canonical, questions] of questionsByGroup) {
        for (const question of questions) {
            const key = category(question.text)
            if (!key) continue
            if (key === 'hours') {
                if (Number.isFinite(question.median) && question.median > 0) {
                    if (!hoursByGroup.has(canonical)) hoursByGroup.set(canonical, [])
                    hoursByGroup.get(canonical).push(question.median)
                }
                continue
            }
            const forCategory = pooledByCategory.get(key)
            if (!forCategory) continue
            if (!forCategory.has(canonical)) forCategory.set(canonical, new Map())
            addRatingCounts(forCategory.get(canonical), question)
        }
    }

    // Every (department, class) pair that carries a score, in a fixed order. Ranking is
    // per LISTING because a course is ranked against its own department, and a
    // cross-listed class belongs to one department per listing -- CSRE 10 is ranked
    // against CSRE while its TAPS 10 listing is ranked against TAPS, off the same score.
    // De-duplicated per department so a class listed twice inside one department (an
    // undergrad/grad pair) is still one entry in that department's distribution.
    const pairsWithScore = (hasScore) => {
        const pairs = []
        const seen = new Set()
        for (const course of courses) {
            const canonical = groupOfCourse.get(course.course_id) ?? course.course_id
            const subject = course.subject || null
            if (!hasScore(canonical)) continue
            const key = `${subject}||${canonical}`
            if (seen.has(key)) continue
            seen.add(key)
            pairs.push({ subject, canonical, key })
        }
        return pairs
    }

    // Adjust and rank each category against its own corpus, one class = one entry.
    //
    // The SHRINKAGE prior stays Stanford-wide while the RANK is per department: the
    // prior answers "how much should I distrust 4 responses", which is a property of
    // the question and not of the department, and re-estimating it inside a 12-course
    // department would fit the corpus average to twelve classes.
    const breakdown = new Map()
    for (const key of RATING_CATEGORIES) {
        const scoreOf = new Map()
        const observations = []
        const ids = []
        for (const [canonical, counts] of pooledByCategory.get(key)) {
            const pooled = pooledMean(counts)
            if (!pooled) continue
            ids.push(canonical)
            observations.push(pooled)
        }
        if (ids.length === 0) continue
        const prior = estimatePrior(observations)
        // Round BEFORE ranking -- the rounded value is what gets stored and shown, so
        // ranking the unrounded one let two courses display an identical score and a
        // different percentile. See adjustAndRank in quality-score.mjs.
        ids.forEach((canonical, index) => {
            scoreOf.set(canonical, {
                score: round3(shrinkToPrior(observations[index].mean, observations[index].n, prior)),
                n: observations[index].n,
            })
        })
        const pairs = pairsWithScore(canonical => scoreOf.has(canonical))
        const ranks = scopedPercentileRanks(pairs.map(pair => ({
            scope: pair.subject,
            score: scoreOf.get(pair.canonical).score,
        })))
        const inDept = ranks.filter(rank => rank.scope != null).length
        console.log(`  ${key}: mean ${prior.grandMean.toFixed(3)}, shrinkage weight ${prior.weight.toFixed(1)} responses, ${ids.length} classes, ${inDept}/${pairs.length} listings ranked in-department`)
        pairs.forEach((pair, index) => {
            if (!breakdown.has(pair.key)) breakdown.set(pair.key, {})
            breakdown.get(pair.key)[key] = {
                score: scoreOf.get(pair.canonical).score,
                n: scoreOf.get(pair.canonical).n,
                pct: ranks[index].pct,
                scope: ranks[index].scope,
            }
        })
    }

    // The overall rating averages the adjusted category scores rather than pooling the
    // raw responses together: the categories sit ~0.19 apart on average, so pooling let
    // a class's score depend on which questions its evaluations happened to include.
    //
    // Keyed per (department, class) like the categories above: the score is the same for
    // every listing of a class, only the peer group it is ranked against differs.
    const perPair = new Map()
    for (const [pairKey, parts] of breakdown) {
        const values = Object.values(parts)
        perPair.set(pairKey, {
            quality: round3(values.reduce((sum, p) => sum + p.score, 0) / values.length),
            quality_n: headlineSampleSize(parts),
            rating_breakdown: parts,
        })
    }
    const overallPairs = pairsWithScore(() => true).filter(pair => perPair.has(pair.key))
    const overallRanks = scopedPercentileRanks(overallPairs.map(pair => ({
        scope: pair.subject,
        score: perPair.get(pair.key).quality,
    })))
    overallPairs.forEach((pair, index) => {
        const value = perPair.get(pair.key)
        value.quality_pct = overallRanks[index].pct
        value.rank_scope = overallRanks[index].scope
    })
    const inDept = overallRanks.filter(rank => rank.scope != null).length
    console.log(`  overall: ${overallPairs.length} listings, ${inDept} ranked within their department`)

    // Write the class's figures to every code it is listed under, so the rating never
    // depends on which listing the student opened. hrs/unit stays per-listing because
    // cross-listed codes can carry different unit counts.
    const updates = []
    for (const course of courses) {
        const canonical = groupOfCourse.get(course.course_id) ?? course.course_id
        const value = perPair.get(`${course.subject || null}||${canonical}`)
        const hours = median(hoursByGroup.get(canonical) || [])
        if (!value && hours == null) continue
        const update = { course_id: course.course_id }
        if (hours != null) {
            update.hours = hours
            update.difficulty = hours / (courseUnits.get(course.course_id) || 1)
        }
        if (value) {
            update.quality = value.quality
            update.quality_n = value.quality_n
            update.quality_pct = value.quality_pct
            update.rank_scope = value.rank_scope
            update.rating_breakdown = value.rating_breakdown
        }
        // The browser rebuilds the same groups from this, so it must be stored.
        const pairs = pairings.get(normalizeCourseId(course.course_id))
        if (pairs && pairs.length > 0) update.cross_list_with = pairs
        if (Object.keys(update).length > 1) updates.push(update)
    }

    // Clear ratings that no longer have anything behind them. Earlier scraper versions
    // wrote quality = 0 for courses whose evaluations carry no usable 1-5 response
    // (6 rows as of 2026-08-26, e.g. AMSTUD 261W), and 0 renders as the worst possible
    // score on a 1-5 scale. This write has to be authoritative, not additive.
    const written = new Set(updates.filter(update => update.quality != null).map(update => update.course_id))
    let cleared = 0
    for (const course of courses) {
        if (written.has(course.course_id)) continue
        const hasStale = course.quality != null || course.quality_n != null
            || course.quality_pct != null || course.rank_scope != null || course.rating_breakdown != null
        if (!hasStale) continue
        cleared++
        const existing = updates.find(update => update.course_id === course.course_id)
        const nulls = { quality: null, quality_n: null, quality_pct: null, rank_scope: null, rating_breakdown: null }
        if (existing) Object.assign(existing, nulls)
        else updates.push({ course_id: course.course_id, ...nulls })
    }
    if (cleared) console.log(`  clearing ${cleared} stale rating(s) with no supporting responses`)
    console.log(`  writing ${updates.length} course rows`)

    for (let i = 0; i < updates.length; i += 100) {
        const batch = updates.slice(i, i + 100)
        const results = await Promise.all(batch.map(({ course_id, ...fields }) =>
            supabase.from('courses').update(fields).eq('course_id', course_id)
        ))
        const error = results.find(result => result.error)?.error
        if (error) throw error
        process.stdout.write(`\rMetrics ${Math.min(i + 100, updates.length)}/${updates.length}`)
    }
    process.stdout.write('\n')
}

async function main() {
    const opts = parseArgs()
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(url, key, { auth: { persistSession: false } })

    // Recompute from what is already stored: no scrape, no browser, no SSO.
    if (opts.metricsOnly) {
        await refreshMetrics(supabase)
        return
    }

    const [courses, existing] = await Promise.all([
        loadAll(supabase, 'courses', 'course_id'),
        loadAll(supabase, 'evaluations', 'course_id,course_code,term,instructor'),
    ])
    const knownCourseIds = new Set(courses.map(course => course.course_id))
    const existingKeys = new Set(existing.map(reportIdentity))
    // --force and --repair-empty update by matching course_id/term/instructor, but the
    // stored term is usually the glued Feb-2026 shape ("Winter 2024Chemistry") while the
    // term computed here is the clean label. Matching on the clean one updates zero rows
    // and reports success, so match on what the row actually holds.
    const storedTerms = new Map(existing.map(row => [reportIdentity(row), row.term]))
    const emptyKeys = new Set(opts.repairEmpty
        ? (await loadEmptyEvaluations(supabase, opts.terms.map(term => TERM_LABELS[term]))).map(reportIdentity)
        : [])
    const runKeys = new Set()
    const { context, cookie } = await login()

    let found = 0
    let extracted = 0
    let unmatched = 0
    let duplicates = 0
    let failed = 0
    const unmatchedSamples = []
    try {
        for (const termCode of opts.terms) {
            const term = TERM_LABELS[termCode]
            console.log(`Searching ${term}...`)
            let reports = await searchTerm(termCode, cookie, !opts.refreshSearch)
            if (opts.course) {
                reports = reports.filter(report => courseIdsForReport(report.courseCode, termCode, knownCourseIds).includes(opts.course))
            }
            found += reports.length
            console.log(`${term}: ${reports.length} reports`)

            const candidates = []
            for (const report of reports) {
                const courseIds = courseIdsForReport(report.courseCode, termCode, knownCourseIds)
                if (courseIds.length === 0) {
                    unmatched++
                    if (unmatchedSamples.length < 20) unmatchedSamples.push(report.courseCode)
                    continue
                }
                const pendingIds = courseIds.filter(course_id =>
                    opts.force
                    || (opts.repairEmpty
                        ? emptyKeys.has(reportIdentity({ course_id, course_code: report.courseCode, term, instructor: report.instructor }))
                        : !existingKeys.has(reportIdentity({ course_id, course_code: report.courseCode, term, instructor: report.instructor })))
                )
                duplicates += courseIds.length - pendingIds.length
                if (pendingIds.length > 0) candidates.push({ ...report, courseIds: pendingIds })
            }
            console.log(`${term}: ${candidates.length} reports need extraction`)

            for (let i = 0; i < candidates.length; i += opts.concurrency) {
                const batch = candidates.slice(i, i + opts.concurrency)
                const fetched = await Promise.all(batch.map(async report => {
                    try {
                        const evaluation = await fetchReport(report, term, cookie)
                        return { report, evaluation }
                    } catch (error) {
                        console.warn(`${report.courseCode}: ${error.message}`)
                        return { report, evaluation: null }
                    }
                }))

                const rows = []
                for (const { report, evaluation } of fetched) {
                    if (!evaluation) {
                        failed++
                        continue
                    }
                    for (const course_id of report.courseIds) {
                        const row = { course_id, ...evaluation }
                        const rowKey = reportIdentity(row)
                        if (runKeys.has(rowKey) || (!opts.force && !opts.repairEmpty && existingKeys.has(rowKey))) {
                            duplicates++
                            continue
                        }
                        runKeys.add(rowKey)
                        existingKeys.add(rowKey)
                        rows.push(row)
                    }
                }

                if (!opts.dryRun && rows.length > 0) {
                    if (opts.force || opts.repairEmpty) {
                        const results = await Promise.all(rows.map(({ course_id, term, instructor, ...fields }) =>
                            supabase.from('evaluations').update(fields).match({
                                course_id,
                                course_code: fields.course_code,
                                term: storedTerms.get(reportIdentity({ course_id, course_code: fields.course_code, term, instructor })) ?? term,
                                instructor,
                            })
                        ))
                        const error = results.find(result => result.error)?.error
                        if (error) throw error
                    } else {
                        const { error } = await supabase.from('evaluations').insert(rows)
                        if (error) throw error
                    }
                }
                extracted += rows.length
                process.stdout.write(`\r${term}: ${Math.min(i + opts.concurrency, candidates.length)}/${candidates.length}, new=${extracted}, failed=${failed}`)
                await sleep(100)
            }
            process.stdout.write('\n')
        }
    } finally {
        await context.close()
    }

    console.log(JSON.stringify({ terms: opts.terms, found, extracted, duplicates, unmatched, unmatchedSamples, failed, dryRun: opts.dryRun }, null, 2))
    if (!opts.dryRun && opts.metrics) await refreshMetrics(supabase)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
