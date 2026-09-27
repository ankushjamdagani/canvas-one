/**
 * Public surface of the scenarios feature module (RV-05c).
 *
 * Self-contained: not wired into Workspace.tsx/TopBar.tsx (another lane owns the
 * shell). See ScenariosPreview.tsx for a standalone visual harness.
 *
 * `mockDocument.ts` (a deterministic counter-based UUID minter + a small sample
 * Document) is intentionally NOT exported here -- review round: it exists strictly for
 * `draft.test.ts` and `ScenariosPreview.tsx` (both import it directly by file path),
 * never for production code.
 */

export * from './types';
export * from './budgets';
export * from './idRemap';
export * from './draft';
export * from './draftScenario';
export * from './pickers';

export { ScenarioSwitcher } from './ScenarioSwitcher';
export type { ScenarioSwitcherEntry, ScenarioSwitcherProps, ScenarioSwitcherRunPhase } from './ScenarioSwitcher';

export { NewScenarioDialog } from './NewScenarioDialog';
export type { CopySourceOption, NewScenarioDialogProps } from './NewScenarioDialog';

export { DeleteScenarioDialog } from './DeleteScenarioDialog';
export type { DeleteScenarioDialogProps } from './DeleteScenarioDialog';

export { ScenarioEditor } from './ScenarioEditor';
export type { ScenarioEditorProps } from './ScenarioEditor';

export { TrafficSection } from './TrafficSection';
export { StepsSection } from './StepsSection';
export { FaultsSection } from './FaultsSection';
export { BoundariesSection } from './BoundariesSection';
export { AssertionsSection } from './AssertionsSection';
