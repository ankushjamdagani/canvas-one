/**
 * Machine interpreter.
 *
 * - One machine invocation = one event on an inbound port.
 * - Ordered transitions from current state; first match (fromStateId + eventPortId + guard) wins.
 * - Effects apply in order to a COPIED context:
 *   - assign
 *   - request-id (run-local root ID + monotonic counter, no clock/RNG)
 *   - emit (correlation 'current' | 'context-request' with non-empty string else modeled error)
 *   - reply (settles the initiating frame; double reply fails the run)
 *   - schedule-event (logical mode records 'timer-awaits-explicit-input')
 *   - trace
 * - The final context and emissions are validated atomically before state changes or anything is emitted.
 * - No transition matching -> no change (no implicit transitions).
 */

import type { Id, Json, MachineBehavior, Path, RecordField, Shape, TransportOutcome } from '@canvas-one/system-design/studio/model';
import { defaultEvaluator, readPath } from './expr.js';
import type { Evaluator } from './expr-api.js';
import { isMissing } from './expr-api.js';

/** Deep clones a JSON value to ensure context mutation isolation. */
export function deepCloneJson<T extends Json>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepCloneJson(v)) as unknown as T;
  }
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = deepCloneJson(v as Json);
  }
  return out as T;
}

/**
 * Validates a payload against a PayloadSchema Shape per the payload-schema rules.
 * Unknown record fields, non-finite numbers, and invalid nullability are rejected.
 */
export function validatePayloadShape(payload: unknown, shape: Shape): { ok: true } | { ok: false; reason: string } {
  if (payload === null) {
    if (shape.nullable) return { ok: true };
    return { ok: false, reason: 'Value is null but shape is not nullable' };
  }

  switch (shape.type) {
    case 'string':
      return typeof payload === 'string'
        ? { ok: true }
        : { ok: false, reason: `Expected string, got ${typeof payload}` };

    case 'boolean':
      return typeof payload === 'boolean'
        ? { ok: true }
        : { ok: false, reason: `Expected boolean, got ${typeof payload}` };

    case 'number':
      return typeof payload === 'number' && Number.isFinite(payload)
        ? { ok: true }
        : { ok: false, reason: `Expected finite number, got ${typeof payload}` };

    case 'integer':
      return typeof payload === 'number' && Number.isSafeInteger(payload)
        ? { ok: true }
        : { ok: false, reason: `Expected safe integer, got ${typeof payload}` };

    case 'scalar-union': {
      for (const t of shape.types) {
        if (t === 'string' && typeof payload === 'string') return { ok: true };
        if (t === 'boolean' && typeof payload === 'boolean') return { ok: true };
        if (t === 'number' && typeof payload === 'number' && Number.isFinite(payload)) return { ok: true };
        if (t === 'integer' && typeof payload === 'number' && Number.isSafeInteger(payload)) return { ok: true };
      }
      return { ok: false, reason: `Value does not match scalar-union types [${shape.types.join(', ')}]` };
    }

    case 'list': {
      if (!Array.isArray(payload)) {
        return { ok: false, reason: `Expected array, got ${typeof payload}` };
      }
      if (payload.length > shape.maxItems) {
        return { ok: false, reason: `Array length ${payload.length} exceeds maxItems ${shape.maxItems}` };
      }
      for (let i = 0; i < payload.length; i++) {
        const itemRes = validatePayloadShape(payload[i], shape.items);
        if (!itemRes.ok) {
          return { ok: false, reason: `Item at index ${i}: ${itemRes.reason}` };
        }
      }
      return { ok: true };
    }

    case 'record': {
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { ok: false, reason: `Expected record object, got ${payload === null ? 'null' : typeof payload}` };
      }
      const rec = payload as Record<string, unknown>;
      const fieldMap = new Map<string, RecordField>();
      for (const f of shape.fields) {
        fieldMap.set(f.key, f);
      }

      // Check unknown fields:
      for (const key of Object.keys(rec)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          return { ok: false, reason: `Forbidden prototype key '${key}'` };
        }
        if (!fieldMap.has(key)) {
          return { ok: false, reason: `Unknown field '${key}' in record` };
        }
      }

      // Check required fields & field types:
      for (const f of shape.fields) {
        if (!(f.key in rec)) {
          if (!f.optional) {
            return { ok: false, reason: `Missing required field '${f.key}'` };
          }
        } else {
          const val = rec[f.key];
          const valRes = validatePayloadShape(val, f.shape);
          if (!valRes.ok) {
            return { ok: false, reason: `Field '${f.key}': ${valRes.reason}` };
          }
        }
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: `Unknown shape type: ${(shape as { type: string }).type}` };
  }
}

/**
 * Sets a value at a Path in context, returning a new cloned context without mutating the input.
 */
