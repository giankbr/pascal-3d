'use client'

import { Editor, type SceneGraph } from '@pascal-app/editor'
import { ArrowLeft, Sparkles, Wand2, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { RenovationChange, RenovationResult } from '@/lib/renovate-agent'

const CHANGE_ICONS: Record<string, string> = {
  'remove-wall': '🧱',
  'add-wall': '🏗️',
  'move-item': '🪑',
  'relabel-zone': '🏷️',
  'add-opening': '🚪',
  restyle: '🎨',
}

interface Props {
  result: RenovationResult
  onReset: () => void
}

export function ResultViewer({ result, onReset }: Props) {
  const [view, setView] = useState<'after' | 'before'>('after')
  const [dismissedChanges, setDismissedChanges] = useState<Set<string>>(new Set())

  const graph: SceneGraph = view === 'after' ? result.after : result.before
  const visibleChanges = result.changes.filter((c) => !dismissedChanges.has(c.id))

  const handleLoad = useCallback(async () => graph, [graph])

  return (
    <div className="relative h-screen w-screen">
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-4 py-2 text-xs shadow-sm backdrop-blur">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
              result.mode === 'live'
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-amber-500/15 text-amber-600'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            {result.mode === 'live' ? 'Live (Claude)' : 'Demo'}
          </span>
          <div className="flex items-center rounded-full border border-border/60 bg-muted/40 p-0.5">
            <button
              className={`rounded-full px-3 py-1 font-medium transition ${
                view === 'after' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
              onClick={() => setView('after')}
              type="button"
            >
              Proposed
            </button>
            <button
              className={`rounded-full px-3 py-1 font-medium transition ${
                view === 'before' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
              onClick={() => setView('before')}
              type="button"
            >
              Original
            </button>
          </div>
          <button
            className="flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 font-medium hover:bg-accent/40"
            onClick={onReset}
            type="button"
          >
            <ArrowLeft className="h-3 w-3" />
            New
          </button>
        </div>
      </div>

      <aside className="absolute top-0 right-0 z-30 flex h-full w-full max-w-sm flex-col border-l border-border/60 bg-background/95 shadow-xl backdrop-blur">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Renovation Proposal</h2>
          </div>
          <p className="mt-2 text-muted-foreground text-xs leading-relaxed">{result.summary}</p>
          {result.analysis && (
            <p className="mt-2 rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {result.analysis}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              {visibleChanges.length} change{visibleChanges.length === 1 ? '' : 's'}
            </h3>
          </div>
          <ul className="space-y-2">
            {result.changes.map((c) => {
              const dismissed = dismissedChanges.has(c.id)
              return (
                <li key={c.id}>
                  <ChangeCard
                    change={c}
                    dismissed={dismissed}
                    onDismiss={() =>
                      setDismissedChanges((prev) => new Set(prev).add(c.id))
                    }
                    onRestore={() =>
                      setDismissedChanges((prev) => {
                        const next = new Set(prev)
                        next.delete(c.id)
                        return next
                      })
                    }
                  />
                </li>
              )
            })}
          </ul>
        </div>

        <div className="border-t border-border/60 px-5 py-3">
          <button
            className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition hover:bg-primary/90"
            onClick={() => setDismissedChanges(new Set())}
            type="button"
          >
            Restore all ({result.changes.length})
          </button>
        </div>
      </aside>

      <div className="h-full w-full pr-[24rem]">
        <Editor layoutVersion="v2" projectId="reno-preview" onLoad={handleLoad} />
      </div>
    </div>
  )
}

function ChangeCard({
  change,
  dismissed,
  onDismiss,
  onRestore,
}: {
  change: RenovationChange
  dismissed: boolean
  onDismiss: () => void
  onRestore: () => void
}) {
  const icon = CHANGE_ICONS[change.kind] ?? '•'
  return (
    <div
      className={`group rounded-lg border p-3 transition ${
        dismissed
          ? 'border-border/40 bg-muted/20 opacity-60'
          : 'border-border/60 bg-background hover:border-primary/40'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-xs">{change.title}</p>
          <p className="mt-0.5 text-muted-foreground text-[11px] leading-relaxed">
            {change.description}
          </p>
        </div>
        <button
          className="shrink-0 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
          onClick={dismissed ? onRestore : onDismiss}
          type="button"
          aria-label={dismissed ? 'Restore' : 'Dismiss'}
        >
          {dismissed ? <Sparkles className="h-3 w-3" /> : <X className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}
