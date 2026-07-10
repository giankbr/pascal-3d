import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode } from '@pascal-app/core/schema'
import { TEMPLATES } from '@pascal-app/mcp/templates'
import type { PhotoKind } from './photo-kind'
import {
  completeVision,
  providerLabel,
  type RenovateProvider,
  resolveProvider,
} from './renovate-llm'
import {
  applyPlanToScene,
  cloneGraph,
  getNode,
  type LiveRenovationPlan,
  type MutableGraph,
  type PlanChangeTarget,
  removeNodeCascade,
} from './renovate-scene'

export type { PlanChangeTarget, PhotoKind }

export interface RenovationImage {
  dataUrl: string
  kind: PhotoKind
}

export interface RenovationInput {
  floorplan?: string
  photos: string[]
  reference: string[]
  goals: string
  images?: RenovationImage[]
}

export type ChangeKind =
  | 'remove-wall'
  | 'add-wall'
  | 'move-item'
  | 'relabel-zone'
  | 'add-opening'
  | 'restyle'

export interface RenovationChange {
  id: string
  kind: ChangeKind
  title: string
  description: string
  target?: PlanChangeTarget
}

export interface RenovationResult {
  before: SceneGraph
  after: SceneGraph
  changes: RenovationChange[]
  summary: string
  mode: 'demo' | 'live'
  provider?: RenovateProvider
  analysis?: string
}

const WALL_HEIGHT = 2.5
const WALL_THICKNESS = 0.1

function toSceneGraph(graph: MutableGraph): SceneGraph {
  return graph as unknown as SceneGraph
}

function buildDemoBefore(): MutableGraph {
  return cloneGraph(TEMPLATES['two-bedroom'].template as unknown as MutableGraph)
}

function buildDemoAfter(): { after: MutableGraph; changes: RenovationChange[] } {
  const before = buildDemoBefore()
  const { after, changes } = applyPlanToScene(before, {
    summary: '',
    changes: [
      {
        kind: 'remove-wall',
        title: 'Remove partition: Bedroom 1 ↔ Bath',
        description:
          'Load-bearing check passed. Removing the 4 m partition between Bedroom 1 and the Bath to create a single larger space.',
        target: {
          wallId: 'wall_part_1',
          zoneNames: ['Bedroom 1', 'Bath'],
          newZoneName: 'Master Suite',
          merge: true,
        },
      },
      {
        kind: 'relabel-zone',
        title: 'Merge zones → "Master Suite"',
        description:
          'Combined Bedroom 1 and Bath footprints into a single 28 m² Master Suite zone. En-suite layout to be detailed in a follow-up.',
        target: {
          zoneNames: ['Master Suite'],
          newZoneName: 'Master Suite',
        },
      },
      {
        kind: 'move-item',
        title: 'Remove bath door',
        description:
          'The bath partition is gone, so the interior bath door is removed. The Master Suite becomes one open space.',
        target: { itemId: 'door_bath' },
      },
      {
        kind: 'restyle',
        title: 'Apply warm-neutral material palette',
        description:
          'Walls → warm white (RAL 9001), flooring → natural oak planks, accents → brushed brass. Matches the reference image.',
      },
    ],
  })

  const suite = getNode(after, 'zone_bed1')
  if (suite) (suite as { color: string }).color = '#8b5cf6'

  return { after, changes: changes as RenovationChange[] }
}

function buildDemoSummary(changes: RenovationChange[]): string {
  const area = 28
  return [
    `Proposed ${changes.length} changes. `,
    `Net effect: a ${area} m² Master Suite replaces the separate Bedroom 1 + Bath.`,
    ' Open-plan feel preserved in the living wing. No structural perimeter changes.',
  ].join('')
}

interface FloorplanAnalysis {
  walls: Array<{ start: [number, number]; end: [number, number]; thickness?: number }>
  rooms: Array<{ label: string; polygon: number[][] }>
  approximateDimensions?: { widthMeters?: number; depthMeters?: number }
}

