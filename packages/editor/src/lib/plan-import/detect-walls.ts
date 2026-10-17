export type PlanPoint = readonly [number, number]
export type PlanSegment = readonly [PlanPoint, PlanPoint]

export type DetectedWall = {
  start: [number, number]
  end: [number, number]
  thickness: number
}

export type WallDetectionOptions = {
  /** Thinnest wall to look for, in plan units (meters). */
  minThickness?: number
  /** Thickest wall to look for. Kitchen counters and bathtubs sit just above it. */
  maxThickness?: number
  /** Shortest wall piece kept. */
  minLength?: number
}

const ANGLE_TOLERANCE = (0.5 * Math.PI) / 180
const OFFSET_TOLERANCE = 0.005
const JOIN_GAP = 0.01
const BAND_EPSILON = 0.02
const MIN_HATCH_ANGLE = (15 * Math.PI) / 180
const MAX_HATCH_SPACING = 0.25
const MIN_JUNCTION_ANGLE = (10 * Math.PI) / 180

type Direction = { angle: number; dir: [number, number]; normal: [number, number] }

/** An outline: collinear drawn segments merged into one line along a direction. */
type Outline = { offset: number; from: number; to: number }

/** A wall found in one direction cluster, in that cluster's (along, offset) frame. */
type Band = {
  offset: number
  low: number
  high: number
  from: number
  to: number
}

type FrameWall = Band & { direction: Direction }

/**
 * Finds walls in a CAD floor plan drawn the usual way: a wall is two parallel
 * outlines with hatching (or a fill) between them. Pairs of parallel outlines
 * alone are not enough, because furniture, title blocks and dimension chains
 * draw those too; the hatch strokes that run from one outline to the other are
 * what marks a wall. Outlines broken by a joining wall are bridged, door and
 * window openings stay open, and wall ends are pulled onto the centerline of the
 * wall they run into so corners and tees meet.
 *
 * `fills` are filled polygons of the drawing; a pair of outlines whose middle
 * lies inside one counts as a wall too (plans that fill walls instead of
 * hatching them).
 */
export function detectWalls(
  segments: readonly PlanSegment[],
  fills: readonly (readonly PlanPoint[])[] = [],
  options: WallDetectionOptions = {},
): DetectedWall[] {
  const minThickness = options.minThickness ?? 0.06
  const maxThickness = options.maxThickness ?? 0.6
  const minLength = options.minLength ?? 0.25

  const usable = segments.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-4)
  const walls: FrameWall[] = []

  for (const { direction, members } of clusterByDirection(usable)) {
    const outlines = mergeOutlines(members.map((segment) => toFrame(segment, direction)))
    const bands: Band[] = []
    for (let i = 0; i < outlines.length; i++) {
      const lower = outlines[i]!
      if (lower.to - lower.from < minLength) continue
      for (let j = i + 1; j < outlines.length; j++) {
        const upper = outlines[j]!
        const thickness = upper.offset - lower.offset
        if (thickness > maxThickness) break
        if (thickness < minThickness || upper.to - upper.from < minLength) continue
        const from = Math.max(lower.from, upper.from)
        const to = Math.min(lower.to, upper.to)
        if (to - from < minLength) continue
        if (isSplitByOutline(outlines, lower.offset, upper.offset, from, to)) continue
        const band = {
          offset: (lower.offset + upper.offset) / 2,
          low: lower.offset,
          high: upper.offset,
          from,
          to,
        }
        if (isFilledBand(band, direction, usable, fills)) bands.push(band)
      }
    }
    for (const band of mergeLayers(bridgeBands(bands, outlines, minLength), maxThickness)) {
      walls.push({ ...band, direction })
    }
  }

  return joinWallEnds(walls)
    .filter(
      (wall) => Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) >= minLength,
    )
    .map((wall) => ({
      start: [round(wall.start[0], 0.001), round(wall.start[1], 0.001)],
      end: [round(wall.end[0], 0.001), round(wall.end[1], 0.001)],
      thickness: round(wall.thickness, 0.005),
    }))
}

function clusterByDirection(segments: readonly PlanSegment[]) {
  const withAngle = segments
    .map((segment) => {
      const [a, b] = segment
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0])
      if (angle < 0) angle += Math.PI
      if (angle >= Math.PI - ANGLE_TOLERANCE) angle -= Math.PI
      return { segment, angle }
    })
    .sort((left, right) => left.angle - right.angle)

  const clusters: { direction: Direction; members: PlanSegment[] }[] = []
  let current: { angles: number[]; members: PlanSegment[] } | null = null
  const close = () => {
    if (!current) return
    const angle = current.angles.reduce((sum, value) => sum + value, 0) / current.angles.length
    clusters.push({ direction: makeDirection(angle), members: current.members })
  }
  for (const { segment, angle } of withAngle) {
    if (current && angle - current.angles[0]! <= ANGLE_TOLERANCE) {
      current.angles.push(angle)
      current.members.push(segment)
    } else {
      close()
      current = { angles: [angle], members: [segment] }
    }
  }
  close()
  return clusters
}

