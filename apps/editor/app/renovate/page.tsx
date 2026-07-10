'use client'

import { Icon } from '@iconify/react'
import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/selia/alert'
import { Button } from '@/components/selia/button'
import { Card, CardBody } from '@/components/selia/card'
import { Textarea } from '@/components/selia/textarea'
import type { RenovationResult } from '@/lib/renovate-agent'
import {
  guessPhotoKindFromName,
  PHOTO_KIND_OPTIONS,
  type PhotoKind,
} from '@/lib/photo-kind'
import { ResultViewer } from './result-viewer'
import { ThemeToggle } from './theme'

interface StagedPhoto {
  id: string
  name: string
  dataUrl: string
  kind: PhotoKind
  kindSource: 'pending' | 'vision' | 'filename' | 'default' | 'manual'
  classifying: boolean
}

type Status = 'idle' | 'reading' | 'analyzing' | 'planning' | 'done' | 'error'

const STYLE_PRESETS = [
  'Open-plan, more light',
  'Minimalist Scandinavian',
  'Warm industrial loft',
  'Cozy traditional',
  'Maximize storage',
]

async function classifyStagedPhoto(
  photo: Pick<StagedPhoto, 'id' | 'name' | 'dataUrl'>,
): Promise<{ id: string; kind: PhotoKind; source: 'vision' | 'filename' | 'default' }> {
  try {
    const response = await fetch('/api/renovate/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: photo.dataUrl, fileName: photo.name }),
    })
    if (!response.ok) throw new Error('classify failed')
    const data = (await response.json()) as {
      kind?: PhotoKind
      source?: 'vision' | 'filename' | 'default'
    }
    if (!data.kind) throw new Error('missing kind')
    return {
      id: photo.id,
      kind: data.kind,
      source: data.source ?? 'default',
    }
  } catch {
    const fromName = guessPhotoKindFromName(photo.name)
    return {
      id: photo.id,
      kind: fromName ?? 'interior',
      source: fromName ? 'filename' : 'default',
    }
  }
}

