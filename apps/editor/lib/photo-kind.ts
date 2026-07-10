export type PhotoKind = 'floorplan' | 'interior' | 'exterior' | 'reference' | 'other'

export const PHOTO_KIND_VALUES: PhotoKind[] = [
  'floorplan',
  'interior',
  'exterior',
  'reference',
  'other',
]

export const PHOTO_KIND_OPTIONS: Array<{ kind: PhotoKind; label: string }> = [
  { kind: 'floorplan', label: 'Floor plan' },
  { kind: 'interior', label: 'Interior' },
  { kind: 'exterior', label: 'Exterior' },
  { kind: 'reference', label: 'Reference' },
  { kind: 'other', label: 'Other' },
]

export function parsePhotoKind(raw: unknown): PhotoKind | null {
  if (typeof raw !== 'string') return null
  return PHOTO_KIND_VALUES.includes(raw as PhotoKind) ? (raw as PhotoKind) : null
}

/** Fast filename heuristic. Returns null when the name gives no useful signal. */
export function guessPhotoKindFromName(fileName: string): PhotoKind | null {
  const name = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '')

  if (
    /floor[\s_-]?plan|denah|blueprint|site[\s_-]?plan|layout[\s_-]?plan|plan[\s_-]?view|\bcad\b/.test(
      name,
    )
  ) {
    return 'floorplan'
  }

  if (
    /exterior|facade|fa[cç]ade|elevation|street[\s_-]?view|front[\s_-]?yard|back[\s_-]?yard|curb/.test(
      name,
    )
  ) {
    return 'exterior'
  }

  if (/reference|mood[\s_-]?board|inspo|inspiration|pinterest|style[\s_-]?ref|lookbook/.test(name)) {
    return 'reference'
  }

  if (
    /interior|living|kitchen|bedroom|bath|bathroom|dining|hallway|room|inside|lounge/.test(name)
  ) {
    return 'interior'
  }

  return null
}
