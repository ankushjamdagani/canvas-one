# Changelog

All notable changes to Canvas One are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/) (pre-1.0: minor bumps may break).

The version lives in `package.json` only. The app header reads it from there (`src/lib/appVersion.ts`). Release with `npm version <patch|minor|major>`, then move `Unreleased` entries under the new heading.

## [Unreleased]

## [0.1.0] - 2026-10-08

### Added
- Initial public preview: unified canvas, seeded simulation, branches and revisions, themes, brand page.
- Landing page shows `npx canvas-one@preview` with a "Coming soon" badge; the package is not yet published.

### Changed
- App header version now derives from `package.json` (was a hardcoded `v0.4.12`).
