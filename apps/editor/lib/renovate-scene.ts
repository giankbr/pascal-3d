import type { AnyNode } from '@pascal-app/core/schema'

type MutableNodes = Record<string, AnyNode>

export type SceneChangeKind =
  | 'remove-wall'
  | 'add-wall'
  | 'move-item'
  | 'relabel-zone'
  | 'add-opening'
  | 'restyle'

export interface SceneRenovationChange {
  id: string
  kind: SceneChangeKind
  title: string
  description: string
}

export interface MutableGraph {
  nodes: MutableNodes
  rootNodeIds: string[]
  collections?: Record<string, unknown>
}

export interface PlanChangeTarget {
  wallId?: string
  itemId?: string
  zoneNames?: string[]
  newZoneName?: string
  openingType?: 'door' | 'window'
  start?: [number, number]
  end?: [number, number]
  merge?: boolean
}

export interface PlanChangeInput {
  kind: SceneChangeKind
  title: string
  description: string
  target?: PlanChangeTarget
}

export interface LiveRenovationPlan {
  changes: PlanChangeInput[]
  summary: string
}

type WallNode = AnyNode & {
  type: 'wall'
  id: string
  start: [number, number]
  end: [number, number]
  children?: string[]
  thickness?: number
  height?: number
  parentId?: string | null
}

type ZoneNode = AnyNode & {
  type: 'zone'
  id: string
  name: string
  polygon: [number, number][]
  color?: string
  parentId?: string | null
}

const WALL_HEIGHT = 2.5
const WALL_THICKNESS = 0.1
const EPS = 0.2

const RESTYLE_ZONE_COLORS = ['#f5f0e8', '#e8dcc8', '#d4c4a8', '#c4b59a', '#b8a88a']

export function cloneGraph(graph: MutableGraph): MutableGraph {
  return JSON.parse(JSON.stringify(graph))
}

export function getNode(graph: MutableGraph, id: string): AnyNode | undefined {
  return graph.nodes[id]
}

export function removeNode(graph: MutableGraph, id: string): void {
  const n = graph.nodes[id]
  if (!n) return
  const parent = n.parentId ? graph.nodes[n.parentId] : undefined
  if (parent && 'children' in parent && Array.isArray(parent.children)) {
    parent.children = (parent.children as string[]).filter((c) => c !== id)
  }
  delete graph.nodes[id]
}

export function removeNodeCascade(graph: MutableGraph, id: string): void {
  const n = graph.nodes[id]
  if (!n) return
  if ('children' in n && Array.isArray(n.children)) {
    for (const childId of [...(n.children as string[])]) {
      removeNodeCascade(graph, childId)
    }
  }
  removeNode(graph, id)
}

function listWalls(graph: MutableGraph): WallNode[] {
  return Object.values(graph.nodes).filter((n): n is WallNode => n?.type === 'wall')
}

function listZones(graph: MutableGraph): ZoneNode[] {
  return Object.values(graph.nodes).filter((n): n is ZoneNode => n?.type === 'zone')
}

function findLevel(graph: MutableGraph): AnyNode | undefined {
  return Object.values(graph.nodes).find((n) => n?.type === 'level')
}

function wallLength(wall: WallNode): number {
  const [x0, z0] = wall.start
  const [x1, z1] = wall.end
  return Math.hypot(x1 - x0, z1 - z0)
}

