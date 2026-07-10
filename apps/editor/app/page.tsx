'use client'

import { Editor } from '@pascal-app/editor'
import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { EDITOR_SIDEBAR_TABS } from '@/components/editor-sidebar-tabs'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

const PROJECT_ID = 'local-editor'

export default function Home() {
  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">Local editor — scenes are not saved.</span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Open recent scenes
            </Link>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Create new
            </Link>
          </div>
        </div>
      )}
      <Link
        className="pointer-events-auto absolute bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground text-xs shadow-lg transition hover:bg-primary/90"
        href="/renovate"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Renovate with AI
      </Link>
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={EDITOR_SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
