# System Studio revamp

Bring the supplied claude.design redesign (Evergreen paper) into the existing product without losing capabilities, and turn it into one runnable modeling workspace with local branching, publishing and saved parts.

**Status:** planning complete, and **implementation on hold** until the user lifts it ([delivery.md](delivery.md)).

## Read order

| Doc | What it answers |
|---|---|
| [decisions.md](decisions.md) | What has been decided (D01–D30) |
| [requirements.md](requirements.md) | What must be true (R01–R15) and how it's accepted |
| [architecture.md](architecture.md) | Product model, modules, versioning, storage cutover, legacy retirement, future boundaries |
| [design.md](design.md) | Design source, screen map, tokens, accessibility, components, code anchors |
| [contracts/](contracts/README.md) | Exact schemas, commands, identity, storage, parts/export |
| [fixtures/](fixtures/README.md) | S01–S05 scenario data and size measurements |
| [delivery.md](delivery.md) | Roles, rules, packages, sub-steps, task ledger |
| [verification.md](verification.md) | Baseline, acceptance matrix, release gates |
| [reviews.md](reviews.md) | Review history |

Before any work also read the repository `AGENTS.md` and `HANDOFF.md`.

## Scope in one screen

- **In:**
  - Design: Evergreen paper (light only); restyled shell, canvas, dock, inspector, library, results and history.
  - Panels and dock: movable/stacked/collapsed panels; dock customization.
  - Parts and export: saved parts; CSV and Mermaid export.
  - Versioning: local branches, commits, publish and merge.
  - Runs: model-based runs for frontend, backend, data flow, infrastructure and fullstack (S01–S05).
  - Phones: full editing on phones.
- **Rules:**
  - Commits and publications need passing runs for every scenario.
  - Publications can't be undone.
  - Configuration edits use Apply/Cancel.
  - Old data formats are dropped; the old database is left untouched.
- **Out (for now):** real source execution; AI features; accounts, sync and hosting; live coediting; dark theme; team/share features.
- [design-revalidation.md](design-revalidation.md) — plan checked against the rendered screens (2026-09-25): coverage, overridden design elements, open gaps, proposed plan changes.
