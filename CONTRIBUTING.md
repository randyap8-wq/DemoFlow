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

## License

By contributing, you agree that your contributions will be licensed under
the same Apache-2.0 license that covers the project.