function makeDirection(angle: number): Direction {
  const dir: [number, number] = [Math.cos(angle), Math.sin(angle)]
  return { angle, dir, normal: [-dir[1], dir[0]] }
}

function along(point: PlanPoint, direction: Direction) {
  return point[0] * direction.dir[0] + point[1] * direction.dir[1]
}

function across(point: PlanPoint, direction: Direction) {
  return point[0] * direction.normal[0] + point[1] * direction.normal[1]
}

function toFrame([a, b]: PlanSegment, direction: Direction): Outline {
  const ta = along(a, direction)
  const tb = along(b, direction)
  return {
    offset: (across(a, direction) + across(b, direction)) / 2,
    from: Math.min(ta, tb),
    to: Math.max(ta, tb),
  }
}

function fromFrame(t: number, offset: number, direction: Direction): [number, number] {
  return [
    t * direction.dir[0] + offset * direction.normal[0],
    t * direction.dir[1] + offset * direction.normal[1],
  ]
}

/** Merges collinear pieces (CAD exports split outlines at every hatch stroke). */
function mergeOutlines(pieces: Outline[]): Outline[] {
  const sorted = [...pieces].sort((left, right) => left.offset - right.offset)
  const rows: Outline[][] = []
  for (const piece of sorted) {
    const row = rows.at(-1)
    if (row && piece.offset - row[0]!.offset <= OFFSET_TOLERANCE) row.push(piece)
    else rows.push([piece])
  }
  const merged: Outline[] = []
  for (const row of rows) {
    const offset = row.reduce((sum, piece) => sum + piece.offset, 0) / row.length
    const spans = row.sort((left, right) => left.from - right.from)
    let from = spans[0]!.from
    let to = spans[0]!.to
    for (const span of spans.slice(1)) {
      if (span.from <= to + JOIN_GAP) {
        to = Math.max(to, span.to)
      } else {
        merged.push({ offset, from, to })
        from = span.from
        to = span.to
      }
    }
    merged.push({ offset, from, to })
  }
  return merged.sort((left, right) => left.offset - right.offset || left.from - right.from)
}

/** A third outline running inside the pair means the pair spans two things, not one wall. */
function isSplitByOutline(
  outlines: Outline[],
  low: number,
  high: number,
  from: number,
  to: number,
) {
  const span = to - from
  return outlines.some(
    (outline) =>
      outline.offset > low + OFFSET_TOLERANCE * 2 &&
      outline.offset < high - OFFSET_TOLERANCE * 2 &&
      Math.min(outline.to, to) - Math.max(outline.from, from) > span * 0.5,
  )
}

function isFilledBand(
  band: Band,
  direction: Direction,
  segments: readonly PlanSegment[],
  fills: readonly (readonly PlanPoint[])[],
) {
  // Hatching is a run of parallel strokes at a steady spacing; the X of an
  // appliance or the dividers of a counter are a few strokes far apart.
  const length = band.to - band.from
  const needed = Math.max(2, length / MAX_HATCH_SPACING)
  const strokesByAngle = new Map<number, number>()
  for (const segment of segments) {
    const [a, b] = segment
    let angle = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) - direction.angle) % Math.PI
    if (angle > Math.PI / 2) angle = Math.PI - angle
    if (angle < MIN_HATCH_ANGLE) continue
    if (!(isInsideBand(a, band, direction) && isInsideBand(b, band, direction))) continue
    // A hatch stroke runs from one face to the other; dot and gravel patterns don't.
    if (Math.abs(across(b, direction) - across(a, direction)) < 0.5 * (band.high - band.low))
      continue
    let bucket = Math.atan2(b[1] - a[1], b[0] - a[0])
    if (bucket < 0) bucket += Math.PI
    const key = Math.round((bucket * 180) / Math.PI / 2) % 90
    const count = (strokesByAngle.get(key) ?? 0) + 1
    if (count >= needed) return true
    strokesByAngle.set(key, count)
  }
  const middle = fromFrame((band.from + band.to) / 2, band.offset, direction)
  return fills.some((polygon) => isInsidePolygon(middle, polygon))
}

function isInsideBand(point: PlanPoint, band: Band, direction: Direction) {
  const t = along(point, direction)
  const offset = across(point, direction)
  return (
    offset >= band.low - BAND_EPSILON &&
    offset <= band.high + BAND_EPSILON &&
    t >= band.from - BAND_EPSILON &&
    t <= band.to + BAND_EPSILON
  )
}

