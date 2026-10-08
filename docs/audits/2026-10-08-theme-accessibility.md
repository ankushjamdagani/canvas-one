# Theme colour and interaction audit

All 14 schemes now appear in one continuous list. Every scheme was reviewed in light and dark mode.

## Coverage

- Production landing, projects, and populated S05 workspace: resting text, hovered theme tool, selected palette/mode, palette hover, keyboard focus and focus return.
- Projects: primary creation card hover, populated/focused name field.
- Workspace: current branch and creation form, Library picker/grid/list/hover details, History, selected node/inspector, all six note tones, scenario menu, selected mode in scenario creation, paused recording, traffic inspection focus and selected request cycle.
- Every variant at 320px: contained scrolling theme menu and visible header control.
- Native Storybook interaction specimen: all seven button variants at hover, pressed and keyboard focus; badges, regular/invalid fields, checked/mixed checkboxes, selected toggle, segmented modes, radio dot and both switch positions. Disabled controls retain their separate unavailable treatment.

The 28 combinations are Evergreen, Slate, Ochre, Terracotta, Sage, Triad, One hue, Achromatic, Cyanotype, Nocturne, Lichen, Lavender, Pistachio and Saffron, each in light and dark.

## Corrections

Shared mappings now separate accent fills from readable accent, action, branch and risk text. Runtime luminance adjustments preserve palette hues where possible and ensure normal text reaches 4.5:1 on its supported surfaces; pressed/hovered action fills retain their foreground contrast. Strong field boundaries and focus roles reach at least 3:1. The original supplied palette data remains unchanged.

Selected badges, menus, Library rows, dock controls, scenario rows and full processing cells use accent foreground. Library fields/cards use theme surfaces. Primary/destructive actions and messages use the matching foreground role. Radio dots, switch thumbs, selected canvas edges/ports/notes and traffic focus remain visible in fluorescent themes. Link hover retains readable text with an underline. Note toolbar labels no longer fade below their contrast target. Text selection uses a paired accent fill/foreground.

The shared class merger now recognizes the six custom typography sizes. Previously `text-micro` removed a badge's risk text colour, leaving an inherited branch colour on the risk background in the phone header.

## Verification

- 1,941 unit tests passed; 11 skipped. Authored palette reconciliation and all generated text/state roles are covered.
- Production and Storybook builds passed.
- Native control audit: all 28 variants, 784 computed contrast measurements and 28 resting axe contrast scans; zero failures. Measurements wait for colour transitions to settle.
- Final complete isolated production run: 196 passed, four dev-only skips, no failures or retries (5.6 minutes). All 28 expanded theme journeys passed.
- Independent source review has no unresolved findings. Desktop and phone screenshots inspected.

This is a colour/state audit of the listed routes and interactions, not a certification of every WCAG criterion or every possible authored graph.

Criteria: [WCAG text contrast](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html). Evidence logs and the native-control probe remain in ignored `.delegate/`; repeatable production journeys live in `tests/theme-accessibility.spec.ts`, and the control specimen is `UI/ThemeSwitcher → Theme interaction states`.

## Animated landing proposal follow-up

Follow-up preference: Claude's header avatar, prompt submit icon and cursor labels now consistently use white. `--branch-solid` adjusts the fill luminance to reach 4.5:1 with white, preserving the branch hue and original raw palette data. This supersedes the earlier automatic black/white foreground choice for these elements.

Verification of this preference: all 28 production browser variants passed with explicit white foreground assertions and contrast checks, 74 theme unit tests passed, and production build passed.

The supplied screenshot exposed a gap: the initial landing scan did not reach the later proposal/note state. Landing CSS replaced Accept's shared primary fill with foreground ink while retaining the primary foreground; branch-filled avatars, send icon and collaborator labels reused the action foreground. These now use shared primary states and a separately contrast-corrected `--branch-foreground`. Prompt copy uses readable branch text; landing keyboard focus uses the corrected ring role, and Dismiss uses the strong control boundary.

`tests/landing-theme-states.spec.ts` waits for the proposal and note, pauses the demo, checks all 28 palette/mode combinations at rest/hover/pressed/focus, and explicitly measures collaborator labels, button/icon pairs and focus contrast. This includes the visually visible but aria-hidden demo cursor labels. Final isolated production confirmation: 40 passed, including all 28 strengthened proposal journeys plus theme persistence/menu and landing-transition regressions; no failures or retries. The 74 theme unit tests and production/Storybook builds passed. The whole-app 196-test result above predates this scoped follow-up.
