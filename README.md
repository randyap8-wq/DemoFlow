
# DemoFlow Engine

A pixel-perfect, DOM-replay based product demo engine with interactive hotspots
and virtual cursor automation.

DemoFlow takes a serialized DOM snapshot of a real web page and rebuilds it
inside a sandboxed `<iframe>`, then plays a scripted tour over it: an animated
virtual cursor moves between keyframes, per-step DOM mutations are applied
(text/style/hide), and clickable hotspots advance the user through the demo.
This makes it possible to ship interactive, lightweight product demos that
look exactly like the real product without running the real product.

View this app in AI Studio:
https://ai.studio/apps/c1625a36-a388-4d97-acdd-6d5efd8065aa

## How it works

The demo engine is driven by a `DemoScript` (see `src/types.ts`) made of
ordered `DemoStep`s. Each step contains:

- **`snapshot`** – an `rrweb-snapshot` serialized DOM tree. At runtime
  `injectSnapshotIntoIframe` (`src/lib/utils.ts`) calls `rrweb-snapshot`'s
  `rebuild` to recreate that DOM inside the player iframe.
- **`keyframes`** – timestamped `{ x, y, type }` points (`move` / `click` /
  `wait`) used by `DemoPlayer` (`src/components/DemoPlayer.tsx`) to
  interpolate the position of the `VirtualCursor` via `requestAnimationFrame`.
- **`hotspots`** – CSS selectors inside the snapshot that render an overlay
  button on top of the iframe. Clicking a hotspot transitions to the
  configured `nextStepId`.
- **`mutations`** – per-step DOM edits (`text`, `style`, `hide`) applied to
  the rebuilt snapshot so each step can show different content without
  swapping snapshots.

The default sample script (`SAMPLE_DEMO` in `src/constants.ts`) renders a
mock dashboard, animates a cursor to a "Get Started" CTA, and transitions to
a second step that updates the title.

## Project structure

```
src/
  App.tsx                     # Page chrome + mounts <DemoPlayer />
  main.tsx                    # React entry point
  index.css                   # Tailwind v4 theme tokens
  constants.ts                # SAMPLE_DEMO script + mock snapshot
  types.ts                    # DemoScript / DemoStep / Keyframe / Hotspot / Mutation
  components/
    DemoPlayer.tsx            # Player: iframe, timeline, hotspots, animation loop
    VirtualCursor.tsx         # Animated cursor rendered above the iframe
  lib/
    utils.ts                  # injectSnapshotIntoIframe + cn() helper
```

## Run locally

**Prerequisites:** Node.js 18+ and npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (Vite, on http://localhost:3000)
npm run dev
```

Other scripts:

| Script            | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Start Vite dev server on port 3000.                    |
| `npm run build`   | Type-check-less production build into `dist/`.         |
| `npm run preview` | Preview the production build locally.                  |
| `npm run lint`    | Run `tsc --noEmit` for type checking.                  |
| `npm run clean`   | Remove the `dist/` build output.                       |

## Environment variables

No environment variables are required to run the demo player. An
`.env.example` file is included for AI Studio compatibility and lists:

- `GEMINI_API_KEY` – wired through `vite.config.ts` for AI Studio, but **not
  currently consumed by any code in `src/`**. Safe to leave unset.
- `APP_URL` – injected by AI Studio at deploy time; not used locally.

To customize values locally, copy the example file:

```bash
cp .env.example .env.local
```

## Notes on current state

- The player, virtual cursor, hotspots, and mutations all work end-to-end
  against the bundled `SAMPLE_DEMO`.
- `@google/genai` and `express` appear in `package.json` but are not yet
  used by the app — they are placeholders for future AI-assisted scripting
  and a potential snapshot-capture server. They can be removed if those
  features are not planned.
- Snapshots in `SAMPLE_DEMO` are hand-written mock trees; capturing real
  pages with `rrweb-snapshot`'s `snapshot()` and feeding the result into a
  `DemoStep` is the intended authoring path.
