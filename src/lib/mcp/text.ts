/**
 * Free-text relevance over titles, descriptions, codes and instructors: BM25
 * with titles weighted above descriptions, so "climate policy" finds a course
 * about it even when the title says neither. The site's own search matches
 * codes, titles and instructors only; agents ask in topics.
 */

const WORD = /[a-z0-9&]+/g
const STOPWORDS = new Set(
  'a an and are as at be by for from how i in into is it of on or that the this to with about class classes course courses intro introduction'.split(' '),
)
const TITLE_WEIGHT = 3
const K1 = 1.2
const B = 0.75

export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function terms(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter(w => !STOPWORDS.has(w)).map(stem)
}

type Doc = { title: Map<string, number>; body: Map<string, number>; length: number }

function counts(words: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1)
  return m
}

export class TextIndex {
  private docs = new Map<string, Doc>()
  private idf = new Map<string, number>()
  private avgLen = 1

  constructor(docs: Map<string, [string, string]>) {
    const df = new Map<string, number>()
    for (const [id, [title, body]] of docs) {
      const t = counts(terms(title))
      const b = counts(terms(body))
      let len = 0
      for (const n of t.values()) len += TITLE_WEIGHT * n
      for (const n of b.values()) len += n
      this.docs.set(id, { title: t, body: b, length: len })
      for (const w of new Set([...t.keys(), ...b.keys()])) df.set(w, (df.get(w) ?? 0) + 1)
    }
    const n = Math.max(1, this.docs.size)
    let total = 0
    for (const d of this.docs.values()) total += d.length
    this.avgLen = total / n || 1
    for (const [w, c] of df) this.idf.set(w, Math.log(1 + (n - c + 0.5) / (c + 0.5)))
  }

  score(id: string, words: string[]): number {
    const doc = this.docs.get(id)
    if (!doc) return 0
    let total = 0
    for (const w of words) {
      const tf = TITLE_WEIGHT * (doc.title.get(w) ?? 0) + (doc.body.get(w) ?? 0)
      if (tf) total += (this.idf.get(w) ?? 0) * tf * (K1 + 1) / (tf + K1 * (1 - B + B * doc.length / this.avgLen))
    }
    return total
  }

  matchesAll(id: string, words: string[]): boolean {
    const doc = this.docs.get(id)
    return !!doc && words.every(w => doc.title.has(w) || doc.body.has(w))
  }
}

/** The stretch of the description around the first query hit. */
export function snippet(text: string, words: string[], width = 180): string {
  if (!text) return ''
  const low = text.toLowerCase()
  const hits = words.map(w => low.indexOf(w)).filter(i => i >= 0)
  const start = hits.length ? Math.max(0, Math.min(...hits) - 40) : 0
  const piece = text.slice(start, start + width).trim()
  return (start ? '…' : '') + piece + (start + width < text.length ? '…' : '')
}
