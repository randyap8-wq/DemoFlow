# Example Flow — Authoring a DemoFlow Script

> **Audience:** Developers writing their first `DemoScript`. This file is a
> dense, end-to-end blueprint: snapshot → keyframes → hotspots → mutations,
> plus the sanitization step you should run on every code sample *before* it
> lands in a flow.

DemoFlow plays a recorded DOM snapshot inside a sandboxed `<iframe>` and
drives a virtual cursor across it. A flow is a small, declarative JSON
document — no runtime DSL, no plugin hooks, no surprises.

---

## 1. Anatomy of a `DemoScript`

A flow is an ordered list of `DemoStep`s. The shape is defined in
[`src/types.ts`](./src/types.ts); the validator lives in
[`src/lib/scriptLoader.ts`](./src/lib/scriptLoader.ts).

```jsonc
{
  "title": "Onboarding Tour",
  "steps": [
    {
      "id": "step-welcome",          // Required, unique across the script.
      "snapshot": { /* rrweb tree */ }, // OR "html": "<!doctype html>…"
      "keyframes": [
        { "t": 0,    "x": 120, "y": 80,  "type": "move" },
        { "t": 900,  "x": 540, "y": 320, "type": "move" },
        { "t": 1100, "x": 540, "y": 320, "type": "click" }
      ],
      "hotspots": [
        { "id": "cta", "selector": "#get-started", "nextStepId": "step-config" }
      ],
      "mutations": [
        { "selector": "h1", "action": "text",  "value": "Welcome back, Ada." },
        { "selector": ".banner", "action": "hide" },
        { "selector": ".badge",  "action": "style", "value": "color: #ff6a00" }
      ]
    }
  ]
}
```

> **Callout — invariants enforced at load time**
>
> - Every `hotspot.nextStepId` **must** match an existing `step.id`.
> - `step.id` values **must** be unique.
> - Either `snapshot` *or* `html` is required per step — never both.
>
> Violations are surfaced as readable errors by `scriptLoader.ts`; the player
> refuses to mount a broken flow instead of failing silently mid-tour.

---

## 2. Step-by-Step Transitions

A guided tour is a graph: each hotspot click is an edge to another step.
Keep step granularity small — one *intent* per step (e.g. "highlight CTA",
"open settings drawer", "show success toast").

```jsonc
{
  "steps": [
    { "id": "step-welcome", "hotspots": [{ "id": "h1", "selector": "#cta", "nextStepId": "step-config" }] /* … */ },
    { "id": "step-config",  "hotspots": [{ "id": "h2", "selector": "#save", "nextStepId": "step-success" }] /* … */ },
    { "id": "step-success", "hotspots": [] /* terminal step */ }
  ]
}
```

| Pattern             | When to use                                                  |
| ------------------- | ------------------------------------------------------------ |
| Linear chain        | Default onboarding / sequential walkthrough.                 |
| Branching hotspots  | Two CTAs that take the viewer down different feature paths.  |
| Terminal step       | A success screen with no hotspots — viewer can replay (`R`). |

### Keyframes

`keyframes[].t` is a millisecond timestamp relative to the step start.
Interpolation is linear between adjacent `move` points; `click` keyframes
trigger the cursor's click animation; `wait` keyframes hold position.

> **Callout — reduced motion**
>
> When `prefers-reduced-motion: reduce` is set, the player snaps to the
> final keyframe instead of animating. Author flows so the *final* frame is
> the meaningful one (cursor on the hotspot, not mid-glide).

---

## 3. Code Blocks Inside a Flow

Code samples are first-class content. Place them in the snapshot like any
other DOM:

```html
<pre class="demoflow-code" data-lang="ts"><code>export function add(a: number, b: number): number {
  return a + b;
}</code></pre>
```

Then highlight the relevant lines with a `mutation`:

```jsonc
{
  "selector": ".demoflow-code .line-2",
  "action": "style",
  "value": "background: rgba(255,106,0,0.18); outline: 1px solid #ff6a00;"
}
```

