import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode } from '@pascal-app/core/schema'
import { TEMPLATES } from '@pascal-app/mcp/templates'
import {
  completeVision,
  providerLabel,
  type RenovateProvider,
  resolveProvider,
} from './renovate-llm'

type MutableNodes = Record<string, AnyNode>
interface MutableGraph {
  nodes: MutableNodes
  rootNodeIds: string[]
  collections?: Record<string, unknown>
}

export type PhotoKind = 'floorplan' | 'interior' | 'exterior' | 'reference' | 'other'

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

function cloneGraph(graph: SceneGraph | MutableGraph): MutableGraph {
  return JSON.parse(JSON.stringify(graph))
}

function toSceneGraph(graph: MutableGraph): SceneGraph {
  return graph as unknown as SceneGraph
}

function getNode(graph: MutableGraph, id: string): AnyNode | undefined {
  return graph.nodes[id]
}

function removeNode(graph: MutableGraph, id: string): void {
  const n = graph.nodes[id]
  if (!n) return
  const parent = n.parentId ? graph.nodes[n.parentId] : undefined
  if (parent && 'children' in parent && Array.isArray(parent.children)) {
    parent.children = (parent.children as string[]).filter((c) => c !== id)
  }
  delete graph.nodes[id]
}

function buildDemoBefore(): MutableGraph {
  return cloneGraph(TEMPLATES['two-bedroom'].template)
}

function buildDemoAfter(): { after: MutableGraph; changes: RenovationChange[] } {
  const after = buildDemoBefore()
  const changes: RenovationChange[] = []

  removeNode(after, 'wall_part_1')
  changes.push({
    id: 'chg-1',
    kind: 'remove-wall',
    title: 'Remove partition: Bedroom 1 ↔ Bath',
    description:
      'Load-bearing check passed. Removing the 4 m partition between Bedroom 1 and the Bath to create a single larger space.',
  })

  const bed1 = getNode(after, 'zone_bed1')
  if (bed1) {
    ;(bed1 as { name: string }).name = 'Master Suite'
    ;(bed1 as { polygon: number[][] }).polygon = [
      [-5, -4],
      [2, -4],
      [2, 0],
      [-5, 0],
    ]
    ;(bed1 as { color: string }).color = '#8b5cf6'
    removeNode(after, 'zone_bath')
    changes.push({
      id: 'chg-2',
      kind: 'relabel-zone',
      title: 'Merge zones → "Master Suite"',
      description:
        'Combined Bedroom 1 and Bath footprints into a single 28 m² Master Suite zone. En-suite layout to be detailed in a follow-up.',
    })
  }

  const doorBath = getNode(after, 'door_bath')
  if (doorBath) {
    removeNode(after, 'door_bath')
    changes.push({
      id: 'chg-3',
      kind: 'move-item',
      title: 'Remove bath door',
      description:
        'The bath partition is gone, so the interior bath door is removed. The Master Suite becomes one open space.',
    })
  }

  changes.push({
    id: 'chg-4',
    kind: 'restyle',
    title: 'Apply warm-neutral material palette',
    description:
      'Walls → warm white (RAL 9001), flooring → natural oak planks, accents → brushed brass. Matches the reference image.',
  })

  return { after, changes }
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
  identifiedWindows?: Array<{ wallHint?: string; approximateWidth?: number; approximateHeight?: number }>
  styleNotes?: string
}

interface RenovationContext {
  floorplan: FloorplanAnalysis
  spacePhotos: SpacePhotoAnalysis[]
}

function buildSceneFromAnalysis(analysis: FloorplanAnalysis): MutableGraph {
  const graph = cloneGraph(TEMPLATES['two-bedroom'].template)
  for (const id of Object.keys(graph.nodes)) {
    if (
      graph.nodes[id]?.type === 'wall' ||
      graph.nodes[id]?.type === 'zone' ||
      graph.nodes[id]?.type === 'door' ||
      graph.nodes[id]?.type === 'window'
    ) {
      removeNode(graph, id)
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

const RENOVATION_PROMPT = `You are a renovation planner. Given the user's goals, any floorplan analysis, and notes from their space/reference photos, propose minimal structural and layout changes.

Respond with ONLY a JSON object:
{
  "changes": [
    {
      "kind": "remove-wall" | "add-wall" | "relabel-zone" | "add-opening" | "restyle",
      "title": "short label",
      "description": "one-sentence rationale tied to the goals"
    }
  ],
  "summary": "2-3 sentence overview of the renovation intent"
}
Do NOT invent precise dimensions. Keep changes minimal and aligned with the stated goals and photo evidence.`

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

interface LiveRenovationPlan {
  changes: Array<Omit<RenovationChange, 'id'>>
  summary: string
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
  },
): Promise<LiveRenovationPlan> {
  const prompt = [
    RENOVATION_PROMPT,
    '',
    '## Goals',
    args.goals,
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
    const reference = input.images.filter((img) => img.kind === 'reference').map((img) => img.dataUrl)
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

  const plan = await proposeRenovationLive(provider, {
    context: { floorplan: floorplanAnalysis, spacePhotos: spacePhotoAnalysis },
    reference: normalized.reference,
    spacePhotos: normalized.spacePhotos,
    goals: normalized.goals || 'Open up the space, more natural light, modern minimal aesthetic.',
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
    changes,
    summary: plan.summary,
    mode: 'live',
    provider,
    analysis:
      parts.length > 0
        ? `Analyzed with ${providerLabel(provider)}: ${parts.join(', ')}.`
        : `Analyzed with ${providerLabel(provider)} to propose a renovation plan.`,
  }
}

function applyPlanToScene(
  before: MutableGraph,
  plan: LiveRenovationPlan,
): { after: MutableGraph; changes: RenovationChange[] } {
  const after = cloneGraph(before)
  const changes: RenovationChange[] = plan.changes.map((c, i) => ({
    id: `chg-${i + 1}`,
    ...c,
  }))

  let zoneIdx = 0
  for (const c of changes) {
    if (c.kind === 'relabel-zone') {
      const zones = Object.values(after.nodes).filter((n) => n?.type === 'zone')
      const target = zones[zoneIdx % Math.max(1, zones.length)]
      if (target) (target as { name: string }).name = c.title
      zoneIdx++
    }
  }
  return { after, changes }
}