interface SpacePhotoAnalysis {
  kind: 'interior' | 'exterior' | 'other'
  roomLabel?: string
  approximateDimensions?: { widthMeters?: number; depthMeters?: number; heightMeters?: number }
  identifiedFixtures?: Array<{ kind: string; approximatePosition?: [number, number] }>
  identifiedWindows?: Array<{
    wallHint?: string
    approximateWidth?: number
    approximateHeight?: number
  }>
  styleNotes?: string
}

interface RenovationContext {
  floorplan: FloorplanAnalysis
  spacePhotos: SpacePhotoAnalysis[]
}

function buildSceneFromAnalysis(analysis: FloorplanAnalysis): MutableGraph {
  const graph = cloneGraph(TEMPLATES['two-bedroom'].template as unknown as MutableGraph)
  for (const id of Object.keys(graph.nodes)) {
    if (
      graph.nodes[id]?.type === 'wall' ||
      graph.nodes[id]?.type === 'zone' ||
      graph.nodes[id]?.type === 'door' ||
      graph.nodes[id]?.type === 'window'
    ) {
      removeNodeCascade(graph, id)
    }
  }
  const level = Object.values(graph.nodes).find((n) => n?.type === 'level')
  if (!level) return graph
  const levelId = level.id as string
  const levelNode = graph.nodes[levelId]
  if (levelNode) {
    ;(levelNode as { children: string[] }).children = []
  }

  let wallIdx = 0
  for (const w of analysis.walls) {
    const id = `wall_live_${wallIdx++}`
    const wallNode = {
      object: 'node',
      id,
      type: 'wall',
      parentId: levelId,
      visible: true,
      metadata: {},
      children: [],
      thickness: w.thickness ?? WALL_THICKNESS,
      height: WALL_HEIGHT,
      start: w.start,
      end: w.end,
      frontSide: 'unknown',
      backSide: 'unknown',
    } as unknown as AnyNode
    graph.nodes[id] = wallNode
    ;(levelNode as { children: string[] }).children.push(id)
  }

  let zoneIdx = 0
  for (const r of analysis.rooms) {
    const id = `zone_live_${zoneIdx++}`
    const zoneNode = {
      object: 'node',
      id,
      type: 'zone',
      parentId: levelId,
      visible: true,
      metadata: {},
      name: r.label,
      color: '#60a5fa',
      polygon: r.polygon,
    } as unknown as AnyNode
    graph.nodes[id] = zoneNode
    ;(levelNode as { children: string[] }).children.push(id)
  }

  return graph
}

const FLOORPLAN_PROMPT = `You are a floorplan analysis assistant. Analyze the floorplan image and extract:
- walls: array of { start: [x,z], end: [x,z], thickness } in METERS, origin at a sensible corner
- rooms: array of { label, polygon: [[x,z],...] }
- approximateDimensions: { widthMeters, depthMeters }

Return ONLY valid JSON matching this shape. Estimate scale from door swings (~0.9m) or grid lines if present. Right-handed coords, XZ ground plane.`

const SPACE_PHOTO_PROMPT = `You analyze photos of buildings and rooms for renovation planning. Classify the image and extract useful spatial cues.

Return ONLY valid JSON:
{
  "kind": "interior" | "exterior" | "other",
  "roomLabel": "short label like Living room or House front",
  "approximateDimensions": { "widthMeters": number, "depthMeters": number, "heightMeters": number },
  "identifiedFixtures": [{ "kind": "sofa|kitchen-island|bed|...", "approximatePosition": [x,z] }],
  "identifiedWindows": [{ "wallHint": "south|north|...", "approximateWidth": number, "approximateHeight": number }],
  "styleNotes": "materials, palette, layout notes visible in the photo"
}

Use meters. If unsure, give conservative estimates and say so in styleNotes. XZ ground plane for positions.`

