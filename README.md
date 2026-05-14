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
  hooks/
    useKeyframeAnimation.ts   # rAF-driven keyframe interpolation hook
  lib/
    utils.ts                  # injectSnapshotIntoIframe + sanitizeRawHtml + cn() helper
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

## Quick start

Spin up DemoFlow in under a minute. The fastest path for *new* projects that
want to embed the engine is via Vite's scaffolder; for *this* repository,
clone + `npm install` is enough.

```bash
# Scaffold a fresh Vite + React + TS workspace, then drop DemoFlow into it.
npm create vite@latest my-demoflow -- --template react-ts
cd my-demoflow
# Install the same runtime deps DemoFlow uses (see package.json):
npm install lucide-react motion clsx tailwind-merge rrweb-snapshot
# Then copy `src/components/DemoPlayer.tsx`, `src/hooks/`, `src/lib/`, and
# `src/types.ts` from this repo into your new project.
```

To run *this* repository directly:

```bash
git clone https://github.com/randyap8-wq/DemoFlow.git
cd DemoFlow
npm install
npm run dev          # http://localhost:3000
```

Need it containerized? See [Docker](#docker) below — `docker build -t demoflow .`
then `docker run --rm -p 8080:8080 demoflow` and you're up.

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
| `npm run build`   | Type-check then produce a production build in `dist/`. |
| `npm run preview` | Preview the production build locally (port 4173).      |
| `npm run lint`    | Run `tsc --noEmit` for type checking.                  |
| `npm test`        | Run the Vitest suite (`scriptLoader`, `sanitizeRawHtml`).|
| `npm run clean`   | Remove the `dist/` build output.                       |
| `npm run deploy`  | Build and publish `dist/` to a `gh-pages` branch via the `gh-pages` package. |

No environment variables are required to run the demo player.

## Keyboard shortcuts

When the player has focus (default after page load):

| Key                | Action                       |
| ------------------ | ---------------------------- |
| `Space`            | Play / pause                 |
| `←` / `→`          | Previous / next step         |
| `Home` / `End`     | First / last step            |
| `R`                | Restart from the first step  |
| `F`                | Toggle fullscreen on the player container |

Hotspots are also fully keyboard-accessible (`Tab` to focus, `Enter` /
`Space` to activate) and show a focus ring.

## Presentation mode

DemoFlow is built to be driven *live* — from a laptop on a projector, or a
shared screen on a call — without leaving the keyboard. Treat it like a
slide deck:

1. **Open the player and focus it.** The page captures keyboard events
   globally as long as no `<input>`/`<textarea>` has focus, so a single
   click anywhere on the chrome (or just page load) is enough.
2. **Drive with arrows.** `→` / `←` step forward and back through the
   flow; `Space` toggles play/pause for keyframe animation; `Home` / `End`
   jump to the first / last step.
3. **Go fullscreen with `F`.** This calls the standard
   `Element.requestFullscreen()` API on the player container, hiding
   everything except the demo. Press `F` again (or `Esc`) to exit.
4. **Restart with `R`** between takes — useful when re-running a section
   for the audience.
5. **Embed for screen-shares.** Append `?embed=1` to the URL to hide the
   page chrome entirely so only the player is visible. Combine with
   `#step=<id>` to deep-link to a specific moment.

> **Tip — projector hygiene.** Bump the browser zoom to 110–125 % before
> going fullscreen so code blocks remain readable from the back of the
> room. The Tailwind v4 tokens scale cleanly; no layout reflow surprises.

| Key                | Action                                |
| ------------------ | ------------------------------------- |
| `Space`            | Play / pause keyframe animation       |
| `→` / `←`          | Next / previous step                  |
| `Home` / `End`     | First / last step                     |
| `R`                | Restart from the first step           |
| `F`                | Toggle fullscreen                     |
| `Esc`              | Exit fullscreen (browser default)     |

## URL parameters and embedding

DemoFlow reads a few query/hash parameters on startup:

| Parameter         | Effect                                                       |
| ----------------- | ------------------------------------------------------------ |
| `?demo=<url>`     | Fetch and play a remote `DemoScript` JSON (or HTML) URL.     |
| `?embed=1`        | Hide the page chrome and render only the player full-bleed.  |
| `#step=<id\|idx>` | Deep-link to a specific step on load. The hash is kept in sync as the user navigates so links are shareable. |

**Embedding example:**

```html
<iframe
  src="https://your-host.example/?embed=1&demo=https://your-host.example/examples/welcome.json#step=step-2"
  width="800"
  height="600"
></iframe>
```

### `postMessage` API

Embedders can drive the player from the parent page via `window.postMessage`.
All messages must include `source: 'demoflow'`.

> **Wait for `ready` first.** The player emits
> `{ source: 'demoflow', type: 'ready' }` once it is mounted and listening for
> messages. Sending commands before this event arrives is racy: if the iframe's
> `contentWindow` hasn't finished initialising, the message handler isn't
> attached yet and the command is silently dropped. Buffer commands until you
> see `ready`:
>
> ```js
> const iframe = document.querySelector('iframe');
> let ready = false;
> const queue = [];
> window.addEventListener('message', (e) => {
>   if (e.data?.source !== 'demoflow') return;
>   if (e.data.type === 'ready') {
>     ready = true;
>     queue.splice(0).forEach((m) => iframe.contentWindow.postMessage(m, '*'));
>   }
> });
> function send(msg) {
>   if (ready) iframe.contentWindow.postMessage(msg, '*');
>   else queue.push(msg);
> }
> ```

```js
const player = document.querySelector('iframe').contentWindow;
player.postMessage({ source: 'demoflow', type: 'play' }, '*');
player.postMessage({ source: 'demoflow', type: 'goToStep', stepId: 'step-2' }, '*');
player.postMessage({ source: 'demoflow', type: 'getState' }, '*');
```

| `type`       | Effect                                                |
| ------------ | ----------------------------------------------------- |
| `play`       | Start playback.                                       |
| `pause`      | Pause playback.                                       |
| `next`/`prev`| Move to the next / previous step.                     |
| `restart`    | Jump to the first step and play.                      |
| `goToStep`   | Jump to step matching `stepId` (id string or index).  |
| `getState`   | Reply with `{ type: 'state', stepId, index, total, isPlaying }`. |

The player emits `{ source: 'demoflow', type: 'ready' }` on mount and
`{ source: 'demoflow', type: 'stepChanged', stepId, index, total }` whenever
the step changes.

## Styling

DemoFlow ships with an **industrial dark-mode aesthetic**: a near-black
slate background, a single saturated brand accent for the timeline, focus
ring, and active hotspot, and high-contrast typography. The whole look is
driven by a handful of CSS custom properties declared in
[`src/index.css`](./src/index.css) under Tailwind v4's `@theme` block — no
SCSS, no theme provider, no rebuild required to restyle.

### The variables that matter

| Variable             | Role in the player                                         |
| -------------------- | ---------------------------------------------------------- |
| `--color-brand`      | Primary accent: timeline fill, focus ring, hotspot pulse.  |
| `--color-slate-950`  | Outermost background — the "deck" behind the player.       |
| `--color-slate-900`  | Card / panel surface (left rail, timeline tray).           |
| `--color-slate-800`  | Borders and subtle dividers.                               |
| `--color-slate-300`  | Body copy on dark surfaces.                                |
| `--color-slate-100`  | Headings and high-emphasis labels.                         |

### Re-skinning for a brand

Override the variables from the parent page (or in a CSS file loaded
*after* the bundle). Two recipes you'll reach for most often:

```css
/* 1. Stay industrial, swap the accent for your brand orange / cyan / etc. */
:root {
  --color-brand: #ff6a00; /* default — Amalgafy orange */
}

/* 2. Tighten the dark-mode palette toward "industrial professional":
      colder slate, deeper background, brighter accent. */
:root {
  --color-slate-950: #0a0d12; /* near-black deck */
  --color-slate-900: #121821; /* panel surface */
  --color-slate-800: #1f2937; /* hairline borders */
  --color-slate-300: #cbd5e1; /* body text */
  --color-slate-100: #f1f5f9; /* headings */
  --color-brand:     #38bdf8; /* cyan accent — swap for your hex */
}

/* 3. White-label / light-mode flip. The player keeps working; nothing
      hard-codes a specific lightness. */
:root {
  --color-slate-950: #ffffff;
  --color-slate-900: #f6f6f6;
  --color-slate-800: #e5e7eb;
  --color-slate-300: #334155;
  --color-slate-100: #0f172a;
  --color-brand:     #2563eb;
}
```

Because Tailwind v4 emits utility classes that resolve these variables at
*runtime*, overriding them in the cascade restyles the player without a
rebuild — handy for live theming inside a `?embed=1` iframe or in a
storybook-style preview.

> **Design note.** The default palette is intentionally restrained: one
> brand color, one neutral ramp, no gradients. If you're matching a brand,
> change `--color-brand` first, ship it, and only touch the slate ramp if
> the contrast against your accent fails WCAG AA.

## Docker

DemoFlow ships a [multi-stage `Dockerfile`](./Dockerfile) so you can run the
player without a local Node toolchain. Stage 1 builds the Vite bundle on
`node:20-alpine`; stage 2 serves the static `dist/` over `nginx:alpine` on
port 8080.

```bash
# Build the image (≈ 80 MB final, Nginx-only runtime).
docker build -t demoflow .

# Run it. The container listens on 8080 inside; map to any host port.
docker run --rm -p 8080:8080 demoflow
# → open http://localhost:8080
```

Need a sub-path build for an internal reverse proxy? Pass `BASE_PATH` as a
build arg:

```bash
docker build --build-arg BASE_PATH=/demoflow/ -t demoflow:subpath .
```

See [`nginx.conf`](./nginx.conf) for the bundled Nginx config — it gzips
text assets, caches `/assets/*` aggressively, and falls back to
`index.html` for SPA routes.

## Deploy

Two supported paths, both reading from the same `npm run build` output:

1. **GitHub Pages (CI/CD).** [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
   builds, tests, and publishes `dist/` to GitHub Pages on every push to
   `main` using the official `actions/deploy-pages` action. Enable Pages in
   the repository settings → *Pages* → *Source: GitHub Actions*; no other
   configuration is required. The workflow sets `BASE_PATH=/<repo>/`
   automatically so asset URLs resolve under the project-pages sub-path.
2. **Manual / one-off.** Run `npm run deploy` locally. This builds the
   bundle and pushes `dist/` to the `gh-pages` branch via the
   [`gh-pages`](https://github.com/tschaub/gh-pages) package. Useful for
   forks and previews from a developer machine.

For non-Pages hosts (Vercel, Netlify, Cloudflare Pages, S3 + CloudFront),
the build output in `dist/` is a plain static site — point your host at
`npm run build` and serve `dist/` as the publish directory. If your host
serves the app from a sub-path, set the `BASE_PATH` env var at build time
(e.g. `BASE_PATH=/demoflow/ npm run build`).

## Accessibility

- `prefers-reduced-motion` is respected: the cursor jumps to the final
  keyframe instead of animating, and timeline tweens are disabled.
- An `aria-live` region announces step changes for screen readers.
- Hotspots expose proper `aria-label` text and a visible focus ring.

## Notes on current state

- The player, virtual cursor, hotspots, and mutations all work end-to-end
  against the bundled `SAMPLE_DEMO`.
- Snapshots in `SAMPLE_DEMO` are hand-written mock trees; capturing real
  pages with `rrweb-snapshot`'s `snapshot()` and feeding the result into a
  `DemoStep` is the intended authoring path.

---

<p align="center">
  <a href="https://amalgafy.com">
    <img src="public/amalgafy-icon.svg" alt="Amalgafy" width="200" />
  </a>
</p>

<p align="center">
  Built by the <a href="https://amalgafy.com"><strong>Amalgafy</strong></a> team.
</p>