export default function RenovatePage() {
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const [goals, setGoals] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RenovationResult | null>(null)
  const [dropHover, setDropHover] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)
  const lockedKinds = useRef(new Set<string>())

  const readFile = useCallback((file: File): Promise<StagedPhoto> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const fromName = guessPhotoKindFromName(file.name)
        resolve({
          id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          dataUrl: String(reader.result ?? ''),
          kind: fromName ?? 'interior',
          kindSource: fromName ? 'filename' : 'pending',
          classifying: true,
        })
      }
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(file)
    })
  }, [])

  const applyClassification = useCallback(
    (id: string, kind: PhotoKind, source: StagedPhoto['kindSource']) => {
      if (lockedKinds.current.has(id)) return
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === id
            ? { ...photo, kind, kindSource: source, classifying: false }
            : photo,
        ),
      )
    },
    [],
  )

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const images = await Promise.all(Array.from(files).map(readFile))
      setPhotos((prev) => [...prev, ...images])

      void Promise.all(
        images.map(async (photo) => {
          const result = await classifyStagedPhoto(photo)
          applyClassification(result.id, result.kind, result.source)
        }),
      )
    },
    [readFile, applyClassification],
  )

  const removePhoto = useCallback((id: string) => {
    lockedKinds.current.delete(id)
    setPhotos((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const setPhotoKind = useCallback((id: string, kind: PhotoKind) => {
    lockedKinds.current.add(id)
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, kind, kindSource: 'manual', classifying: false } : p,
      ),
    )
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDropHover(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const canSubmit = photos.length > 0 || goals.trim().length > 0
  const classifying = photos.some((p) => p.classifying)

  const reset = useCallback(() => {
    setResult(null)
    setStatus('idle')
    setError(null)
  }, [])

  const submit = useCallback(async () => {
    setStatus('reading')
    setError(null)
    try {
      setStatus('analyzing')
      const response = await fetch('/api/renovate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: photos.map((p) => ({ dataUrl: p.dataUrl, kind: p.kind })),
          goals: goals.trim() || 'Open up the space, more natural light, modern minimal aesthetic.',
        }),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { message?: string }
        throw new Error(err.message ?? `request failed (${response.status})`)
      }
      setStatus('planning')
      const data = (await response.json()) as RenovationResult
      setResult(data)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
      setStatus('error')
    }
  }, [photos, goals])

  if (status === 'done' && result) {
    return <ResultViewer result={result} onReset={reset} />
  }

  const busy = status === 'reading' || status === 'analyzing' || status === 'planning'
  const statusLabel =
    status === 'reading'
      ? 'Reading photos…'
      : status === 'analyzing'
        ? 'Analyzing your space…'
        : status === 'planning'
          ? 'Planning renovation…'
          : null

  return (
    <div className="min-h-screen">
      <header className="border-b border-card-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Icon className="size-5 text-primary" icon="tabler:wand" />
            <span className="font-semibold tracking-tight">Renovate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button nativeButton={false} render={<Link href="/" />} size="sm" variant="outline">
              Editor
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-8 text-center">
          <h1 className="font-semibold text-3xl tracking-tight">Renovate your space</h1>
          <p className="mx-auto mt-2 max-w-md text-muted leading-relaxed">
            Drop photos of your home, then say what you want changed.
          </p>
        </div>

        <Card>
          <CardBody className="flex flex-col gap-6 p-6">
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <label className="font-medium text-foreground">Photos</label>
                <span className="text-dimmed text-sm">
                  {photos.length === 0
                    ? 'Optional but recommended'
                    : classifying
                      ? 'Detecting photo types…'
                      : `${photos.length} uploaded`}
                </span>
              </div>

              <div
                className={`flex flex-col items-center justify-center rounded-xl px-5 py-10 text-center transition-[background-color,box-shadow] duration-150 ease-out ${
                  dropHover
                    ? 'bg-primary/8 shadow-[inset_0_0_0_2px_var(--primary)]'
                    : 'bg-accent shadow-[inset_0_0_0_1px_var(--border)]'
                }`}
                onDragLeave={() => setDropHover(false)}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropHover(true)
                }}
                onDrop={onDrop}
              >
                <Icon className="mb-3 size-6 text-dimmed" icon="tabler:photo-up" />
                <p className="font-medium text-foreground">Drop photos here</p>
                <p className="mt-1 text-muted text-sm">
                  Types are detected automatically. You can still change them.
                </p>
                <Button
                  className="mt-4"
                  onClick={() => fileInput.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Browse files
                </Button>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    handleFiles(e.target.files)
                    e.target.value = ''
                  }}
                  ref={fileInput}
                  type="file"
                />
              </div>

              {photos.length > 0 && (
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      <PhotoThumb
                        onKindChange={(kind) => setPhotoKind(photo.id, kind)}
                        onRemove={() => removePhoto(photo.id)}
                        photo={photo}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <label className="font-medium text-foreground" htmlFor="goals">
                  What do you want?
                </label>
              </div>
              <Textarea
                className="min-h-32 leading-relaxed"
                id="goals"
                onChange={(e) => setGoals(e.target.value)}
                placeholder="Open-plan living/kitchen, keep the footprint, neutral tones, more light…"
                rows={4}
                value={goals}
                variant="subtle"
              />
              <div className="flex flex-wrap gap-1.5">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    className="rounded-full bg-accent px-2.5 py-1 text-muted text-sm transition-[color,background-color] duration-150 ease-out hover:bg-primary/10 hover:text-foreground active:scale-[0.97]"
                    key={preset}
                    onClick={() =>
                      setGoals((prev) => (prev.trim() ? `${prev.trim()}. ${preset}.` : `${preset}.`))
                    }
                    type="button"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </section>

            {error && (
              <Alert variant="danger">
                <Icon icon="tabler:alert-circle" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-3 border-t border-card-separator pt-5">
              <Button
                block
                disabled={!canSubmit || busy}
                onClick={submit}
                pill
                progress={busy}
                size="lg"
                type="button"
              >
                {busy ? (
                  statusLabel
                ) : (
                  <>
                    Propose renovation
                    <Icon icon="tabler:arrow-right" />
                  </>
                )}
              </Button>
              <p className="text-center text-dimmed text-sm">
                {busy
                  ? 'This can take a moment…'
                  : 'Prompt only works too. Add photos for a tighter plan.'}
              </p>
            </div>
          </CardBody>
        </Card>
      </main>
    </div>
  )
}

function PhotoThumb({
  photo,
  onKindChange,
  onRemove,
}: {
  photo: StagedPhoto
  onKindChange: (kind: PhotoKind) => void
  onRemove: () => void
}) {
  const autoLabel =
    photo.kindSource === 'vision' || photo.kindSource === 'filename'
      ? 'Auto'
      : photo.classifying
        ? 'Detecting'
        : null

  return (
    <div className="group relative overflow-hidden rounded-xl bg-accent shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="relative aspect-square">
        <Image
          alt={photo.name}
          className="object-cover"
          fill
          src={photo.dataUrl}
          unoptimized
        />
        <button
          aria-label="Remove photo"
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-card/90 text-muted opacity-0 shadow-sm transition-[opacity,transform,background-color] duration-150 ease-out group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground active:scale-95"
          onClick={onRemove}
          type="button"
        >
          <Icon className="size-3.5" icon="tabler:x" />
        </button>
        {autoLabel && (
          <span className="absolute bottom-2 left-2 rounded-md bg-card/90 px-1.5 py-0.5 font-medium text-[10px] text-muted shadow-sm">
            {autoLabel}
          </span>
        )}
      </div>
      <div className="p-2">
        <label className="sr-only" htmlFor={`kind-${photo.id}`}>
          Photo type
        </label>
        <select
          className="w-full cursor-pointer appearance-none rounded-lg border-0 bg-card px-2.5 py-1.5 font-medium text-foreground text-sm outline-none ring ring-border transition-[box-shadow] duration-150 ease-out focus:ring-2 focus:ring-primary disabled:opacity-70"
          disabled={photo.classifying && photo.kindSource === 'pending'}
          id={`kind-${photo.id}`}
          onChange={(e) => onKindChange(e.target.value as PhotoKind)}
          value={photo.kind}
        >
          {PHOTO_KIND_OPTIONS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
