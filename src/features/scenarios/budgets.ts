/**
 * Contracted scenario budget defaults (RV-05c).
 *
 * specs/revamp/contracts/storage.md §6 "Run defaults / maxima": "events 100k / 1M;
 * trace rows 10k / 100k; trace+payload bytes 4 / 16 MiB; live scheduled events 100k;
 * simultaneous roots 10k." Read as default/maximum pairs for the first three, and as a
 * single default-equals-maximum figure for the last two (matching the maxima
 * `src/domain/studio/validate.ts`'s `validateScenarioBudgets` already enforces:
 * maxScheduledEvents <= 100000, maxLiveRoots <= 10000). commands.md §6 "Empty drafts
 * invent nothing": "the only prefilled values are the contracted budget defaults
 * (storage.md §6) ... and a seed drawn at random."
 */

import type { ScenarioBudgets } from '../../domain/studio/model';

const MIB = 1048576;

export const DEFAULT_SCENARIO_BUDGETS: ScenarioBudgets = Object.freeze({
  maxEvents: 100000,
  maxTraceRows: 10000,
  maxTraceBytes: 4 * MIB,
  maxScheduledEvents: 100000,
  maxLiveRoots: 10000,
});

/** storage.md §6: scenario seed is validated as a uint32 (0-4294967295). */
export const SCENARIO_SEED_MAX = 4294967295;

/** Draws a scenario seed uniformly from the valid uint32 range via an injected random source. */
export function drawSeed(randomSource: () => number): number {
  return Math.floor(randomSource() * (SCENARIO_SEED_MAX + 1));
}