Use the `industrial dark-mode` palette (`--color-brand`, `--color-slate-900`)
so the code block visually matches the player chrome.

---

## 4. Sanitization Check (Clean-Shot)

> **Why this section exists.** Code snippets pasted from an IDE almost
> always carry invisible junk: smart quotes from a chat app, tab/space
> mixes, trailing whitespace, a stray prompt prefix, or a real secret. Any
> of these will surface — sometimes as a syntax error, sometimes as a
> credential leak — once the snippet is on a projector.

**Clean-Shot** is the lightweight sanitization pass you run on every code
sample *before* it lands in a `DemoScript`. The exact tool is flexible (a
shell function, an editor command, a CI hook); the checklist is not.

### The Clean-Shot checklist

1. **Normalize quotes & dashes.** Replace `“ ” ‘ ’ — –` with their ASCII
   equivalents. Smart quotes break copy/paste for viewers.
2. **Strip prompt prefixes.** Drop leading `$ `, `> `, `PS> ` if you're
   showing the *command*, not a session transcript.
3. **Collapse whitespace.** Convert tabs to spaces (match the project's
   indent width), trim trailing whitespace, ensure a single trailing
   newline.
4. **Redact secrets.** Replace anything matching common secret patterns
   (`sk-…`, `ghp_…`, AWS keys, JWTs, bearer tokens, `.env` values) with a
   placeholder like `<YOUR_TOKEN>`. Treat this as non-negotiable: a demo is
   a public artifact.
5. **Scrub PII.** Real emails, customer names, internal hostnames, and
   ticket IDs get replaced with stable fixtures (`ada@example.com`,
   `acme-corp`, `demo-host.internal`).
6. **Confirm it still runs.** Paste the cleaned snippet into a scratch file
   and re-run the linter / type-checker for the relevant language. A demo
   that doesn't compile is worse than no demo.

### Minimal Clean-Shot shell helper

```sh
# Pipe-in a snippet, get a sanitized version on stdout. Pair with `pbcopy`
# on macOS or `xclip -selection clipboard` on Linux.
clean_shot() {
  sed -E \
    -e 's/[“”]/"/g'  \
    -e "s/[‘’]/'/g"  \
    -e 's/[—–]/-/g'  \
    -e 's/[[:space:]]+$//' \
  | expand -t 2
}
```

Run it, eyeball the diff, then paste into the snapshot. Two seconds of
hygiene saves a live-demo apology.

> **Callout — automation, not vibes.** Wire Clean-Shot into your editor as
> a "Copy as Demo Snippet" command, or add a pre-commit hook that fails the
> commit when a `DemoScript` contains anything matching your secret regex
> set. Manual checklists drift; automated ones don't.

---

## 5. Loading the Flow

Three supported entry points (see [`README.md`](./README.md#loading-your-own-demo-local-only)):

1. Drop the JSON at `public/demo.json` — it's auto-loaded on startup.
2. Click **Load File** in the left panel and pick a `.json` / `.html`.
3. Drag-and-drop the file anywhere on the page.

For shareable links, embed via:

```html
<iframe
  src="https://your-host.example/?embed=1&demo=https://your-host.example/flows/onboarding.json#step=step-welcome"
  width="960"
  height="600"
></iframe>
```

---

## 6. Authoring Workflow (TL;DR)

1. **Capture** the target page with `rrweb-snapshot`'s `snapshot()` — or
   write raw HTML for synthetic mocks.
2. **Author** steps + keyframes + hotspots + mutations in a JSON file.
3. **Clean-Shot** every code sample inside the snapshot.
4. **Validate** by loading the file locally (`npm run dev`); the script
   loader will reject malformed flows with a precise error.
5. **Ship** by committing the JSON under `public/flows/` and linking to it
   from the README, or host it externally and pass `?demo=<url>`.

That's the whole loop — no build step required between authoring and
playback.
