<p align="center">
  <img src="public/favicon.svg" alt="Canvas One logo" width="96" height="96" />
</p>

<h1 align="center">Canvas One</h1>

<p align="center">
  <b>Beyond chat: The shared canvas for engineers and AI to think, architect, and review systems together.</b><br />
  A collaborative visual whiteboard for system design, code walkthroughs, architectural code reviews, deep-dive explanations, and engineering onboarding.
</p>

<p align="center">
  <a href="LICENSE">MIT license</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="DESIGN.md">Design notes</a>
</p>

> **Status: preview (`v0.1.0`).** The app runs locally from this repository. The `npx canvas-one@preview` command shown on the landing page is **coming soon** and is not published yet. Expect rough edges and breaking changes before 1.0.

## What it does

- **Beyond chat.** An infinite visual whiteboard where engineers and AI agents interact visually. Move beyond narrow, text-only chat prompts to explore architectures, trace execution flows, and reason about code spatially.
- **System design & simulation.** Place components from a catalog of 29 kinds (clients, edge, compute, data, messaging, operations), connect them, group them into subsystems, and annotate them with notes. Configure capacity, queueing, concurrency, retries, and workloads, then run seeded, deterministic discrete-event simulations in a Web Worker to identify bottlenecks before writing code.
- **Code walkthroughs & flow tracing.** Map repositories into clear component topologies. Trace request journeys, async event chains, and state mutations across service and module boundaries.
- **Architectural code review.** Review changes as visual topological deltas rather than raw line-by-line diffs. Inspect blast radius and downstream impact across queues, schemas, and dependencies.
- **System explanation & onboarding.** Break down complex distributed protocols into animated visual flows. Give new engineers guided, interactive tours of the system with living architecture context.
- **Keep history & stay local.** Projects live in your browser's IndexedDB with branches, commits, and three-way merges. No accounts, no cloud tracking, and portable JSON export/import.

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
