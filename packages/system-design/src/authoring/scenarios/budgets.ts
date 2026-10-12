/**
 * Default scenario budgets.
 *
 * Defaults: events 100k, trace rows 10k, trace+payload bytes 4 MiB, live scheduled
 * events 100k, simultaneous roots 10k. The last two equal the maxima that
 * `validateScenarioBudgets` in `src/domain/studio/validate.ts` enforces
 * (maxScheduledEvents <= 100000, maxLiveRoots <= 10000). A new draft prefills
 * only these defaults and a randomly drawn seed.
 */

import type { ScenarioBudgets } from '../../studio/model.js';

const MIB = 1048576;

export const DEFAULT_SCENARIO_BUDGETS: ScenarioBudgets = Object.freeze({
  maxEvents: 100000,
  maxTraceRows: 10000,
  maxTraceBytes: 4 * MIB,
  maxScheduledEvents: 100000,
  maxLiveRoots: 10000,
});

/** Scenario seeds are validated as a uint32 (0-4294967295). */
export const SCENARIO_SEED_MAX = 4294967295;

/** Draws a scenario seed uniformly from the valid uint32 range via an injected random source. */
export function drawSeed(randomSource: () => number): number {
  return Math.floor(randomSource() * (SCENARIO_SEED_MAX + 1));
}
