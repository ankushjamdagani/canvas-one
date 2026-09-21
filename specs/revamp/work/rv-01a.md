# RV-01a — Tokens and core controls

Owner: Gemini/agy executor; Codex coordinator; Claude reviewer.
Status: READY; Claude bounded foundation verdict returned UNBLOCKED (session 34863). Fonts and additional composites in the reviewer's suggested sequence are assigned to later RV-01 slices; this exact file boundary remains authoritative.
Base: planning checkpoint to be recorded at dispatch.
Branch/worktree: to be assigned; never edit the coordinator checkout.

## Exact owned files

- `components.json`
- `src/styles.css` (theme mappings/root tokens/base control styles only; no unrelated feature selector changes)
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/badge.tsx`
- `foundation.html` (development specimen entry only, no app navigation change)
- `src/dev/FoundationSpecimen.tsx`
- `src/dev/foundation.tsx`
- `src/dev/foundation.css` (specimen layout only, no primitive restyling)

Everything else read-only. No package/lock/main.tsx changes in this subtask. No dependencies, fonts or missing components installed in this slice. This is not complete RV-01: font packaging, remaining primitives and overlay specimens follow separately.

## Brief

Read HANDOFF, decisions D02/D07/D08/D13, components.md and design-evidence.md. Use `.agents/skills/shadcn/SKILL.md`. Existing React19/Vite/Tailwind4/Radix foundation is retained. Official @shadcn is the approved registry. Inspect CLI info/docs for Button/Input/Badge, fetch docs and record resolved CLI version; no overwrite/init/preset changes. Configure shadcn for actual aliases and existing Radix base. Preserve every existing component export, variant and size API; add semantic variants only where needed.

Translate Evergreen paper token values exactly where accessible. Use opaque green focus treatment with measured contrast; preserve 32px desktop controls and at least 44px coarse-pointer targets. Define semantic surface/foreground pairs and control/tag radii from components.md. Maintain legacy aliases while current consumers exist; avoid colliding muted text and surface roles. Use font stacks for IBM Plex Sans/Mono/Newsreader, but explicitly report font packaging pending; do not fetch fonts from a remote CDN.

Button: native button defaults to type=button; asChild preserves slotted semantics and does not leak button-only type onto links. Keep ref/composition support and disabled behavior. Keep keyboard-visible focus and a transparent border for solid/ghost variants so native base rules cannot introduce unintended borders. Input: 32px desktop, visible focus and invalid state using aria-invalid, preserve type/ref/native props. Badge: semantic status variants replace hardcoded emerald/amber palettes while retaining existing API names. Clay/purple text must meet normal text contrast; do not blindly use decorative source colors as small text.

Build a development-only specimen showing all retained Button variants/sizes including link asChild, native form default behavior, Input default/disabled/invalid, Badge states, palette roles and font status. Visible state labels are specimen content only. No domain imports or fake product feature.

## Verification

Run `npm run build`. Serve the isolated worktree on a unique port; inspect specimen at desktop and 390px viewport. Verify computed primary color, control heights, focus visibility, disabled behavior, input invalid appearance, no accidental form submission, correct slotted link semantics and no horizontal overflow. Capture screenshots for Codex/Claude; if browser tools unavailable, report exactly and leave browser acceptance pending. Do not alter existing tests or snapshots to pass checks. No broad unrelated test fixes.

Return exact diff/file list, commands/results, screenshot paths, unavailable checks and remaining RV-01 scope. Do not commit or edit shared logs/ledger; coordinator records summary and commits after review. Stop and report if a required change exceeds these files.