function isInsidePolygon(point: PlanPoint, polygon: readonly PlanPoint[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Joins collinear pieces of the same wall. Pieces overlap where hatching was
 * split, and leave a gap where another wall joins from one side: there one
 * outline breaks but the opposite one runs through, which is what tells the
 * gap apart from a door or window opening (both outlines break).
 */
function bridgeBands(bands: Band[], outlines: Outline[], minLength: number): Band[] {
  const sorted = [...bands].sort(
    (left, right) => left.offset - right.offset || left.from - right.from,
  )
  const result: Band[] = []
  for (const band of sorted) {
    const previous = [...result]
      .reverse()
      .find(
        (candidate) =>
          Math.abs(candidate.offset - band.offset) <= OFFSET_TOLERANCE * 2 &&
          Math.abs(candidate.high - candidate.low - (band.high - band.low)) <= 0.02,
      )
    if (previous && band.from <= previous.to + JOIN_GAP) {
      previous.to = Math.max(previous.to, band.to)
      continue
    }
    if (previous && isGapSpanned(previous, band, outlines)) {
      previous.to = Math.max(previous.to, band.to)
      continue
    }
    result.push({ ...band })
  }
  return result.filter((band) => band.to - band.from >= minLength)
}

function isGapSpanned(before: Band, after: Band, outlines: Outline[]) {
  const gapFrom = before.to
  const gapTo = after.from
  if (gapTo - gapFrom > before.high - before.low + 0.45) return false
  return outlines.some(
    (outline) =>
      (Math.abs(outline.offset - before.low) <= OFFSET_TOLERANCE ||
        Math.abs(outline.offset - before.high) <= OFFSET_TOLERANCE) &&
      outline.from <= gapFrom + JOIN_GAP &&
      outline.to >= gapTo - JOIN_GAP,
  )
}

/**
 * Joins the layers of one wall. Outer walls are drawn as a masonry band and an
 * insulation band side by side, each with its own hatch; they share the line
 * between them and become one wall as thick as both.
 */
function mergeLayers(bands: Band[], maxThickness: number): Band[] {
  const layers = [...bands].sort((left, right) => left.low - right.low)
  const merged: Band[] = []
  for (const band of layers) {
    const below = merged.find(
      (candidate) =>
        Math.abs(candidate.high - band.low) <= OFFSET_TOLERANCE * 2 &&
        band.high - candidate.low <= maxThickness &&
        Math.min(candidate.to, band.to) - Math.max(candidate.from, band.from) >
          0.5 * Math.min(candidate.to - candidate.from, band.to - band.from),
    )
    if (!below) {
      merged.push({ ...band })
      continue
    }
    below.high = band.high
    below.offset = (below.low + below.high) / 2
    below.from = Math.min(below.from, band.from)
    below.to = Math.max(below.to, band.to)
  }
  return merged
}

type PlacedWall = {
  start: [number, number]
  end: [number, number]
  thickness: number
  angle: number
}

/** Pulls each wall end onto the centerline of the wall it runs into (corners, tees). */
function joinWallEnds(walls: FrameWall[]): PlacedWall[] {
  const placed = walls.map((wall) => ({
    start: fromFrame(wall.from, wall.offset, wall.direction),
    end: fromFrame(wall.to, wall.offset, wall.direction),
    thickness: wall.high - wall.low,
    angle: wall.direction.angle,
  }))
  const original = placed.map((wall) => ({ start: wall.start, end: wall.end }))

  placed.forEach((wall, index) => {
    for (const key of ['start', 'end'] as const) {
      const point = original[index]![key]
      let best: { point: [number, number]; distance: number } | null = null
      placed.forEach((other, otherIndex) => {
        if (otherIndex === index) return
        let angle = Math.abs(other.angle - wall.angle) % Math.PI
        if (angle > Math.PI / 2) angle = Math.PI - angle
        if (angle < MIN_JUNCTION_ANGLE) return
        const crossing = lineIntersection(original[index]!, original[otherIndex]!)
        if (!crossing) return
        const distance = Math.hypot(crossing[0] - point[0], crossing[1] - point[1])
        if (distance > other.thickness / 2 + wall.thickness / 2 + 0.05) return
        const reach = wall.thickness / 2 + 0.05
        if (!isWithinSegment(crossing, original[otherIndex]!, reach)) return
        if (!best || distance < best.distance) best = { point: crossing, distance }
      })
      if (best) wall[key] = (best as { point: [number, number] }).point
    }
  })
  return placed
}

function lineIntersection(
  first: { start: [number, number]; end: [number, number] },
  second: { start: [number, number]; end: [number, number] },
): [number, number] | null {
  const [x1, y1] = first.start
  const [x2, y2] = first.end
  const [x3, y3] = second.start
  const [x4, y4] = second.end
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-12) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
}

function isWithinSegment(
  point: [number, number],
  segment: { start: [number, number]; end: [number, number] },
  reach: number,
) {
  const dx = segment.end[0] - segment.start[0]
  const dy = segment.end[1] - segment.start[1]
  const length = Math.hypot(dx, dy)
  const t = ((point[0] - segment.start[0]) * dx + (point[1] - segment.start[1]) * dy) / length
  return t >= -reach && t <= length + reach
}

function round(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(4))
}
