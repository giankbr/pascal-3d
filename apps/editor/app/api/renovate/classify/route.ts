import { type NextRequest, NextResponse } from 'next/server'
import { classifyPhotoKind } from '@/lib/classify-photo'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

  const record = body as { dataUrl?: unknown; fileName?: unknown }
  if (typeof record.dataUrl !== 'string' || !record.dataUrl.startsWith('data:')) {
    return NextResponse.json(
      { error: 'invalid_request', details: 'dataUrl must be a data URL image' },
      { status: 400 },
    )
  }

  try {
    const result = await classifyPhotoKind({
      dataUrl: record.dataUrl,
      fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unexpected_error'
    return NextResponse.json({ error: 'classify_failed', message }, { status: 500 })
  }
}
