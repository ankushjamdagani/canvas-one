<p align="center">
  <img src="apps/web/public/favicon.svg" alt="Canvas One logo" width="96" height="96" />
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

The workspace has an in-app agent conversation with reviewed proposals and explicitly enabled task Live edits. A paired desktop service runs locally signed-in Claude or Codex; agy board-tool support is currently blocked. Credentials remain outside project documents. See [composable packages](docs/composables.md).

## Quick start

For hosted deployment, follow the [Vercel setup guide](docs/deployment-vercel.md).

Requires Node.js 22.12 or newer (developed on Node 24).

```sh
git clone https://github.com/ankushjamdagani/canvas-one.git
cd canvas-one
npm ci
npm run dev
```

Open <http://localhost:3000>. Pick **Try Beta** to reach your projects, then create a blank project or open one of the bundled examples.

### Local AI collaboration

Keep `npm run dev` running. In a second terminal, start the desktop execution service:

```sh
node packages/cli/dist/main.js collaborate --origin http://localhost:3000 --origin http://127.0.0.1:3000
```

1. Open a project, then **Cmd+K → AI collaboration**. In the floating panel, paste the complete JSON printed by the service and select **Connect**. Advanced setup also accepts the address and secret separately. Secrets expire after five minutes; restart the service for fresh details. The composer appears after connection succeeds.
2. Select Claude or Codex with its existing local CLI sign-in. Create or switch to a draft before starting an editing task. Questions are read-only and can run separately.
3. Send instructions inside Canvas One. Tasks start in Suggest: inspect the proposed changes and accept or reject them. Enable Live for a specific task attempt to authorize changes and deletions across its current board.
4. Stop disables further writes and keeps completed changes. Undo task prepares a reviewed revert that preserves human edits. Leaving or reloading requires explicit Resume; permissions do not move to another board or agent.

Agent execution is desktop-first; phones show collaboration states without running a desktop CLI remotely. Browser projects are origin-local: export/import a hosted project to use it locally. Rerun `npm run build:packages` after package edits and restart the service after CLI changes. Local development uses webpack. The lower-level CLI/MCP bridge remains available for custom hosts; see [CLI transport documentation](packages/cli/README.md).

If an older checkout reports missing workspace declarations after removing generated files, run `npx tsc -b --force` from the repository root, then restart `npm run dev`. Package build scripts now force output generation so stale incremental metadata cannot suppress missing declarations.

## Scripts

| Command                              | What it does                                                    |
| ------------------------------------ | --------------------------------------------------------------- |
| `npm run dev`                        | Start the Next.js dev server                                    |
| `npm run build`                      | Build the standalone Next.js app and offline worker             |
| `npm run start`                      | Serve the production standalone build                          |
| `npm run build:react`                | Build the reusable `@canvas-one/react` package to `dist-react/`  |
| `npm test`                           | Run the unit tests (Vitest)                                     |
| `npm run test:e2e`                   | Run the browser tests (Playwright) against the dev server       |
| `TEST_PRODUCTION=1 npm run test:e2e` | Run the browser tests against the built Next.js server         |
| `npm run storybook`                  | Browse the design system in Storybook on port 6006              |
| `npm run build-storybook`            | Build a static Storybook                                        |

Install the browser once with `npx playwright install chromium`. Run `npm run build` before production browser checks; Playwright starts an isolated server on port 5174. `dev:vite` and `build:vite` remain available for development tooling.

## Standalone, PWA and embedding

`npm run build` prepares `apps/web/.next/standalone`, including public assets and the offline worker. Deploy that directory and run `node apps/web/server.js` from its root, or use `npm run start` in this checkout. HTTPS is required for installation outside localhost. Set `CANVAS_SITE_URL` to your public origin at build time to generate the sitemap. Set `NEXT_PUBLIC_CANVAS_BASE_PATH` at build time for a standalone deployment behind a subroute.

The Next.js composition entry lives in `apps/web`. Independent functionality is being extracted incrementally into `packages/*`, each owning its public contracts. The full existing workspace remains the app throughout extraction; see [the architecture plan](docs/composable-architecture-plan.md) and [parity ledger](docs/architecture/parity-ledger.md) for implementation gates and remaining work.

Public landing and Brand pages are prerendered without opening IndexedDB. Local projects retain the existing database and export formats. The standalone app owns its PWA; a host application mounting the reusable module owns its own offline setup.

See [embedding instructions](docs/embedding.md), the [Next.js host example](examples/next-host/README.md), and [offline behavior](docs/pwa.md). The React package can be built and packed locally; it has not been published to npm.

## Project layout

```
app/             Next.js routes, metadata and standalone PWA manifest
src/
  domain/        Pure model, readiness checks, versioning, scenario runner
  simulation/    Discrete-event kernel and Web Worker protocol
  persistence/   IndexedDB repository, import/export, integrity checks
  features/      Screens and workflows: workspace, runs, history, library, transfer…
  components/    Shared UI primitives, design tokens, canvas traffic visuals
  stories/       Storybook stories for the design system
  embed/         Reusable CanvasOne component and package entry
  standalone/    Next.js shell and offline registration
tests/           Playwright browser tests
examples/next-host/ Built-package consumer mounted under /canvas
```

`DESIGN.md` describes the architecture and design system in depth, and `PRODUCT.md` records the product intent.

## Built with

Next.js, React 19, TypeScript, [React Flow](https://reactflow.dev/), Dexie, Radix UI, Tailwind CSS, Motion, Vitest, Playwright and Storybook. Vite builds the reusable module and supports Storybook/unit-test tooling.

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and note our [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ankush Jamdagani
