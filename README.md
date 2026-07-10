# Renovate

Turn photos of a space into a renovation proposal you can review in 3D.

Upload a floor plan, interior shots, exterior photos, or inspiration. Describe what you want. Renovate analyzes the images and proposes layout changes with a before/after 3D view.

**App:** [http://localhost:3002/renovate](http://localhost:3002/renovate)

## Features

- Mix any photos: floor plan, interior, exterior, reference
- Tag each photo after upload
- Describe goals in plain language (with style presets)
- AI-assisted renovation plan (Claude, OpenAI, or Gemini) with demo fallback when no API key
- Before/after 3D review in the viewer
- Light and dark mode
- UI built with [Selia](https://selia.earth/) and [Tabler Icons](https://tabler.io/icons)

## Quick start

```bash
bun install
bun dev
```

Open:

- Renovate: http://localhost:3002/renovate
- Editor: http://localhost:3002

## Environment

Optional. Copy `.env.example` to `.env.local` in the monorepo root (or `apps/editor`):

| Variable | Required | Description |
|----------|----------|-------------|
| `RENOVATE_PROVIDER` | No | Force provider: `anthropic`, `openai`, or `google`. Auto-detects from keys if unset. |
| `ANTHROPIC_API_KEY` | No | Claude vision. Default model: `claude-sonnet-4-5` (`CLAUDE_MODEL`) |
| `OPENAI_API_KEY` | No | OpenAI vision. Default model: `gpt-4o` (`OPENAI_MODEL`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | No | Gemini vision (`GEMINI_API_KEY` also works). Default: `gemini-2.0-flash` (`GEMINI_MODEL`) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | No | Address search in the editor |
| `PORT` | No | Dev server port (app uses `3002` via the editor script) |

Without any AI key, Renovate runs in demo mode.

## Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start the Next.js app on port 3002 |
| `bun build` | Build all packages |
| `bun check` | Lint and format check (Biome) |
| `bun check:fix` | Auto-fix lint/format |
| `bun check-types` | TypeScript check |

## Structure

```
├── apps/editor/          # Next.js app (/renovate + 3D editor)
├── packages/
│   ├── core/             # Scene schema, state, geometry systems
│   ├── viewer/           # React Three Fiber viewer
│   ├── editor/           # Editor UI and tools
│   └── mcp/              # Scene templates and MCP helpers
└── tooling/              # Shared configs
```

## Commits

This repo uses [Husky](https://typicode.github.io/husky/) + [Commitlint](https://commitlint.js.org/) with Conventional Commits.

Examples:

```bash
feat(renovate): improve photo tagging
fix(ui): tighten renovate form layout
chore: update dependencies
```

## License

MIT
