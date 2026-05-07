# Contributing to DemoFlow

Thanks for taking the time to contribute! DemoFlow is open source under the
Apache-2.0 license — feel free to read the code, fork it, file issues, and
send pull requests.

## Development setup

```bash
npm install
npm run dev      # http://localhost:3000
```

Useful scripts:

| Script            | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Start the Vite dev server on port 3000.                |
| `npm run lint`    | Run `tsc --noEmit` for type checking.                  |
| `npm run build`   | Type-check then produce a production build in `dist/`. |
| `npm run preview` | Preview the production build locally.                  |

CI runs `npm run lint` and `npm run build` on every pull request.

## Pull requests

1. Fork the repo and create a feature branch.
2. Keep changes focused and small. Unrelated changes belong in a separate PR.
3. Update `README.md` and any inline docs when behaviour changes.
4. Make sure `npm run lint` and `npm run build` pass locally.
5. Open the PR with a clear description of the change and how to test it.

## Reporting bugs

Open an issue with:

- Steps to reproduce.
- Expected behaviour vs. what you observed.
- A minimal `DemoScript` JSON that triggers the bug, if applicable.
- Browser + version.

## Code style

The codebase uses TypeScript with strict types, React 19, Tailwind v4, and
the `motion` library for animation. Prefer small focused components and
keep new dependencies to a minimum.

## Authoring a `DemoScript`

The bundled `SAMPLE_DEMO` (`src/constants.ts`) and the example JSON files
contain hand-written `rrweb-snapshot` trees, which is fine for tiny demos
but tedious for anything real. The intended authoring path is to capture
a real page in your browser with `rrweb-snapshot` and paste the result into
a step's `snapshot` field.

Quickest path, no install required:

1. Open the page you want to capture in your browser.
2. Open DevTools → Console and load `rrweb-snapshot` from a CDN, then call
   `snapshot()` on `document`:

   ```js
   const s = document.createElement('script');
   s.src = 'https://cdn.jsdelivr.net/npm/rrweb-snapshot@2.0.0-alpha.4/dist/rrweb-snapshot.min.js';
   document.head.appendChild(s);
   s.onload = () => {
     const snap = rrwebSnapshot.snapshot(document);
     copy(JSON.stringify(snap)); // copies to clipboard in Chrome / Edge
     console.log('Snapshot copied to clipboard');
   };
   ```

3. Paste the clipboard contents into the `snapshot` field of a `DemoStep`
   in your `.json` file. Add `keyframes` (cursor path + clicks), `hotspots`
   (selectors that advance to the next step), and any `mutations` you want
   to apply on top of the snapshot.
4. Drop the `.json` onto the running app or load it via `?demo=<url>` to
   verify it plays back correctly.

For raw HTML pages without interactive automation, you can skip the
snapshot step entirely and load a `.html` file directly — DemoFlow will
wrap it in a single-step script for you.

## License

By contributing, you agree that your contributions will be licensed under
the same Apache-2.0 license that covers the project.
