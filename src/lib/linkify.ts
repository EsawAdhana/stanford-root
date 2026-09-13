/**
 * Turn bare URLs and email addresses inside catalog prose into link segments.
 *
 * Descriptions arrive as plain text -- no anchor markup anywhere in the catalog --
 * so a course that says "More information is available at https://goto.stanford.edu/..."
 * renders as dead text unless we find the URL ourselves.
 *
 * The rule is the same one the course-reference linker follows: never rewrite the
 * author's characters. A segment's `text` is exactly what was in the source; only
 * `href` is synthesised (a scheme is added for `www.` hosts, which browsers would
 * otherwise resolve relative to the site).
 */

/**
 * http(s) URLs, scheme-less `www.` hosts, and email addresses. A bare host with no
 * scheme and no `@` ("stanford.edu.") is left alone: in this catalog those are nearly
 * always the tail of an address that a nearby sentence already spelled out.
 *
 * URLs are listed first so an address-shaped tail inside a URL ("...\/a@b.edu") is
 * consumed as part of the URL rather than matched as mail.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gi

/** Sentence punctuation that the catalog puts after a URL, not inside one. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'", '>'])

/**
 * Trim punctuation the sentence owns, not the URL. Closing brackets only come off when
 * they are unbalanced, so a URL that genuinely contains "(...)" survives intact.
 */
function trimTrailingPunctuation(url: string): string {
    let end = url.length
    while (end > 0 && TRAILING.has(url[end - 1])) {
        const ch = url[end - 1]
        if (ch === ')' || ch === ']' || ch === '}') {
            const open = ch === ')' ? '(' : ch === ']' ? '[' : '{'
            const slice = url.slice(0, end)
            const opens = slice.split(open).length - 1
            const closes = slice.split(ch).length - 1
            if (opens >= closes) break
        }
        end--
    }
    return url.slice(0, end)
}

/** `mailto:` for an address, `https://` for a scheme-less host, otherwise the URL as written. */
function hrefFor(raw: string): string {
    if (/^https?:/i.test(raw)) return raw
    if (raw.includes('@')) return `mailto:${raw}`
    return `https://${raw}`
}

export interface LinkSpan {
    /** Index of the URL's first character in the input string. */
    start: number
    /** Index one past the URL's last character. */
    end: number
    /** The URL exactly as written. */
    text: string
    /** Absolute href to navigate to; differs from `text` only when a scheme had to be added. */
    href: string
}

/** Every URL and email address in `text`, in order, with sentence punctuation trimmed off the end. */
export function findLinkSpans(text: string): LinkSpan[] {
    const spans: LinkSpan[] = []
    if (!text) return spans
    URL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = URL_RE.exec(text)) !== null) {
        const raw = trimTrailingPunctuation(match[0])
        // "https://" with nothing after it is not a link.
        if (/^https?:\/\/$/i.test(raw) || /^www\.$/i.test(raw)) continue
        const start = match.index
        spans.push({
            start,
            end: start + raw.length,
            text: raw,
            href: hrefFor(raw),
        })
        URL_RE.lastIndex = start + raw.length
    }
    return spans
}

/** Split `text` into plain runs and link runs. Joining every `text` back together reproduces the input. */
export function splitLinkSegments(text: string): Array<{ text: string; href?: string }> {
    const out: Array<{ text: string; href?: string }> = []
    let last = 0
    for (const span of findLinkSpans(text)) {
        if (span.start > last) out.push({ text: text.slice(last, span.start) })
        out.push({ text: span.text, href: span.href })
        last = span.end
    }
    if (last < text.length) out.push({ text: text.slice(last) })
    return out
}