function wallMidpoint(wall: WallNode): [number, number] {
  return [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
}

function distPointToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [px, pz] = p
  const [ax, az] = a
  const [bx, bz] = b
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-9) return Math.hypot(px - ax, pz - az)
  let t = ((px - ax) * dx + (pz - az) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function sceneBounds(walls: WallNode[]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} | null {
  if (walls.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const w of walls) {
    minX = Math.min(minX, w.start[0], w.end[0])
    maxX = Math.max(maxX, w.start[0], w.end[0])
    minZ = Math.min(minZ, w.start[1], w.end[1])
    maxZ = Math.max(maxZ, w.start[1], w.end[1])
  }
  return { minX, maxX, minZ, maxZ }
}

function isPerimeterWall(wall: WallNode, bounds: NonNullable<ReturnType<typeof sceneBounds>>): boolean {
  const onEdge = (x: number, z: number) =>
    Math.abs(x - bounds.minX) < EPS ||
    Math.abs(x - bounds.maxX) < EPS ||
    Math.abs(z - bounds.minZ) < EPS ||
    Math.abs(z - bounds.maxZ) < EPS

  return onEdge(wall.start[0], wall.start[1]) && onEdge(wall.end[0], wall.end[1])
}

function zoneCentroid(zone: ZoneNode): [number, number] {
  const pts = zone.polygon
  if (!pts.length) return [0, 0]
  let sx = 0
  let sz = 0
  for (const p of pts) {
    sx += p[0] ?? 0
    sz += p[1] ?? 0
  }
  return [sx / pts.length, sz / pts.length]
}

function zonesAdjacentToWall(zones: ZoneNode[], wall: WallNode): ZoneNode[] {
  return zones.filter((zone) => {
    const c = zoneCentroid(zone)
    return distPointToSegment(c, wall.start, wall.end) < 3
  })
}

/** True when zone centroids sit on opposite sides of the wall line. */
function wallSeparatesZones(wall: WallNode, a: ZoneNode, b: ZoneNode): boolean {
  const [x0, z0] = wall.start
  const [x1, z1] = wall.end
  const side = (p: [number, number]) => (x1 - x0) * (p[1] - z0) - (z1 - z0) * (p[0] - x0)
  return side(zoneCentroid(a)) * side(zoneCentroid(b)) < 0
}

function meanDistToZones(wall: WallNode, zones: ZoneNode[]): number {
  if (zones.length === 0) return Infinity
  const total = zones.reduce(
    (sum, zone) => sum + distPointToSegment(zoneCentroid(zone), wall.start, wall.end),
    0,
  )
  return total / zones.length
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function textMentions(text: string, label: string): boolean {
  const t = normalizeLabel(text)
  const l = normalizeLabel(label)
  if (!l) return false
  if (t.includes(l)) return true
  const tokens = l.split(' ').filter((w) => w.length > 2)
  return tokens.length > 0 && tokens.every((tok) => t.includes(tok))
}

function findZonesByNames(zones: ZoneNode[], names: string[] | undefined, text: string): ZoneNode[] {
  if (names && names.length > 0) {
    const found = names
      .map((name) => zones.find((z) => normalizeLabel(z.name) === normalizeLabel(name)))
      .filter((z): z is ZoneNode => Boolean(z))
    if (found.length > 0) return found
  }
  return zones.filter((z) => textMentions(text, z.name))
}

function findWallById(walls: WallNode[], id?: string): WallNode | undefined {
  if (!id) return undefined
  return walls.find((w) => w.id === id)
}

function pickInteriorWall(
  graph: MutableGraph,
  change: PlanChangeInput,
  usedWallIds: Set<string>,
): WallNode | undefined {
  const walls = listWalls(graph)
  const zones = listZones(graph)
  const bounds = sceneBounds(walls)
  const text = `${change.title} ${change.description}`

  const byId = findWallById(walls, change.target?.wallId)
  if (byId && !usedWallIds.has(byId.id)) return byId

  const mentionedZones = findZonesByNames(zones, change.target?.zoneNames, text)
  const interior = walls
    .filter((w) => !usedWallIds.has(w.id))
    .filter((w) => (bounds ? !isPerimeterWall(w, bounds) : true))
    .sort((a, b) => wallLength(a) - wallLength(b))

  if (mentionedZones.length >= 2) {
    const a = mentionedZones[0]
    const b = mentionedZones[1]
    if (!a || !b) return interior[0]
    let best: WallNode | undefined
    let bestScore = -Infinity
    for (const wall of interior) {
      const separates = wallSeparatesZones(wall, a, b)
      const near = meanDistToZones(wall, mentionedZones)
      // Prefer walls that actually split the named rooms, then closeness, then shorter spans.
      const score = (separates ? 100 : 0) - near * 10 - wallLength(wall)
      if (score > bestScore) {
        bestScore = score
        best = wall
      }
    }
    if (best) return best
  }

  if (mentionedZones.length === 1) {
    const zone = mentionedZones[0]
    if (!zone) return interior[0]
    const near = interior
      .map((wall) => ({
        wall,
        d: distPointToSegment(zoneCentroid(zone), wall.start, wall.end),
      }))
      .sort((left, right) => left.d - right.d)
    if (near[0] && near[0].d < 4) return near[0].wall
  }

  return interior[0]
}

function polygonBounds(polygons: number[][][]): [number, number][] {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const poly of polygons) {
    for (const p of poly) {
      const x = p[0] ?? 0
      const z = p[1] ?? 0
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
  }
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function mergeZones(
  graph: MutableGraph,
  keep: ZoneNode,
  drop: ZoneNode[],
  newName?: string,
): void {
  const polys = [keep.polygon, ...drop.map((z) => z.polygon)]
  keep.polygon = polygonBounds(polys)
  if (newName) keep.name = newName
  for (const z of drop) {
    removeNode(graph, z.id)
  }
}

function extractNewZoneName(change: PlanChangeInput): string | undefined {
  if (change.target?.newZoneName) return change.target.newZoneName
  const arrow = /→\s*["']?([^"'\n]+?)["']?\s*$/u.exec(change.title)
  if (arrow?.[1]) return arrow[1].trim()
  const quoted = /["']([^"']+)["']/.exec(change.title)
  if (quoted?.[1]) return quoted[1].trim()
  if (change.kind === 'relabel-zone' && change.title && !/merge/i.test(change.title)) {
    return change.title.trim()
  }
  return undefined
}

function applyRemoveWall(
  graph: MutableGraph,
  change: PlanChangeInput,
  usedWallIds: Set<string>,
): boolean {
  const wall = pickInteriorWall(graph, change, usedWallIds)
  if (!wall) return false

  const zones = listZones(graph)
  const text = `${change.title} ${change.description}`
  const mentioned = findZonesByNames(zones, change.target?.zoneNames, text)
  const adjacent = mentioned.length >= 2 ? mentioned : zonesAdjacentToWall(zones, wall)
  const shouldMerge = change.target?.merge !== false && adjacent.length >= 2

  usedWallIds.add(wall.id)
  removeNodeCascade(graph, wall.id)

  if (shouldMerge) {
    const keep = adjacent[0]
    if (!keep) return true
    mergeZones(graph, keep, adjacent.slice(1), extractNewZoneName(change))
  }

  return true
}

function applyAddWall(graph: MutableGraph, change: PlanChangeInput): boolean {
  const level = findLevel(graph)
  if (!level) return false
  const levelId = level.id as string

  let start = change.target?.start
  let end = change.target?.end

  if (!start || !end) {
    const zones = listZones(graph)
    const largest = [...zones].sort((a, b) => {
      const area = (z: ZoneNode) => {
        const xs = z.polygon.map((p) => p[0] ?? 0)
        const zs = z.polygon.map((p) => p[1] ?? 0)
        return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
      }
      return area(b) - area(a)
    })[0]
    if (!largest) return false
    const xs = largest.polygon.map((p) => p[0] ?? 0)
    const zs = largest.polygon.map((p) => p[1] ?? 0)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    const midX = (minX + maxX) / 2
    // Prefer a north-south partition through the largest room.
    start = [midX, minZ]
    end = [midX, maxZ]
  }

  const id = `wall_reno_${Object.keys(graph.nodes).length}`
  const wallNode = {
    object: 'node',
    id,
    type: 'wall',
    parentId: levelId,
    visible: true,
    metadata: {},
    children: [],
    thickness: WALL_THICKNESS,
    height: WALL_HEIGHT,
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as AnyNode

  graph.nodes[id] = wallNode
  if ('children' in level && Array.isArray(level.children)) {
    ;(level.children as string[]).push(id)
  }
  return true
}

function cardinalFromText(text: string): 'n' | 'e' | 's' | 'w' | undefined {
  const t = text.toLowerCase()
  if (/\bsouth\b|\bsouthern\b/.test(t)) return 's'
  if (/\bnorth\b|\bnorthern\b/.test(t)) return 'n'
  if (/\beast\b|\beastern\b/.test(t)) return 'e'
  if (/\bwest\b|\bwestern\b/.test(t)) return 'w'
  return undefined
}

function wallCardinal(
  wall: WallNode,
  bounds: NonNullable<ReturnType<typeof sceneBounds>>,
): 'n' | 'e' | 's' | 'w' | undefined {
  const [mx, mz] = wallMidpoint(wall)
  const scores: Array<{ k: 'n' | 'e' | 's' | 'w'; d: number }> = [
    { k: 'n', d: Math.abs(mz - bounds.minZ) },
    { k: 's', d: Math.abs(mz - bounds.maxZ) },
    { k: 'w', d: Math.abs(mx - bounds.minX) },
    { k: 'e', d: Math.abs(mx - bounds.maxX) },
  ]
  scores.sort((a, b) => a.d - b.d)
  return scores[0] && scores[0].d < EPS * 2 ? scores[0].k : undefined
}

function makeDoor(id: string, parentWallId: string): AnyNode {
  return {
    object: 'node',
    id,
    type: 'door',
    parentId: parentWallId,
    visible: true,
    metadata: {},
    wallId: parentWallId,
    position: [0, 1.05, 0],
    rotation: [0, 0, 0],
    width: 0.9,
    height: 2.1,
    frameThickness: 0.05,
    frameDepth: 0.07,
    threshold: true,
    thresholdHeight: 0.02,
    hingesSide: 'left',
    swingDirection: 'inward',
    segments: [
      {
        type: 'panel',
        heightRatio: 1,
        columnRatios: [1],
        dividerThickness: 0.03,
        panelDepth: 0.01,
        panelInset: 0.04,
      },
    ],
    handle: true,
    handleHeight: 1.05,
    handleSide: 'right',
    contentPadding: [0.04, 0.04],
    doorCloser: false,
    panicBar: false,
    panicBarHeight: 1.0,
  } as unknown as AnyNode
}

function makeWindow(id: string, parentWallId: string, width = 1.2): AnyNode {
  return {
    object: 'node',
    id,
    type: 'window',
    parentId: parentWallId,
    visible: true,
    metadata: {},
    wallId: parentWallId,
    position: [0, 1.2, 0],
    rotation: [0, 0, 0],
    width,
    height: 1.2,
    frameThickness: 0.05,
    frameDepth: 0.07,
    columnRatios: [1],
    rowRatios: [1],
    columnDividerThickness: 0.03,
    rowDividerThickness: 0.03,
    sill: true,
    sillDepth: 0.08,
    sillThickness: 0.03,
  } as unknown as AnyNode
}

function applyAddOpening(graph: MutableGraph, change: PlanChangeInput): boolean {
  const walls = listWalls(graph)
  const bounds = sceneBounds(walls)
  if (!bounds) return false
  const text = `${change.title} ${change.description}`
  const want =
    change.target?.openingType ??
    (/\bdoor\b|\bopening\b|\bpassage\b/i.test(text) && !/\bwindow\b/i.test(text)
      ? 'door'
      : 'window')

  let wall = findWallById(walls, change.target?.wallId)
  if (!wall) {
    const card = cardinalFromText(text)
    const perimeter = walls.filter((w) => isPerimeterWall(w, bounds))
    if (card) {
      wall = perimeter.find((w) => wallCardinal(w, bounds) === card)
    }
    if (!wall) {
      wall = [...perimeter].sort((a, b) => wallLength(b) - wallLength(a))[0]
    }
  }
  if (!wall) return false

  const id = `${want}_reno_${Object.keys(graph.nodes).length}`
  const node = want === 'door' ? makeDoor(id, wall.id) : makeWindow(id, wall.id)
  graph.nodes[id] = node
  if (!wall.children) wall.children = []
  wall.children.push(id)
  return true
}

function applyRelabelZone(graph: MutableGraph, change: PlanChangeInput): boolean {
  const zones = listZones(graph)
  if (zones.length === 0) return false
  const text = `${change.title} ${change.description}`
  const newName = extractNewZoneName(change) ?? change.title
  const mentioned = findZonesByNames(zones, change.target?.zoneNames, text)
  const shouldMerge = change.target?.merge === true || /merge/i.test(text)

  if (shouldMerge && mentioned.length >= 2) {
    const keep = mentioned[0]
    if (!keep) return false
    mergeZones(graph, keep, mentioned.slice(1), newName)
    return true
  }

  const target = mentioned[0] ?? zones[0]
  if (!target) return false
  target.name = newName
  return true
}

function applyRestyle(graph: MutableGraph): boolean {
  const zones = listZones(graph)
  if (zones.length === 0) return false
  zones.forEach((zone, i) => {
    zone.color = RESTYLE_ZONE_COLORS[i % RESTYLE_ZONE_COLORS.length] ?? '#e8dcc8'
  })
  return true
}

function applyMoveItem(graph: MutableGraph, change: PlanChangeInput): boolean {
  if (change.target?.itemId && graph.nodes[change.target.itemId]) {
    removeNodeCascade(graph, change.target.itemId)
    return true
  }
  if (change.target?.wallId && graph.nodes[change.target.wallId]) {
    // Allow callers to pass a door/window id via wallId for convenience.
    const node = graph.nodes[change.target.wallId]
    if (node?.type === 'door' || node?.type === 'window' || node?.type === 'item') {
      removeNodeCascade(graph, change.target.wallId)
      return true
    }
  }

  const text = `${change.title} ${change.description}`
  const candidates = Object.values(graph.nodes).filter(
    (n) => n?.type === 'door' || n?.type === 'window' || n?.type === 'item',
  )
  const hit = candidates.find((n) => textMentions(text, n.id) || textMentions(text, (n as { name?: string }).name ?? ''))
  if (hit) {
    removeNodeCascade(graph, hit.id as string)
    return true
  }

  // Fallback: remove an interior door when the change sounds like a removal.
  if (/\bremove\b|\bdelete\b|\bdrop\b/i.test(text)) {
    const door = candidates.find((n) => n?.type === 'door')
    if (door) {
      removeNodeCascade(graph, door.id as string)
      return true
    }
  }

  return false
}

/**
 * Apply a renovation plan onto a cloned scene graph.
 * Mutates structural nodes (walls, zones, openings) so live mode produces a visible before/after.
 */
export function applyPlanToScene(
  before: MutableGraph,
  plan: LiveRenovationPlan,
): { after: MutableGraph; changes: SceneRenovationChange[] } {
  const after = cloneGraph(before)
  const changes: SceneRenovationChange[] = plan.changes.map((c, i) => ({
    id: `chg-${i + 1}`,
    kind: c.kind,
    title: c.title,
    description: c.description,
  }))

  const usedWallIds = new Set<string>()

  plan.changes.forEach((change, i) => {
    let applied = false
    switch (change.kind) {
      case 'remove-wall':
        applied = applyRemoveWall(after, change, usedWallIds)
        break
      case 'add-wall':
        applied = applyAddWall(after, change)
        break
      case 'add-opening':
        applied = applyAddOpening(after, change)
        break
      case 'relabel-zone':
        applied = applyRelabelZone(after, change)
        break
      case 'restyle':
        applied = applyRestyle(after)
        break
      case 'move-item':
        applied = applyMoveItem(after, change)
        break
      default:
        applied = false
    }

    if (!applied && changes[i]) {
      changes[i] = {
        ...changes[i],
        description: `${changes[i].description} (no matching scene target; left as proposal note)`,
      }
    }
  })

  return { after, changes }
}
