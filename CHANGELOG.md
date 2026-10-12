# Changelog

All notable changes to Canvas One are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/) (pre-1.0: minor bumps may break).

The version lives in `package.json` only. The app header reads it from there (`src/lib/appVersion.ts`). Release with `npm version <patch|minor|major>`, then move `Unreleased` entries under the new heading.

## [Unreleased]

### Added
- Local AI collaboration through paired CLI/MCP agents, bounded context/schema discovery, visual proposal review, atomic acceptance, attribution and undo; host-supplied model providers.
- Independent embeddable boards, trusted custom components and renderer overrides, host actions in Cmd+K, and general playback tracks with explicit provenance.
- README rewrite, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates.
- MIT `LICENSE`.

### Changed
- Compose the existing Next.js app from sixteen workspace packages with package-owned contracts, headless history/storage/simulation services and a replaceable React Flow editor boundary. Existing routes, authoring, persisted history, simulation and transfers remain available.

## [0.1.0] - 2026-10-08

### Added
- Initial public preview: unified canvas, seeded simulation, branches and revisions, themes, brand page.
- Landing page shows `npx canvas-one@preview` with a "Coming soon" badge; the package is not yet published.

### Changed
- App header version now derives from `package.json` (was a hardcoded `v0.4.12`).
