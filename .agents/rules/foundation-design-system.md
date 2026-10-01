---
trigger: always_on
description: Foundation-first design system rule for UI and styling changes.
---

## Foundation-First Design System Rule

`src/components/ui/` (41 foundational components) and `src/styles.css` (design tokens) are the core and single source of truth for the entire application's user interface.

### The Rule
Whenever a UI or visual change is requested (e.g. modifying borders, radii, surface colors, elevation shadows, typography, padding, or interaction states):

1. **Check the Foundation First**:
   - Determine if the change applies to a shared primitive (e.g. `Button`, `Dialog`, `Popover`, `Input`, `DropdownMenu`, `Card`, `Badge`) or a global design token.
   - If the visual update represents a systemic design refinement, **update the foundation component in `src/components/ui/<component>.tsx` or the token in `src/styles.css`** rather than applying ad-hoc Tailwind overrides at the feature level (`src/features/*`).
   - Updating the foundation ensures all consuming views across the application (Workspace, Scenario runner, Library, Export, History) are harmonized simultaneously without UI drift.

2. **No Ad-Hoc Utility Overrides in Feature Code**:
   - Feature components in `src/features/*` must orchestrate layout and domain logic—they must not fight or re-style foundation primitives with bespoke background, border, or shadow overrides.
   - If a new variant or size is genuinely required, add it as a typed variant or prop in the foundation component with CVA (`class-variance-authority`).

3. **Verify with Storybook**:
   - After updating any foundation component or design token, verify its appearance across all variants and states in Storybook (`npm run build-storybook` or local Storybook preview).
   - When adding new components or composite patterns, provide corresponding stories in `src/stories/ui/` or `src/stories/patterns/`.
