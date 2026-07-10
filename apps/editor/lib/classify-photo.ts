import { completeVision, resolveProvider } from './renovate-llm'
import { guessPhotoKindFromName, parsePhotoKind, type PhotoKind } from './photo-kind'

const CLASSIFY_PROMPT = `Classify this image for a home renovation app. Return ONLY valid JSON:
{ "kind": "floorplan" | "interior" | "exterior" | "reference" | "other" }

Rules:
- floorplan: top-down architectural plan, blueprint, CAD/layout drawing, measured floor plan
- interior: photograph of a room or space inside a building
- exterior: photograph of a building outside, facade, elevation, yard, or street view
- reference: style inspiration, mood board, catalog/furniture shot that is not the user's actual space
- other: anything that does not fit the above`

function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = (fence?.[1] ? fence[1] : text).trim()
  return JSON.parse(raw)
}

export async function classifyPhotoKind(args: {
  dataUrl: string
  fileName?: string
}): Promise<{ kind: PhotoKind; source: 'vision' | 'filename' | 'default' }> {
  const fromName = args.fileName ? guessPhotoKindFromName(args.fileName) : null
  const provider = resolveProvider()

  if (provider && args.dataUrl.startsWith('data:')) {
    try {
      const text = await completeVision(provider, {
        prompt: CLASSIFY_PROMPT,
        images: [{ dataUrl: args.dataUrl }],
        maxTokens: 64,
      })
      const parsed = extractJson(text) as { kind?: unknown }
      const kind = parsePhotoKind(parsed.kind)
      if (kind) return { kind, source: 'vision' }
    } catch {
      // Fall through to filename / default.
    }
  }

  if (fromName) return { kind: fromName, source: 'filename' }
  return { kind: 'interior', source: 'default' }
}