export function setPathInContext(
  context: Json,
  path: Path,
  value: Json,
): { ok: true; context: Json } | { ok: false; error: string } {
  if (path.length === 0) {
    return { ok: true, context: value };
  }
  if (context === null || typeof context !== 'object') {
    return { ok: false, error: 'Cannot set path in non-object context' };
  }

  const root = deepCloneJson(context);
  let current: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i];
    if (step === '__proto__' || step === 'prototype' || step === 'constructor') {
      return { ok: false, error: `Forbidden key: ${String(step)}` };
    }
    if (current === null || typeof current !== 'object') {
      return { ok: false, error: 'Intermediate path element is not an object' };
    }
    if (Array.isArray(current)) {
      if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step >= current.length) {
        return { ok: false, error: `Array index out of bounds: ${String(step)}` };
      }
      current = current[step];
    } else {
      if (typeof step !== 'string') {
        return { ok: false, error: `Expected string key for object, got ${typeof step}` };
      }
      if (!(step in current) || current[step] === null || typeof current[step] !== 'object') {
        current[step] = typeof path[i + 1] === 'number' ? [] : {};
      }
      current = current[step];
    }
  }

  const lastStep = path[path.length - 1];
  if (lastStep === '__proto__' || lastStep === 'prototype' || lastStep === 'constructor') {
    return { ok: false, error: `Forbidden key: ${String(lastStep)}` };
  }
  if (Array.isArray(current)) {
    if (typeof lastStep !== 'number' || !Number.isInteger(lastStep) || lastStep < 0) {
      return { ok: false, error: `Invalid array index: ${String(lastStep)}` };
    }
    current[lastStep] = value;
  } else {
    if (typeof lastStep !== 'string') {
      return { ok: false, error: `Invalid object key: ${typeof lastStep}` };
    }
    current[lastStep] = value;
  }

  return { ok: true, context: root };
}

export type MachineEmission = {
  readonly portId: Id;
  readonly value: Json;
  readonly correlationRequestId: string;
};

export type MachineReply = {
  readonly value: Json;
  readonly outcome: TransportOutcome;
};

export type MachineStepSuccess = {
  readonly ok: true;
  readonly matched: boolean;
  readonly transitionId: Id | null;
  readonly fromStateId: Id;
  readonly toStateId: Id;
  readonly context: Json;
  readonly emissions: readonly MachineEmission[];
  readonly replies: readonly MachineReply[];
  readonly traces: readonly string[];
};

export type MachineStepFailure = {
  readonly ok: false;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly stateId: Id;
  readonly context: Json; // unchanged context on atomic rollback
};

export type MachineStepResult = MachineStepSuccess | MachineStepFailure;

export type MachineStepOptions = {
  readonly machine: MachineBehavior;
  readonly currentStateId: Id;
  readonly currentContext: Json;
  readonly eventPortId: Id;
  readonly payload: Json;
  readonly rootId: string;
  readonly currentRequestId?: string | null;
  readonly outcome?: TransportOutcome | null;
  readonly nextRequestIdCounter: () => number;
  readonly evaluator?: Evaluator;
  readonly contextSchema?: Shape | null;
  readonly portSchemas?: ReadonlyMap<Id, Shape>;
};

/**
 * Executes a single event invocation on a state machine.
 */
