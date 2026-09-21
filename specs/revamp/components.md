# Component foundation plan

## Existing foundation and acquisition

Existing UI primitives use Radix, `cva`, `cn()` and Tailwind v4, with `@/` resolved to `src`. `components.json` is absent. Start with an inventory and deliberate shadcn configuration; preserve the current primitive base and local APIs. Do not run init with force/overwrite or replace all primitives during a visual reskin.

Official shadcn [component catalog](https://ui.shadcn.com/docs/components) and [semantic theming guidance](https://ui.shadcn.com/docs/theming) were checked on 2026-09-21. Use CSS-variable background/foreground pairs and components from the official registry before introducing custom primitives. During implementation use `npx shadcn@latest info --json`, `docs`, `search @shadcn`, and `add ... --dry-run`/`--diff`; record the resolved CLI/dependency versions and inspect generated files. New dependencies are handled by the foundation owner only. No opportunistic package upgrades.

## Token translation

Source values below are design evidence; implementation maps them to role-based variables in `src/styles.css`.

| Role | Source |
|---|---|
| Canvas / shell / panel / sunken | `#FFFFFF` / `#FBFAF7` / `#F7F5F1` / `#F2EFE9` |
| Main ink / body / secondary | `#16201D` / `#4A544F` / `#6B7671` |
| Primary / hover / pressed | `#0B5C54` / `#0A4E47` / `#083F3A` |
| Selected tint / edge | `#EAEFEC` / `#A8CBC5` |
| Branch/async / tint | `#7C5FC0` / `#F7F4FC` |
| Risk/destructive / tint | `#B4674A` / `#FBF1EA` |
| Dividers / control / hover border | `#E7E3DB` / `#DCD7CD` / `#C6C0B4` |
| Note / note edge | `#FBF6E8` / `#E6DAB8` |
| Tag/control/node/popover/card/dock radii | 4 / 7 / 9 / 11 / 12 / 14 px |
| Topbar / rail / control / nominal node | 50–54 / 44 / 32 / 176 px |
| UI / numeric metadata / display | IBM Plex Sans / IBM Plex Mono / Newsreader |

Use shadcn `primary` for action green; `accent` for an appropriate interaction tint, not the design export's overloaded raw `--accent` green alias. Define paired foregrounds and explicit warning/branch/node-kind roles. Do not let existing `--muted` prose color collide with shadcn's muted surface. Migrate legacy aliases deliberately and remove them only after checking consumers.

Use the supplied font families, preferably packaged locally with licenses and only used weights. Spline Sans is board annotation, not required app chrome. Monospace identifies measurements/units; it must not make all body copy tiny/uppercase. Fixed 176px nodes are a nominal style, not permission to truncate necessary fields or break expanded components.

Focus-ring tints, 9px metadata and low-contrast colors require actual testing; visual reference fidelity is not an accessibility exemption. Centralize any approved correction.

## Component map

| Design family | Foundation | Custom responsibility |
|---|---|---|
| Button, IconButton | existing Button | semantic variants, 32px control size, accessible icon label; wrapper only if useful |
| Tag, CountBadge, StatusDot, KeyHint | Badge; Kbd if acquired | status text and units; dot is decorative alongside label |
| TextInput, SearchField | Input, Textarea; Field/InputGroup if acquired | unit suffix, clear action, errors and description |
| Select, Checkbox, Radio, Toggle | Select/NativeSelect; existing Checkbox/RadioGroup/Switch | domain value adapters; no handmade popup keyboard logic |
| Stepper, Slider | Input + Button; Slider if acquired | clamping, empty/invalid draft state, keyboard steps |
| Tabs, Segmented | Tabs; ToggleGroup if acquired | distinguish navigation from a setting choice |
| Breadcrumb, RailItem | Breadcrumb if acquired; Button/Tooltip | project/branch identity and selected activity |
| Menu, Quick options | DropdownMenu; Command + Dialog if acquired | command registry and availability; no duplicate handlers |
| InlineAlert, EmptyState, Toast | Alert; Empty and suitable Radix toast integration if acquired | honest state-specific text |
| Meter | Progress if applicable | correct determinate/indeterminate meaning and units |
| Panel | ScrollArea, Tabs, DropdownMenu; Resizable if appropriate | placement reducer, drag targets, bounds, side stacks; not a Dialog while docked |
| LibraryRow/detail | Button, Badge, Popover/HoverCard | searchable data, focus/touch detail and place/save actions |
| Node, Boundary, StickyNote | XYFlow + local renderer; relevant Button/Badge/Input | handles, selection, runtime data and view metadata; no generic Card wrapper forced onto geometry |
| Dock | Button, ToggleGroup, Tooltip, Separator, Popover | command ordering/overflow and customization |
| Merge resolver/history | compositional Tabs/ScrollArea/Alert/Dialog controls | typed diff/conflict views; no generic text merge library as graph semantics |

## Foundation acceptance checklist

- No imports from domain/editor/persistence inside `ui/` primitives. Feature compositions accept typed values/events.
- Variants own appearance; screen `className` handles layout. Avoid repeated arbitrary palette/radius/typography overrides.
- Correct button type, ref forwarding/composition, controlled/uncontrolled behavior, disabled and loading behavior. No nested interactive elements.
- Field labels, error associations, focus-visible and accessible overlay title/description; expected Escape and outside-click behavior.
- Portal layering policy tested across floating panels, menus, tooltip, command dialog and modal confirmation. No ad hoc escalating z-index values per screen.
- Touch targets can exceed visual 32px boxes without obstructing adjacent controls; review actual spacing and hit areas.
- State variants visible with current global CSS; preserve needed native fallback styling while removing conflicting broad rules.
- One deterministic specimen surface for regression/review. Do not add a component-explorer framework unless its cost is justified.
- Dependencies, source provenance and deliberate upstream deviations recorded in the foundation review. Claude accepts this gate before downstream agents change appearances.
