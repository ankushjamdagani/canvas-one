<p align="center">
  <img src="public/favicon.svg" alt="Canvas One logo" width="96" height="96" />
</p>

<h1 align="center">Canvas One</h1>

<p align="center">
  An infinite drafting sheet for system design. Sketch an architecture, give each part real behaviour, and run it to see where queues build up and requests fail.
</p>

<p align="center">
  <a href="LICENSE">MIT license</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="DESIGN.md">Design notes</a>
</p>

> **Status: preview (`v0.1.0`).** The app runs locally from this repository. The `npx canvas-one@preview` command shown on the landing page is **coming soon** and is not published yet. Expect rough edges and breaking changes before 1.0.

## What it does

- **Model on a canvas.** Place components from a catalog of 29 kinds (clients, edge, compute, data, messaging, operations), connect them, group them into subsystems and annotate them with notes.
- **Give parts behaviour.** Configure capacity, queueing, concurrency, failures, retries, caches, brokers and workloads. Scenarios describe the traffic to apply.
- **Simulate.** A seeded, deterministic discrete-event simulation runs in a Web Worker. Replay it, scrub the timeline, and inspect individual requests and cycles. Nothing is reported as passed or measured unless it ran.
- **Keep history.** Projects have branches, commits and three-way merges. Publishing to `main` requires passing runs for every scenario.
- **Stay local.** Projects live in your browser's IndexedDB. There is no account, no server and no network traffic for your designs. Export a project as a portable JSON bundle to back it up or move it.

The simulator models performance behaviour. It does not execute your application code or reproduce a specific cloud provider, so treat results as a learning aid rather than a capacity plan.

> The landing page shows an illustrative collaboration with an AI assistant. The app does not call any AI service today.

## Quick start

Requires Node.js 22.12 or newer (developed on Node 24).

```sh
git clone https://github.com/ankushjamdagani/canvas-one.git
cd canvas-one
npm ci
npm run dev
```

Open <http://localhost:5173>. Pick **Try Beta** to reach your projects, then create a blank project or open one of the bundled examples.

## Scripts

| Command                              | What it does                                                    |
| ------------------------------------ | --------------------------------------------------------------- |
| `npm run dev`                        | Start the Vite dev server                                       |
| `npm run build`                      | Type-check and build to `dist/`                                 |
| `npm test`                           | Run the unit tests (Vitest)                                     |
| `npm run test:e2e`                   | Run the browser tests (Playwright) against the dev server       |
| `TEST_PRODUCTION=1 npm run test:e2e` | Run the browser tests against `vite preview` of a built `dist/` |
| `npm run storybook`                  | Browse the design system in Storybook on port 6006              |
| `npm run build-storybook`            | Build a static Storybook                                        |

Install the browser once with `npx playwright install chromium`. To test a production build, run `npm run build` first and start the preview server on port 5174 (`npx vite preview --port 5174`).

## Project layout

```
src/
  domain/        Pure model, readiness checks, versioning, scenario runner
  simulation/    Discrete-event kernel and Web Worker protocol
  persistence/   IndexedDB repository, import/export, integrity checks
  features/      Screens and workflows: workspace, runs, history, library, transfer…
  components/    Shared UI primitives, design tokens, canvas traffic visuals
  stories/       Storybook stories for the design system
tests/           Playwright browser tests
```

`DESIGN.md` describes the architecture and design system in depth, and `PRODUCT.md` records the product intent.

## Built with

React 19, TypeScript, Vite, [React Flow](https://reactflow.dev/), Dexie, Radix UI, Tailwind CSS, Motion, Vitest, Playwright and Storybook.

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and note our [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ankush Jamdagani
