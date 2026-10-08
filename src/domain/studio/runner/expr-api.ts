/**
 * Value/Guard evaluation interface.
 *
 * Shared seam between the machine interpreter, which implements it in
 * `runner/expr.ts`, and the pipeline operations, whose `map`/`filter`
 * operations take an evaluator through this interface instead of re-implementing one.
 */

import type { Guard, Json, Path, Value } from '../model';
import type { TransportOutcome } from './types';

/**
 * A read that found nothing. Only a guard's `exists` can test it. Branded with a
 * module-private symbol so no JSON payload can ever be mistaken for it.
 */
const MISSING: unique symbol = Symbol('studio.missing');
export type MissingValue = { readonly [MISSING]: true; readonly path: Path };

export type EvalResult = Json | MissingValue;

export function missingValue(path: Path): MissingValue {
  return Object.freeze({ [MISSING]: true as const, path: Object.freeze([...path]) });
}

export function isMissing(value: EvalResult): value is MissingValue {
  return typeof value === 'object' && value !== null && MISSING in value;
}

/**
 * Evaluation scope. `input` is the triggering payload (or the current row/item);
 * `context` is the machine context (empty object for pipeline rows);
 * `outcome` is the current invocation's transport outcome, or null before settlement.
 */
export type EvalScope = {
  readonly input: Json;
  readonly context: Json;
  readonly outcome: TransportOutcome | null;
};

/** A modeled evaluation error (e.g. wrong type for `positiveInteger`); traced, never thrown. */
export type EvalError = { readonly code: string; readonly path: Path; readonly message: string };

export type ValueOutcome = { readonly ok: true; readonly value: EvalResult } | { readonly ok: false; readonly error: EvalError };
export type GuardOutcome = { readonly ok: true; readonly value: boolean } | { readonly ok: false; readonly error: EvalError };

export interface Evaluator {
  evalValue(value: Value, scope: EvalScope): ValueOutcome;
  evalGuard(guard: Guard, scope: EvalScope): GuardOutcome;
}
