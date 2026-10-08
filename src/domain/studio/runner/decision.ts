/**
 * Decision behavior interpreter.
 *
 * Evaluates cases in order with the Evaluator; the first matching case emits its value
 * on its output port, otherwise the fallback applies. Exactly one output is picked, and
 * each value is validated against its port schema (a mismatch is a modeled error).
 */

import type {
  DecisionBehavior,
  Document,
  Element,
  Endpoint,
  Id,
  Json,
  PayloadSchema,
  Shape,
  TransportOutcome,
} from '../model';
import type { Evaluator, EvalScope } from './expr-api';
import { isMissing } from './expr-api';
import { defaultEvaluator } from './expr';
import { validateSchemaValue } from './schema-value';
import type { Issue } from './types';

// ============================================================================
// Public Result Types
// ============================================================================

export type DecisionEmission = {
  readonly portId: Id;
  readonly port: Endpoint;
  readonly value: Json;
  readonly matchedCaseId: Id | null;
};

export type DecisionSuccessResult = {
  readonly ok: true;
  readonly status: 'succeeded';
  readonly emission: DecisionEmission;
};

export type DecisionFailureResult = {
  readonly ok: false;
  readonly status: 'failed';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly issues?: readonly Issue[];
};

export type DecisionResult = DecisionSuccessResult | DecisionFailureResult;

export type RunDecisionOptions = {
  readonly evaluator?: Evaluator;
  readonly schemas?: ReadonlyMap<Id, Shape | PayloadSchema> | readonly PayloadSchema[];
  readonly context?: Json;
  readonly outcome?: TransportOutcome | null;
  readonly doc?: Document;
};

// ============================================================================
// Decision Runner
// ============================================================================

/**
 * Runs a decision element over an input payload.
 *
 * Evaluates cases in order with the Evaluator:
 * - The first matching case emits its value on its output port;
 * - If no case matches, the fallback emits its value on its output port;
 * - Exactly one output is selected;
 * - The output value is validated against its port schema (mismatch is a modeled error).
 */
export function runDecision(
  decisionElement: Element,
  inputPayload: Json,
  options: RunDecisionOptions = {},
): DecisionResult {
  if (decisionElement.behavior.kind !== 'decision') {
    return {
      ok: false,
      status: 'failed',
      errorCode: 'invalid-behavior',
      errorMessage: `Element '${decisionElement.id}' has behavior kind '${decisionElement.behavior.kind}', expected 'decision'`,
    };
  }

  const behavior = decisionElement.behavior as DecisionBehavior;
  const evaluator = options.evaluator ?? defaultEvaluator;
  const scope: EvalScope = {
    input: inputPayload,
    context: options.context ?? {},
    outcome: options.outcome ?? null,
  };

  let matchedCaseId: Id | null = null;
  let targetOutputPortId: Id | null = null;
  let rawValue: Json | null = null;

  // Evaluate cases in authored order; first match wins
  for (const c of behavior.cases) {
    const guardRes = evaluator.evalGuard(c.guard, scope);
    if (!guardRes.ok) {
      return {
        ok: false,
        status: 'failed',
        errorCode: guardRes.error.code,
        errorMessage: guardRes.error.message,
      };
    }

    if (guardRes.value) {
      matchedCaseId = c.id;
      targetOutputPortId = c.outputPortId;
      const valRes = evaluator.evalValue(c.value, scope);
      if (!valRes.ok) {
        return {
          ok: false,
          status: 'failed',
          errorCode: valRes.error.code,
          errorMessage: valRes.error.message,
        };
      }
      if (isMissing(valRes.value)) {
        return {
          ok: false,
          status: 'failed',
          errorCode: 'decision-missing-value',
          errorMessage: `Case '${c.id}' value evaluated to missing value`,
        };
      }
      rawValue = valRes.value as Json;
      break;
    }
  }

  // If no case matched, evaluate fallback
  if (targetOutputPortId === null) {
    targetOutputPortId = behavior.fallback.outputPortId;
    const valRes = evaluator.evalValue(behavior.fallback.value, scope);
    if (!valRes.ok) {
      return {
        ok: false,
        status: 'failed',
        errorCode: valRes.error.code,
        errorMessage: valRes.error.message,
      };
    }
    if (isMissing(valRes.value)) {
      return {
        ok: false,
        status: 'failed',
        errorCode: 'decision-missing-value',
        errorMessage: 'Fallback value evaluated to missing value',
      };
    }
    rawValue = valRes.value as Json;
  }

  // Find the selected output port on the element
  const outPort = decisionElement.ports.find((p) => p.id === targetOutputPortId);
  if (!outPort) {
    return {
      ok: false,
      status: 'failed',
      errorCode: 'port-not-found',
      errorMessage: `Output port '${targetOutputPortId}' not found on decision element '${decisionElement.id}'`,
    };
  }

  // Validate the value against the output port's schema
  let shape: Shape | undefined;
  if (options.schemas) {
    if (options.schemas instanceof Map) {
      const entry = options.schemas.get(outPort.schemaId);
      shape = entry ? ('shape' in entry ? entry.shape : entry) : undefined;
    } else if (Array.isArray(options.schemas)) {
      const entry = options.schemas.find((s) => s.id === outPort.schemaId);
      shape = entry?.shape;
    }
  } else if (options.doc) {
    const entry = options.doc.schemas.find((s) => s.id === outPort.schemaId);
    shape = entry?.shape;
  }

  if (shape) {
    const valRes = validateSchemaValue(rawValue, shape, [], outPort.schemaId);
    if (!valRes.ok) {
      return {
        ok: false,
        status: 'failed',
        errorCode: 'schema-mismatch',
        errorMessage: `Decision output value failed schema validation on port '${outPort.id}': ${valRes.issues.map((i) => i.message).join('; ')}`,
        issues: valRes.issues,
      };
    }
  }

  return {
    ok: true,
    status: 'succeeded',
    emission: {
      portId: targetOutputPortId,
      port: {
        elementId: decisionElement.id,
        portId: targetOutputPortId,
      },
      value: rawValue!,
      matchedCaseId,
    },
  };
}
