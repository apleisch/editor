import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PlanPoint, PlanSegment } from './detect-walls'

/** One PDF page read as a floor plan, in paper millimetres (origin top left, y down). */
export type PdfPlanPage = {
  pageNumber: number
  pageCount: number
  widthMm: number
  heightMm: number
  /** The `n` of a printed "1:n" drawing scale, when the sheet states one. */
  printedScale: number | null
  /** Stroked straight lines; curves (door swings, furniture) are left out. */
  segments: PlanSegment[]
  /** Dark filled polygons (some plans fill walls instead of hatching them). */
  fills: PlanPoint[][]
  image: Blob
}

type Matrix = [number, number, number, number, number, number]

const MM_PER_POINT = 25.4 / 72
const MAX_IMAGE_EDGE = 4096

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<Pdfjs> | null = null

/**
 * pdf.js runs its parser in-thread ("fake worker") so no worker file has to be
 * served next to the app bundle; plans are small enough for that. The legacy
 * build carries the polyfills older iOS Safari needs.
 */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  return pdfjsPromise
}

export async function readPdfPlanPage(file: Blob, pageNumber = 1): Promise<PdfPlanPage> {
  const pdfjs = await loadPdfjs()
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loading.promise
  try {
    const page = await pdf.getPage(Math.min(Math.max(1, pageNumber), pdf.numPages))
    const viewport = page.getViewport({ scale: 1 })
    const [segments, fills] = await readVectorPaths(pdfjs, page, viewport.transform as Matrix)
    const text = await page.getTextContent()
    const printedScale = findPrintedScale(
      text.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    )
    return {
      pageNumber: page.pageNumber,
      pageCount: pdf.numPages,
      widthMm: viewport.width * MM_PER_POINT,
      heightMm: viewport.height * MM_PER_POINT,
      printedScale,
      segments,
      fills,
      image: await renderPage(page),
    }
  } finally {
    await loading.destroy()
  }
}

/**
 * Finds the drawing scale printed on a sheet ("Massstab 1:100", "M 1:50").
 * The most frequent ratio wins, so a detail callout does not override the
 * title block.
 */
export function findPrintedScale(text: string): number | null {
  const counts = new Map<number, number>()
  for (const match of text.matchAll(/(?<![\d.,:])1\s*:\s*(\d{1,4})(?![\d.,:])/g)) {
    const scale = Number(match[1])
    if (scale >= 5 && scale <= 5000) counts.set(scale, (counts.get(scale) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [scale, count] of counts) {
    if (best === null || count > counts.get(best)!) best = scale
  }
  return best
}

async function renderPage(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 })
  const scale = MAX_IMAGE_EDGE / Math.max(base.width, base.height)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport, background: 'white' }).promise
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Could not render the PDF page')
  return blob
}

const STROKE_OPS = [
  'stroke',
  'closeStroke',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
] as const
const FILL_OPS = [
  'fill',
  'eoFill',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
] as const

/** Walks the page's drawing operators and collects its straight lines and dark fills in paper mm. */
async function readVectorPaths(
  pdfjs: Pdfjs,
  page: PDFPageProxy,
  pageTransform: Matrix,
): Promise<[PlanSegment[], PlanPoint[][]]> {
  const { OPS } = pdfjs
  const strokeOps = new Set<number>(STROKE_OPS.map((name) => OPS[name]))
  const fillOps = new Set<number>(FILL_OPS.map((name) => OPS[name]))
  const operators = await page.getOperatorList()
  const segments: PlanSegment[] = []
  const fills: PlanPoint[][] = []
  const stack: { matrix: Matrix; fillColor: string }[] = []
  let matrix = pageTransform
  let fillColor = '#000000'

  for (let index = 0; index < operators.fnArray.length; index++) {
    const fn = operators.fnArray[index]
    const args = operators.argsArray[index] as unknown[]
    if (fn === OPS.save) {
      stack.push({ matrix, fillColor })
    } else if (fn === OPS.restore) {
      const state = stack.pop()
      if (state) ({ matrix, fillColor } = state)
    } else if (fn === OPS.transform) {
      matrix = multiply(matrix, args as Matrix)
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ matrix, fillColor })
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) {
        matrix = multiply(matrix, Array.from(args[0] as ArrayLike<number>) as Matrix)
      }
    } else if (fn === OPS.paintFormXObjectEnd) {
      const state = stack.pop()
      if (state) ({ matrix, fillColor } = state)
    } else if (fn === OPS.setFillRGBColor) {
      if (typeof args[0] === 'string') fillColor = args[0]
    } else if (fn === OPS.constructPath) {
      const op = args[0] as number
      const data = (args[1] as (Float32Array | null)[] | undefined)?.[0]
      if (!data) continue
      const subpaths = readSubpaths(data, matrix)
      if (strokeOps.has(op)) {
        for (const { points, closed, curved } of subpaths) {
          for (let i = 1; i < points.length; i++) segments.push([points[i - 1]!, points[i]!])
          if (closed && !curved && points.length > 2) segments.push([points.at(-1)!, points[0]!])
        }
      }
      if (fillOps.has(op) && isDark(fillColor)) {
        for (const { points, curved } of subpaths)
          if (!curved && points.length > 2) fills.push(points)
      }
    }
  }
  return [segments, fills]
}

type Subpath = { points: PlanPoint[]; closed: boolean; curved: boolean }

/** Decodes pdf.js path data (moveTo 0, lineTo 1, curveTo 2, quadraticCurveTo 3, closePath 4). */
function readSubpaths(data: Float32Array, matrix: Matrix): Subpath[] {
  const subpaths: Subpath[] = []
  let current: Subpath | null = null
  const point = (x: number, y: number): PlanPoint => [
    (matrix[0] * x + matrix[2] * y + matrix[4]) * MM_PER_POINT,
    (matrix[1] * x + matrix[3] * y + matrix[5]) * MM_PER_POINT,
  ]
  for (let k = 0; k < data.length; ) {
    switch (data[k++]) {
      case 0:
        current = { points: [point(data[k]!, data[k + 1]!)], closed: false, curved: false }
        subpaths.push(current)
        k += 2
        break
      case 1:
        current?.points.push(point(data[k]!, data[k + 1]!))
        k += 2
        break
      case 2:
        // A curve ends the straight run; restart from its end point.
        if (current) current.curved = true
        current = { points: [point(data[k + 4]!, data[k + 5]!)], closed: false, curved: true }
        subpaths.push(current)
        k += 6
        break
      case 3:
        if (current) current.curved = true
        current = { points: [point(data[k + 2]!, data[k + 3]!)], closed: false, curved: true }
        subpaths.push(current)
        k += 4
        break
      case 4:
        if (current) current.closed = true
        break
      default:
        return subpaths
    }
  }
  return subpaths
}

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function isDark(hex: string) {
  const value = Number.parseInt(hex.slice(1, 7), 16)
  if (Number.isNaN(value)) return false
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 160
}
