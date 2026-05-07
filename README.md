# DemoFlow Engine

> **Open source.** DemoFlow is released as open source software — feel
> free to read the code, fork it, file issues and send pull requests.

A pixel-perfect, DOM-replay based product demo engine with interactive hotspots
and virtual cursor automation.

DemoFlow takes a serialized DOM snapshot of a real web page and rebuilds it
inside a sandboxed `<iframe>`, then plays a scripted tour over it: an animated
virtual cursor moves between keyframes, per-step DOM mutations are applied
(text/style/hide), and clickable hotspots advance the user through the demo.
This makes it possible to ship interactive, lightweight product demos that
look exactly like the real product without running the real product.


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
    scriptLoader.ts           # Load + validate DemoScript / HTML files
```

## Loading your own demo (local-only)

DemoFlow runs entirely in the browser — files you load never leave your machine.
There are three ways to point the player at a custom demo:

1. **Drop a file in `public/`.** On startup the app fetches `public/demo.json`
   (a `DemoScript`) or, if missing, `public/demo.html` (a raw HTML page) and
   uses it instead of the bundled `SAMPLE_DEMO`. This keeps large demos out
   of the JS bundle.
2. **Click "Load File"** in the left panel and pick a `.json` DemoScript or
   a `.html` file from disk.
3. **Drag & drop** a `.json` or `.html` file anywhere on the page.

A starter `public/demo.json` is included that mirrors `SAMPLE_DEMO`.

### Raw HTML demos

When you load an `.html` file, DemoFlow wraps it in a single-step script and
injects it into the player iframe via `srcdoc`. Hotspots, mutations and
keyframes are empty by default — the page just renders. To add a guided
tour over a raw HTML page, author a `DemoScript` JSON whose step uses the
`html` field instead of `snapshot`:

```json
{
  "title": "My Tour",
  "steps": [
    {
      "id": "step-1",
      "html": "<!doctype html><html>…</html>",
      "keyframes": [],
      "hotspots": [{ "id": "h1", "selector": "#cta", "nextStepId": "step-2" }],
      "mutations": [{ "selector": "#title", "action": "text", "value": "Hello" }]
    }
  ]
}
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
| `npm run build`   | Production build into `dist/`.                         |
| `npm run preview` | Preview the production build locally.                  |
| `npm run lint`    | Run `tsc --noEmit` for type checking.                  |
| `npm run clean`   | Remove the `dist/` build output.                       |

No environment variables are required to run the demo player.

## Notes on current state

- The player, virtual cursor, hotspots, and mutations all work end-to-end
  against the bundled `SAMPLE_DEMO`.
- Snapshots in `SAMPLE_DEMO` are hand-written mock trees; capturing real
  pages with `rrweb-snapshot`'s `snapshot()` and feeding the result into a
  `DemoStep` is the intended authoring path.

---

<p align="center">
  <a href="https://amalgafy.com">
    <img src="public/amalgafy-icon.svg" alt="Amalgafy" width="48" height="48" />
  </a>
</p>

<p align="center">
  Built by the <a href="https://amalgafy.com"><strong>Amalgafy</strong></a> team.
</p>