const RENOVATION_PROMPT = `You are a renovation planner. Given the user's goals, any floorplan analysis, and notes from their space/reference photos, propose minimal structural and layout changes that can be applied to a 3D scene graph.

Respond with ONLY a JSON object:
{
  "changes": [
    {
      "kind": "remove-wall" | "add-wall" | "relabel-zone" | "add-opening" | "restyle" | "move-item",
      "title": "short label",
      "description": "one-sentence rationale tied to the goals",
      "target": {
        "wallId": "optional exact wall id if known from the scene",
        "itemId": "optional door/window/item id to remove for move-item",
        "zoneNames": ["exact room labels from the floorplan analysis when relevant"],
        "newZoneName": "name after merge or relabel",
        "merge": true,
        "openingType": "door" | "window",
        "start": [x, z],
        "end": [x, z]
      }
    }
  ],
  "summary": "2-3 sentence overview of the renovation intent"
}

Rules:
- Prefer remove-wall on interior partitions (never demolish the whole perimeter).
- When opening two rooms into one, use remove-wall with zoneNames of both rooms, merge: true, and newZoneName.
- Use add-opening for new doors/windows; set openingType and mention north/south/east/west in the title when possible.
- Use add-wall only when splitting a room; include start/end in meters on the XZ plane when you can estimate them.
- Keep changes minimal and aligned with the stated goals and photo evidence.
- Always include a target object (it may be empty {}).`

async function analyzeFloorplanLive(
  provider: RenovateProvider,
  image: string,
): Promise<FloorplanAnalysis> {
  const text = await completeVision(provider, {
    prompt: FLOORPLAN_PROMPT,
    images: image.startsWith('data:') ? [{ dataUrl: image }] : [],
    maxTokens: 2048,
  })
  const parsed = extractJson(text) as FloorplanAnalysis
  if (!parsed.walls) throw new Error('floorplan analysis returned no walls')
  return parsed
}

async function analyzeSpacePhotoLive(
  provider: RenovateProvider,
  image: string,
): Promise<SpacePhotoAnalysis> {
  const text = await completeVision(provider, {
    prompt: SPACE_PHOTO_PROMPT,
    images: image.startsWith('data:') ? [{ dataUrl: image }] : [],
    maxTokens: 1536,
  })
  return extractJson(text) as SpacePhotoAnalysis
}

async function proposeRenovationLive(
  provider: RenovateProvider,
  args: {
    context: RenovationContext
    reference: string[]
    spacePhotos: string[]
    goals: string
    sceneWallIds: string[]
    sceneZoneNames: string[]
  },
): Promise<LiveRenovationPlan> {
  const prompt = [
    RENOVATION_PROMPT,
    '',
    '## Goals',
    args.goals,
    '',
    '## Scene wall ids',
    args.sceneWallIds.join(', ') || '(none)',
    '',
    '## Scene zone names',
    args.sceneZoneNames.join(', ') || '(none)',
    '',
    '## Floorplan analysis',
    '```json',
    JSON.stringify(args.context.floorplan, null, 2),
    '```',
    '',
    '## Space photo analysis',
    '```json',
    JSON.stringify(args.context.spacePhotos, null, 2),
    '```',
  ].join('\n')

  const images = [...args.spacePhotos, ...args.reference]
    .filter((photo) => photo.startsWith('data:'))
    .map((dataUrl) => ({ dataUrl }))

  const text = await completeVision(provider, {
    prompt,
    images,
    maxTokens: 2048,
  })
  const parsed = extractJson(text) as LiveRenovationPlan
  if (!parsed.changes) throw new Error('renovation plan returned no changes')
  return parsed
}

function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = (fence?.[1] ? fence[1] : text).trim()
  return JSON.parse(raw)
}

function normalizeInput(input: RenovationInput): {
  floorplan?: string
  spacePhotos: string[]
  reference: string[]
  goals: string
} {
  if (input.images && input.images.length > 0) {
    const floorplan = input.images.find((img) => img.kind === 'floorplan')?.dataUrl
    const spacePhotos = input.images
      .filter((img) => img.kind === 'interior' || img.kind === 'exterior' || img.kind === 'other')
      .map((img) => img.dataUrl)
    const reference = input.images
      .filter((img) => img.kind === 'reference')
      .map((img) => img.dataUrl)
    return {
      floorplan: floorplan ?? input.floorplan,
      spacePhotos: spacePhotos.length > 0 ? spacePhotos : input.photos,
      reference: reference.length > 0 ? reference : input.reference,
      goals: input.goals,
    }
  }

  return {
    floorplan: input.floorplan,
    spacePhotos: input.photos,
    reference: input.reference,
    goals: input.goals,
  }
}

