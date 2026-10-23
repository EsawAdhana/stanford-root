/**
 * Text out of a PDF, line by line, in the browser. The transcript never
 * leaves the student's machine: pdf.js runs here and only the parsed course
 * rows are kept.
 *
 * pdf.js returns text in drawing order, not reading order, so items are
 * grouped into lines by their baseline and sorted left to right.
 */
let worker: Worker | null = null

export async function pdfToText(file: File, timeoutMs = 20_000): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  if (!worker) {
    worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
    pdfjs.GlobalWorkerOptions.workerPort = worker
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // A worker that never starts leaves pdf.js waiting forever; give up instead,
    // so the import screen can offer pasting the text.
    return await Promise.race([
      readPdf(pdfjs, file),
      new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error('reading the PDF timed out')), timeoutMs) }),
    ])
  } catch (err) {
    // Start from a fresh worker next time rather than reuse one that failed.
    worker?.terminate()
    worker = null
    pdfjs.GlobalWorkerOptions.workerPort = null
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function readPdf(pdfjs: typeof import('pdfjs-dist'), file: File): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const lines: string[] = []
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent()
    const rows = new Map<number, { x: number; text: string }[]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / 3) * 3
      const row = rows.get(y) ?? []
      row.push({ x: item.transform[4], text: item.str })
      rows.set(y, row)
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map(i => i.text.trim()).join(' '))
    }
  }
  // cleanup, not the loading task's destroy: that would also end the shared worker.
  await pdf.cleanup()
  return lines.join('\n')
}