export function stepMachine(options: MachineStepOptions): MachineStepResult {
  const {
    machine,
    currentStateId,
    currentContext,
    eventPortId,
    payload,
    rootId,
    currentRequestId,
    outcome = null,
    nextRequestIdCounter,
    evaluator = defaultEvaluator,
    contextSchema,
    portSchemas,
  } = options;

  // Find first matching transition from currentStateId on eventPortId
  let matchedTransition = null;
  for (const transition of machine.transitions) {
    if (transition.fromStateId !== currentStateId) continue;
    if (transition.eventPortId !== eventPortId) continue;

    if (transition.guard !== null) {
      const guardRes = evaluator.evalGuard(transition.guard, {
        input: payload,
        context: currentContext,
        outcome,
      });
      if (!guardRes.ok || !guardRes.value) {
        continue;
      }
    }
    matchedTransition = transition;
    break;
  }

  // No match -> no change
  if (!matchedTransition) {
    return {
      ok: true,
      matched: false,
      transitionId: null,
      fromStateId: currentStateId,
      toStateId: currentStateId,
      context: currentContext,
      emissions: [],
      replies: [],
      traces: [],
    };
  }

  // Copy context before applying effects in order
  let workingContext = deepCloneJson(currentContext);
  const emissions: MachineEmission[] = [];
  const replies: MachineReply[] = [];
  const traces: string[] = [];
  let hasReplied = false;

  for (const effect of matchedTransition.effects) {
    switch (effect.kind) {
      case 'assign': {
        const valRes = evaluator.evalValue(effect.value, {
          input: payload,
          context: workingContext,
          outcome,
        });
        if (!valRes.ok) {
          return {
            ok: false,
            errorCode: valRes.error.code,
            errorMessage: valRes.error.message,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            errorCode: 'assign-missing-value',
            errorMessage: `Cannot assign missing value at path '${effect.path.join('.')}'`,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        const setRes = setPathInContext(workingContext, effect.path, valRes.value);
        if (!setRes.ok) {
          return {
            ok: false,
            errorCode: 'assign-path-error',
            errorMessage: setRes.error,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        workingContext = setRes.context;
        break;
      }

      case 'request-id': {
        const counter = nextRequestIdCounter();
        const generatedId = `${rootId}:${counter}`;
        const setRes = setPathInContext(workingContext, effect.path, generatedId);
        if (!setRes.ok) {
          return {
            ok: false,
            errorCode: 'request-id-path-error',
            errorMessage: setRes.error,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        workingContext = setRes.context;
        break;
      }

      case 'emit': {
        const valRes = evaluator.evalValue(effect.value, {
          input: payload,
          context: workingContext,
          outcome,
        });
        if (!valRes.ok) {
          return {
            ok: false,
            errorCode: valRes.error.code,
            errorMessage: valRes.error.message,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            errorCode: 'emit-missing-value',
            errorMessage: 'Emit payload evaluated to missing value',
            stateId: currentStateId,
            context: currentContext,
          };
        }

        let correlationId: string;
        if (effect.correlation.kind === 'current') {
          if (!currentRequestId || typeof currentRequestId !== 'string' || currentRequestId.length === 0) {
            return {
              ok: false,
              errorCode: 'missing-correlation',
              errorMessage: 'Current correlation request ID is missing or empty',
              stateId: currentStateId,
              context: currentContext,
            };
          }
          correlationId = currentRequestId;
        } else {
          // context-request
          const readVal = readPath(workingContext, effect.correlation.path);
          if (isMissing(readVal) || typeof readVal !== 'string' || readVal.length === 0) {
            return {
              ok: false,
              errorCode: 'invalid-context-correlation',
              errorMessage: `Correlation at path '${effect.correlation.path.join('.')}' must be a non-empty string`,
              stateId: currentStateId,
              context: currentContext,
            };
          }
          correlationId = readVal;
        }

        emissions.push({
          portId: effect.portId,
          value: valRes.value,
          correlationRequestId: correlationId,
        });
        break;
      }

      case 'reply': {
        if (hasReplied) {
          return {
            ok: false,
            errorCode: 'double-reply',
            errorMessage: 'Double reply in transition effects fails the run',
            stateId: currentStateId,
            context: currentContext,
          };
        }
        hasReplied = true;
        const valRes = evaluator.evalValue(effect.value, {
          input: payload,
          context: workingContext,
          outcome,
        });
        if (!valRes.ok) {
          return {
            ok: false,
            errorCode: valRes.error.code,
            errorMessage: valRes.error.message,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            errorCode: 'reply-missing-value',
            errorMessage: 'Reply payload evaluated to missing value',
            stateId: currentStateId,
            context: currentContext,
          };
        }
        replies.push({
          value: valRes.value,
          outcome: effect.outcome,
        });
        break;
      }

      case 'schedule-event': {
        const valRes = evaluator.evalValue(effect.value, {
          input: payload,
          context: workingContext,
          outcome,
        });
        if (!valRes.ok) {
          return {
            ok: false,
            errorCode: valRes.error.code,
            errorMessage: valRes.error.message,
            stateId: currentStateId,
            context: currentContext,
          };
        }
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            errorCode: 'schedule-event-missing-value',
            errorMessage: 'Schedule-event value evaluated to missing value',
            stateId: currentStateId,
            context: currentContext,
          };
        }
        // Logical mode records 'timer-awaits-explicit-input'
        traces.push('timer-awaits-explicit-input');
        break;
      }

      case 'trace': {
        traces.push(effect.code);
        break;
      }

      default:
        return {
          ok: false,
          errorCode: 'unknown-effect-kind',
          errorMessage: `Unknown effect kind '${(effect as { kind?: string }).kind}'`,
          stateId: currentStateId,
          context: currentContext,
        };
    }
  }

  // Atomic validation of final context and all emissions before state or context changes
  if (contextSchema) {
    const cRes = validatePayloadShape(workingContext, contextSchema);
    if (!cRes.ok) {
      return {
        ok: false,
        errorCode: 'context-schema-mismatch',
        errorMessage: `Final context failed schema validation: ${cRes.reason}`,
        stateId: currentStateId,
        context: currentContext,
      };
    }
  }

  if (portSchemas) {
    for (const em of emissions) {
      const pSchema = portSchemas.get(em.portId);
      if (pSchema) {
        const emRes = validatePayloadShape(em.value, pSchema);
        if (!emRes.ok) {
          return {
            ok: false,
            errorCode: 'emission-schema-mismatch',
            errorMessage: `Emission on port '${em.portId}' failed schema validation: ${emRes.reason}`,
            stateId: currentStateId,
            context: currentContext,
          };
        }
      }
    }
  }

  // Atomic commit: state changes to toStateId, context is updated
  return {
    ok: true,
    matched: true,
    transitionId: matchedTransition.id,
    fromStateId: currentStateId,
    toStateId: matchedTransition.toStateId,
    context: Object.freeze(workingContext),
    emissions: Object.freeze(emissions),
    replies: Object.freeze(replies),
    traces: Object.freeze(traces),
  };
}