function sceneCatalog(graph: MutableGraph): { wallIds: string[]; zoneNames: string[] } {
  const wallIds: string[] = []
  const zoneNames: string[] = []
  for (const node of Object.values(graph.nodes)) {
    if (node?.type === 'wall') wallIds.push(node.id as string)
    if (node?.type === 'zone') zoneNames.push((node as { name: string }).name)
  }
  return { wallIds, zoneNames }
}

export async function runRenovation(input: RenovationInput): Promise<RenovationResult> {
  const normalized = normalizeInput(input)
  const hasImages =
    Boolean(normalized.floorplan) ||
    normalized.spacePhotos.length > 0 ||
    normalized.reference.length > 0
  const hasGoals = normalized.goals.trim().length > 0
  const provider = resolveProvider()

  if (!provider || (!hasImages && !hasGoals)) {
    const before = buildDemoBefore()
    const { after, changes } = buildDemoAfter()
    return {
      before: toSceneGraph(before),
      after: toSceneGraph(after),
      changes,
      summary: buildDemoSummary(changes),
      mode: 'demo',
      analysis:
        'Demo mode (no AI provider key, and no photos or goals). Showing a sample renovation on the built-in two-bedroom template: merge Bedroom 1 + Bath into a Master Suite.',
    }
  }

  let floorplanAnalysis: FloorplanAnalysis = { walls: [], rooms: [] }
  if (normalized.floorplan) {
    floorplanAnalysis = await analyzeFloorplanLive(provider, normalized.floorplan)
  }

  const spacePhotoAnalysis: SpacePhotoAnalysis[] = []
  for (const photo of normalized.spacePhotos.slice(0, 6)) {
    spacePhotoAnalysis.push(await analyzeSpacePhotoLive(provider, photo))
  }

  let before: MutableGraph
  if (floorplanAnalysis.walls.length > 0) {
    before = buildSceneFromAnalysis(floorplanAnalysis)
  } else {
    before = buildDemoBefore()
  }

  const catalog = sceneCatalog(before)
  const plan = await proposeRenovationLive(provider, {
    context: { floorplan: floorplanAnalysis, spacePhotos: spacePhotoAnalysis },
    reference: normalized.reference,
    spacePhotos: normalized.spacePhotos,
    goals: normalized.goals || 'Open up the space, more natural light, modern minimal aesthetic.',
    sceneWallIds: catalog.wallIds,
    sceneZoneNames: catalog.zoneNames,
  })

  const { after, changes } = applyPlanToScene(before, plan)

  const parts: string[] = []
  if (floorplanAnalysis.walls.length > 0) {
    parts.push(
      `${floorplanAnalysis.walls.length} walls and ${floorplanAnalysis.rooms.length} rooms from floor plan`,
    )
  }
  if (spacePhotoAnalysis.length > 0) {
    parts.push(`${spacePhotoAnalysis.length} space photo(s)`)
  }
  if (normalized.reference.length > 0) {
    parts.push(`${normalized.reference.length} reference photo(s)`)
  }
  if (!hasImages && hasGoals) {
    parts.push('goals prompt only (sample flat as base)')
  }

  return {
    before: toSceneGraph(before),
    after: toSceneGraph(after),
    changes: changes as RenovationChange[],
    summary: plan.summary,
    mode: 'live',
    provider,
    analysis:
      parts.length > 0
        ? `Analyzed with ${providerLabel(provider)}: ${parts.join(', ')}.`
        : `Analyzed with ${providerLabel(provider)} to propose a renovation plan.`,
  }
}
