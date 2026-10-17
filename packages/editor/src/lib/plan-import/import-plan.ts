import {
  type AnyNodeId,
  GuideNode,
  planWallInsertion,
  resolveWallConstruction,
  runAsSingleSceneHistoryStep,
  saveAsset,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import useEditor from '../../store/use-editor'
import { type DetectedWall, detectWalls, type PlanPoint } from './detect-walls'
import type { PdfPlanPage } from './pdf-plan'

const WALL_JOIN_RADIUS = 0.05

/** Paper millimetres → plan metres, centred on the sheet (where the guide image sits). */
export function planWallsFromPage(page: PdfPlanPage, scale: number): DetectedWall[] {
  const metersPerMm = scale / 1000
  const toPlan = ([x, y]: PlanPoint): [number, number] => [
    (x - page.widthMm / 2) * metersPerMm,
    (y - page.heightMm / 2) * metersPerMm,
  ]
  return detectWalls(
    page.segments.map(([a, b]) => [toPlan(a), toPlan(b)] as const),
    page.fills.map((polygon) => polygon.map(toPlan)),
  )
}

/**
 * Adds the sheet as a guide image at its true size and, when given, the walls
 * read from it, all as one undo step. Walls go through the same insertion
 * planning as drawn walls, so they join and split each other like hand-drawn
 * ones.
 */
export async function importPlanPage({
  levelId,
  name,
  page,
  scale,
  walls,
  wallHeight,
}: {
  levelId: string
  name: string
  page: PdfPlanPage
  scale: number
  walls: DetectedWall[]
  wallHeight: number
}) {
  const url = await saveAsset(new File([page.image], `${name}.png`, { type: 'image/png' }))
  const width = (page.widthMm * scale) / 1000
  const height = (page.heightMm * scale) / 1000
  const guide = GuideNode.parse({
    name,
    url,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    // The guide plane is 10 m wide at scale 1.
    scale: width / 10,
    opacity: 50,
    scaleReference: {
      start: [-width / 2, height / 2],
      end: [width / 2, height / 2],
      realLengthMeters: width,
      measuredLengthUnits: width,
      metersPerUnit: 1,
      label: `1:${scale}`,
    },
  })

  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().createNode(guide, levelId as AnyNodeId)
    const wallDefaults = useEditor.getState().toolDefaults.wall ?? {}
    for (const wall of walls) {
      const { nodes, applyNodeChanges } = useScene.getState()
      const result = planWallInsertion(nodes, {
        levelId: levelId as AnyNodeId,
        start: wall.start,
        end: wall.end,
        joinRadius: WALL_JOIN_RADIUS,
        wallDefaults: { ...wallDefaults, thickness: wall.thickness, height: wallHeight },
      })
      if (!result.ok) continue
      const { plan } = result
      const construction = resolveWallConstruction(nodes, levelId, plan.insertedWalls)
      const built = new Map(construction.walls.map((node) => [node.id, node]))
      applyNodeChanges({
        ...plan.changes,
        create: plan.changes.create.map((operation) => ({
          ...operation,
          node: built.get(operation.node.id as WallNode['id']) ?? operation.node,
        })),
      })
    }
  })

  return guide
}
