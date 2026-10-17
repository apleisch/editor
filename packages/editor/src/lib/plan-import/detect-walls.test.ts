import { describe, expect, it } from 'bun:test'
import { type DetectedWall, detectWalls, type PlanSegment } from './detect-walls'

type Rect = [x0: number, y0: number, x1: number, y1: number]

/** 45° hatch strokes clipped to an axis-aligned wall rectangle, the way CAD draws them. */
function hatch([x0, y0, x1, y1]: Rect, spacing = 0.08): PlanSegment[] {
  const strokes: PlanSegment[] = []
  for (let c = x0 - (y1 - y0); c < x1; c += spacing) {
    // Line x - y = c - y0, clipped to the rectangle.
    const ta = Math.max(y0, y0 + (x0 - c))
    const tb = Math.min(y1, y0 + (x1 - c))
    if (tb - ta > 0.01)
      strokes.push([
        [c + (ta - y0), ta],
        [c + (tb - y0), tb],
      ])
  }
  return strokes
}

function line(x0: number, y0: number, x1: number, y1: number): PlanSegment {
  return [
    [x0, y0],
    [x1, y1],
  ]
}

/**
 * A 6 × 4 m room with 20 cm outer walls, a 90 cm door in the bottom wall, a
 * 15 cm inner wall teeing into the top wall, a kitchen counter and a dimension
 * chain above the plan.
 */
function samplePlan(): PlanSegment[] {
  return [
    // Outer face, broken at the door.
    line(0, 0, 6, 0),
    line(6, 0, 6, 4),
    line(6, 4, 2.9, 4),
    line(2, 4, 0, 4),
    line(0, 4, 0, 0),
    // Inner face, broken at the door and where the inner wall joins.
    line(0.2, 0.2, 3, 0.2),
    line(3.15, 0.2, 5.8, 0.2),
    line(5.8, 0.2, 5.8, 3.8),
    line(5.8, 3.8, 2.9, 3.8),
    line(2, 3.8, 0.2, 3.8),
    line(0.2, 3.8, 0.2, 0.2),
    // Door jambs.
    line(2, 3.8, 2, 4),
    line(2.9, 3.8, 2.9, 4),
    // Inner wall with a free end.
    line(3, 0.2, 3, 2.5),
    line(3.15, 0.2, 3.15, 2.5),
    line(3, 2.5, 3.15, 2.5),
    ...hatch([0, 0, 6, 0.2]),
    ...hatch([0, 0.2, 0.2, 3.8]),
    ...hatch([5.8, 0.2, 6, 3.8]),
    ...hatch([0, 3.8, 2, 4]),
    ...hatch([2.9, 3.8, 6, 4]),
    ...hatch([3, 0.2, 3.15, 2.5]),
    // Kitchen counter: parallel outlines, no hatch.
    line(3.5, 0.8, 5.5, 0.8),
    line(3.5, 0.2, 3.5, 0.8),
    line(5.5, 0.2, 5.5, 0.8),
    // Dimension chain with ticks.
    line(0, -0.6, 6, -0.6),
    line(0, -0.9, 6, -0.9),
    line(-0.035, -0.635, 0.035, -0.565),
    line(5.965, -0.635, 6.035, -0.565),
  ]
}

function byPosition(walls: DetectedWall[]) {
  return walls
    .map((wall) => {
      const [a, b] =
        wall.start[0] + wall.start[1] <= wall.end[0] + wall.end[1]
          ? [wall.start, wall.end]
          : [wall.end, wall.start]
      return { start: a, end: b, thickness: wall.thickness }
    })
    .sort((left, right) => left.start[1] - right.start[1] || left.start[0] - right.start[0])
}

describe('detectWalls', () => {
  it('finds the hatched walls, meeting at corners and tees, with the door left open', () => {
    expect(byPosition(detectWalls(samplePlan()))).toEqual([
      { start: [0.1, 0.1], end: [5.9, 0.1], thickness: 0.2 },
      { start: [0.1, 0.1], end: [0.1, 3.9], thickness: 0.2 },
      { start: [3.075, 0.1], end: [3.075, 2.5], thickness: 0.15 },
      { start: [5.9, 0.1], end: [5.9, 3.9], thickness: 0.2 },
      { start: [0.1, 3.9], end: [2, 3.9], thickness: 0.2 },
      { start: [2.9, 3.9], end: [5.9, 3.9], thickness: 0.2 },
    ])
  })

  it('ignores parallel outlines without hatching', () => {
    const outlinesOnly = samplePlan().filter(([a, b]) => a[0] === b[0] || a[1] === b[1])
    expect(detectWalls(outlinesOnly)).toEqual([])
  })

  it('accepts walls that are filled instead of hatched', () => {
    const fills = [
      [
        [0, 0],
        [4, 0],
        [4, 0.25],
        [0, 0.25],
      ] as const,
    ]
    expect(detectWalls([line(0, 0, 4, 0), line(0, 0.25, 4, 0.25)], fills)).toEqual([
      { start: [0, 0.125], end: [4, 0.125], thickness: 0.25 },
    ])
  })

  it('finds walls at any angle', () => {
    const angle = Math.PI / 6
    const rotate = ([x, y]: readonly [number, number]): [number, number] => [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
    ]
    const rotated = [line(0, 0, 3, 0), line(0, 0.2, 3, 0.2), ...hatch([0, 0, 3, 0.2])].map(
      ([a, b]): PlanSegment => [rotate(a), rotate(b)],
    )
    const [wall] = detectWalls(rotated)
    expect(wall?.thickness).toBe(0.2)
    const length = Math.hypot(wall!.end[0] - wall!.start[0], wall!.end[1] - wall!.start[1])
    expect(length).toBeCloseTo(3, 2)
  })

  it('joins a masonry layer and an insulation layer into one wall', () => {
    const insulation: PlanSegment[] = []
    for (let x = 0; x <= 4; x += 0.04) insulation.push(line(x, 0.15, x, 0.35))
    const walls = detectWalls([
      line(0, 0, 4, 0),
      line(0, 0.15, 4, 0.15),
      line(0, 0.35, 4, 0.35),
      ...hatch([0, 0, 4, 0.15]),
      ...insulation,
    ])
    expect(walls).toEqual([{ start: [0, 0.175], end: [4, 0.175], thickness: 0.35 }])
  })

  it('ignores kitchen rows with appliance crosses and dotted fill patterns', () => {
    const counter: PlanSegment[] = [line(0, 0, 4.8, 0), line(0, 0.6, 4.8, 0.6)]
    for (let x = 0; x <= 4.8; x += 0.6) counter.push(line(x, 0, x, 0.6))
    for (const x of [0, 0.6, 3.6, 4.2])
      counter.push(line(x, 0, x + 0.6, 0.6), line(x, 0.6, x + 0.6, 0))
    const dotted: PlanSegment[] = [line(0, 2, 3, 2), line(0, 2.3, 3, 2.3)]
    for (let x = 0.02; x < 3; x += 0.03) dotted.push(line(x, 2.1, x + 0.01, 2.11))
    expect(detectWalls([...counter, ...dotted])).toEqual([])
  })
})
