# Contributing to Canvas One

Thanks for helping out. This project is a pre-1.0 preview, so please open an issue to discuss anything larger than a small fix before you start work.

## Set up

```sh
npm ci
npm run dev        # http://localhost:3000
```

Node.js 22.12 or newer is required.

## Before you open a pull request

Run the checks that match your change:

```sh
npx tsc -b         # type-check (never pass --noEmit false; it writes .js files next to sources)
npm test           # unit tests
npm run build      # standalone Next.js production build and offline worker
npm run build:react # reusable module; keep every chunk under Vite's 500 kB warning
npx playwright install chromium
npm run build && TEST_PRODUCTION=1 npm run test:e2e   # browser tests against the built app
npm run build-storybook                               # if you touched src/components/ui or tokens
```

Unit tests live next to the code as `src/**/*.test.ts` (render components with `React.createElement` and `renderToStaticMarkup`; `.test.tsx` files do not run). Browser tests live in `tests/`.

## Conventions

- **UI foundations first.** Shared components live in `src/components/ui/` and design tokens in `src/styles.css`. Change those before adding one-off Tailwind overrides in `src/features/`, and check the result in Storybook.
- **Quiet, dense, accessible UI.** See [`.agents/rules/frontend-guidance.md`](.agents/rules/frontend-guidance.md) for control semantics and layout rules. New UI should pass keyboard, focus and 320 px reflow checks.
- **Comments explain why.** Write plain, current comments: invariants, units, ordering and edge cases. Do not reference private documents, task IDs or history.
- **Model and view stay separate.** Canvas layout data must not affect simulation results.
- Keep changes scoped, and add or update tests with them.
- [`LESSONS.md`](LESSONS.md) records pitfalls found in earlier work. Skim it before touching the canvas, theming or playback code.

## Versioning and releases

The version lives only in `package.json` and follows [Semantic Versioning](https://semver.org/) (pre-1.0: minor releases may break). Record user-visible changes under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md). Maintainers cut a release with `npm version <patch|minor|major>`.

## Working with coding agents (optional)

`AGENTS.md` describes the workflow used with AI coding agents in this repository. Third-party agent skills are pinned in `skills-lock.json` rather than committed. Restore them with:

```sh
npx skills experimental_install
```

The app builds and tests without them.

## Reporting bugs

Use the bug report template. Include the steps, what you expected, your browser, and a project export (JSON) if the problem depends on a design. Report security problems privately; see [SECURITY.md](SECURITY.md).

By contributing you agree your work is released under the [MIT license](LICENSE).
