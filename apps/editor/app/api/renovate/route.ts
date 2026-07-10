import { type NextRequest, NextResponse } from 'next/server'
import { PHOTO_KIND_VALUES, type PhotoKind } from '@/lib/photo-kind'
import {
  runRenovation,
  type RenovationImage,
  type RenovationInput,
} from '@/lib/renovate-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function parseImages(raw: unknown): RenovationImage[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const images: RenovationImage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as { dataUrl?: unknown; kind?: unknown }
    if (typeof record.dataUrl !== 'string') continue
    const kind = PHOTO_KIND_VALUES.includes(record.kind as PhotoKind)
      ? (record.kind as PhotoKind)
      : 'interior'
    images.push({ dataUrl: record.dataUrl, kind })
  }
  return images.length > 0 ? images : undefined
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const input = body as Partial<RenovationInput>
  const images = parseImages(input.images)
  const payload: RenovationInput = {
    floorplan: typeof input.floorplan === 'string' ? input.floorplan : undefined,
    photos: Array.isArray(input.photos) ? input.photos.filter((p) => typeof p === 'string') : [],
    reference: Array.isArray(input.reference)
      ? input.reference.filter((p) => typeof p === 'string')
      : [],
    goals: typeof input.goals === 'string' ? input.goals : '',
    images,
  }

  const hasImages =
    Boolean(payload.images?.length) ||
    Boolean(payload.floorplan) ||
    payload.photos.length > 0 ||
    payload.reference.length > 0

  if (!hasImages && payload.goals.trim().length === 0) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        details: 'provide at least one photo or a goal description',
      },
      { status: 400 },
    )
  }

  try {
    const result = await runRenovation(payload)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unexpected_error'
    return NextResponse.json({ error: 'renovation_failed', message }, { status: 500 })
  }
}
