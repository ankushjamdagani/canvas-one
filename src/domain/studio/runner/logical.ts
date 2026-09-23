/**
 * Logical-mode runner for machine + boundary scenarios (RV-14b).
 *
 * Implements specs/revamp/contracts/model-and-runner.md:
 * - §4 Behaviors: machine, values and guards, transitions and effects, wiring
 * - §5 Invocation semantics: root accounting, control promotion, outcome precedence
 * - §6 Logical mode: external inputs consumed in declared order after causal queue drains,
 *   boundaries and response matching with payloadBindings & afterInputId, quiescent completion.
 * - §8 TraceRecorder integration with row/byte and maxEvents budgets.
 * - §9 RunSummary and CheckResult.
 * - Scope: machine, boundary, and unmodeled behaviors only. Other reachable kinds return
 *   status 'invalid' with 'unsupported-behavior-rv14b'.
 */

import type {
  Boundary,
  BoundaryResponse,
  Document,
  Endpoint,
  Id,
  Input,
  Json,
  MachineBehavior,
  PayloadSchema,
  Port,
  Scenario,
  Shape,
  TransportOutcome,
} from '../model';
import type { CheckResult, Counts, RunSummary, TerminalStatus, TraceEvent } from './types';
import { rootId, TraceRecorder } from './trace';
import { defaultEvaluator, readPath } from './expr';
import { isMissing } from './expr-api';
import { deepCloneJson, setPathInContext, stepMachine, validatePayloadShape } from './machine';
import { evaluateAssertions } from './assertions';

export type LogicalRunResult = {
  readonly status: TerminalStatus;
  readonly events: readonly TraceEvent[];
  readonly summary: RunSummary;
  readonly checks: readonly CheckResult[];
  readonly reason: string | null;
};

type HeldResponse = {
  readonly response: BoundaryResponse;
  readonly payload: Json;
  readonly callPortId: Id;
  readonly correlationRequestId: string;
  readonly initiatingFrameId: string;
  readonly machineElementId: Id;
  readonly rootId: string;
  readonly journeyId: Id;
};

type MutableCounts = {
  generated: number;
  succeeded: number;
  rejected: number;
  failed: number;
  expired: number;
  inFlight: number;
};

type CausalEvent = {
  readonly kind: 'boundary-response';
  readonly held: HeldResponse;
};

/**
 * Runs a logical scenario to completion or budget exhaustion.
 */
export async function runLogicalScenario(
  document: Document,
  scenarioId: Id,
  runId: string,
): Promise<LogicalRunResult> {
  const scenario = document.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    return makeTerminalResult('invalid', [], makeEmptySummary('logical', []), [], 'Scenario not found');
  }

  if (scenario.mode !== 'logical') {
    return makeTerminalResult('invalid', [], makeEmptySummary(scenario.mode, scenario.scopeElementIds), [], 'Scenario mode is not logical');
  }

  const activeScenario: Scenario = scenario;

  // Pre-index document schemas, fixtures, elements, and ports
  const schemasMap = new Map<Id, PayloadSchema>(document.schemas.map((s) => [s.id, s]));
  const fixturesMap = new Map<Id, Json>(document.fixtures.map((f) => [f.id, f.value]));
  const elementsMap = new Map<Id, (typeof document.elements)[number]>(document.elements.map((e) => [e.id, e]));
  const portsMap = new Map<Id, Port>();
  for (const el of document.elements) {
    for (const p of el.ports) {
      portsMap.set(p.id, p);
    }
  }

  // Scope check: only machine/boundary/unmodeled behaviors are in scope (§6 & brief)
  for (const elId of activeScenario.scopeElementIds) {
    const el = elementsMap.get(elId);
    if (!el) continue;
    if (el.behavior.kind !== 'machine' && el.behavior.kind !== 'unmodeled') {
      return makeTerminalResult(
        'invalid',
        [],
        makeEmptySummary('logical', activeScenario.scopeElementIds),
        [],
        `unsupported-behavior-rv14b: element '${elId}' has unsupported behavior kind '${el.behavior.kind}'`,
      );
    }
  }

  // Also check reachable connected elements from scope
  for (const conn of document.connections) {
    if (activeScenario.scopeElementIds.includes(conn.source.elementId)) {
      const tgtEl = elementsMap.get(conn.target.elementId);
      if (tgtEl && tgtEl.behavior.kind !== 'machine' && tgtEl.behavior.kind !== 'unmodeled') {
        return makeTerminalResult(
          'invalid',
          [],
          makeEmptySummary('logical', activeScenario.scopeElementIds),
          [],
          `unsupported-behavior-rv14b: connected element '${tgtEl.id}' has unsupported behavior kind '${tgtEl.behavior.kind}'`,
        );
      }
    }
  }

  // Initialize budgets and trace recorder
  const budgets = activeScenario.budgets;
  const recorder = new TraceRecorder(runId, {
    maxTraceRows: budgets.maxTraceRows,
    maxTraceBytes: budgets.maxTraceBytes,
  });

  // Initialize machine states & contexts
  const machineStates = new Map<Id, { stateId: Id; context: Json }>();
  for (const elId of activeScenario.scopeElementIds) {
    const el = elementsMap.get(elId);
    if (!el || el.behavior.kind !== 'machine') continue;
    const mb = el.behavior as MachineBehavior;

    // Check scenario initial context override, else initialContextFixtureId
    const scContext = activeScenario.initialContexts.find((ic) => ic.elementId === elId);
    let ctxFixture: Json | undefined;
    if (scContext) {
      ctxFixture = fixturesMap.get(scContext.fixtureId);
    } else {
      ctxFixture = fixturesMap.get(mb.initialContextFixtureId);
    }
    const initialContext = ctxFixture !== undefined ? deepCloneJson(ctxFixture) : {};
    machineStates.set(elId, {
      stateId: mb.initialStateId,
      context: initialContext,
    });
  }

  // Runner state
  let processedEvents = 0;
  let consumedInputs = 0;
  let requestIdCounter = 0;
  let frameCounter = 0;

  const rootCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };

  // Open call frames: frameId -> { userRootId: string | null }
  const openFrames = new Map<string, { userRootId: string | null }>();
  // Active user roots: rootId -> { openFrameCount: number, outcomes: TransportOutcome[] }
  const activeUserRoots = new Map<string, { openFrameCount: number; outcomes: TransportOutcome[] }>();

  // Port outputs tracking: "elementId:portId" -> { port, values }
  const outputsMap = new Map<string, { port: Endpoint; values: Json[] }>();
  // Emissions index for input bindings: "elementId:portId:journeyId" -> Json[]
  const emissionsByPortAndJourney = new Map<string, Json[]>();

  // Boundary responses tracking: used response IDs
  const usedBoundaryResponseIds = new Set<Id>();
  // Held boundary responses waiting for an afterInputId to finish
  const heldBoundaryResponses: HeldResponse[] = [];
  // Internal causal FIFO queue
  const causalQueue: CausalEvent[] = [];
  // Set of finished input IDs
  const finishedInputIds = new Set<Id>();

  function recordPortEmission(port: Endpoint, journeyId: Id, payload: Json): void {
    const portKey = `${port.elementId}:${port.portId}`;
    let portOut = outputsMap.get(portKey);
    if (!portOut) {
      portOut = { port, values: [] };
      outputsMap.set(portKey, portOut);
    }
    portOut.values.push(payload);

    const journeyKey = `${port.elementId}:${port.portId}:${journeyId}`;
    let journeyList = emissionsByPortAndJourney.get(journeyKey);
    if (!journeyList) {
      journeyList = [];
      emissionsByPortAndJourney.set(journeyKey, journeyList);
    }
    journeyList.push(deepCloneJson(payload));
  }

  function settleFrame(frameId: string, outcome: TransportOutcome): void {
    const frameInfo = openFrames.get(frameId);
    if (!frameInfo) return;
    openFrames.delete(frameId);

    if (frameInfo.userRootId) {
      const userRoot = activeUserRoots.get(frameInfo.userRootId);
      if (userRoot) {
        userRoot.outcomes.push(outcome);
        userRoot.openFrameCount--;
        if (userRoot.openFrameCount === 0) {
          activeUserRoots.delete(frameInfo.userRootId);
          // Precedence: expired > failed > rejected > succeeded (§5)
          let finalOutcome: TransportOutcome = 'succeeded';
          if (userRoot.outcomes.includes('expired')) finalOutcome = 'expired';
          else if (userRoot.outcomes.includes('failed')) finalOutcome = 'failed';
          else if (userRoot.outcomes.includes('rejected')) finalOutcome = 'rejected';

          rootCounts.inFlight = Math.max(0, rootCounts.inFlight - 1);
          rootCounts[finalOutcome]++;
        }
      }
    }
  }

  // Deliver an event to a machine element
  async function invokeMachine(
    machineElementId: Id,
    eventPortId: Id,
    eventPayload: Json,
    invocationRootId: string,
    journeyId: Id,
    parentTraceId: string | null,
    currentRequestId: string | null,
    outcome: TransportOutcome | null,
    isExternalControlInput: boolean,
  ): Promise<{ ok: boolean; error?: string; stopped?: boolean }> {
    const mEl = elementsMap.get(machineElementId);
    if (!mEl || mEl.behavior.kind !== 'machine') {
      return { ok: false, error: `Element '${machineElementId}' is not a machine` };
    }
    const mb = mEl.behavior as MachineBehavior;
    const curState = machineStates.get(machineElementId)!;

    // Collect port schemas for atomic validation
    const portSchemas = new Map<Id, Shape>();
    for (const p of mEl.ports) {
      const sch = schemasMap.get(p.schemaId);
      if (sch) portSchemas.set(p.id, sch.shape);
    }
    const contextSchema = mb.contextSchemaId ? schemasMap.get(mb.contextSchemaId)?.shape : null;

    const stepResult = stepMachine({
      machine: mb,
      currentStateId: curState.stateId,
      currentContext: curState.context,
      eventPortId,
      payload: eventPayload,
      rootId: invocationRootId,
      currentRequestId,
      outcome,
      nextRequestIdCounter: () => ++requestIdCounter,
      evaluator: defaultEvaluator,
      contextSchema,
      portSchemas,
    });

    if (!stepResult.ok) {
      return { ok: false, error: `Machine execution error [${stepResult.errorCode}]: ${stepResult.errorMessage}` };
    }

    // Commit machine state
    machineStates.set(machineElementId, {
      stateId: stepResult.toStateId,
      context: stepResult.context,
    });

    // Control invocation root promotion on first call emission (§5)
    let promotedUserRoot = false;
    if (isExternalControlInput && stepResult.emissions.length > 0) {
      promotedUserRoot = true;
      rootCounts.generated++;
      rootCounts.inFlight++;
      activeUserRoots.set(invocationRootId, {
        openFrameCount: 0,
        outcomes: [],
      });
    }

    // Record trace effects
    for (const code of stepResult.traces) {
      processedEvents++;
      if (processedEvents > budgets.maxEvents) {
        return { ok: false, stopped: true };
      }
      const appendRes = await recorder.append({
        rootId: invocationRootId,
        journeyId,
        parentId: parentTraceId,
        elementId: machineElementId,
        portId: null,
        kind: 'state',
        code,
        payload: null,
        atMs: null,
        outcome: null,
      });
      if (!appendRes.ok) {
        return { ok: false, stopped: true };
      }
    }

    // Process emissions
    for (const emission of stepResult.emissions) {
      processedEvents++;
      if (processedEvents > budgets.maxEvents) {
        return { ok: false, stopped: true };
      }

      recordPortEmission({ elementId: machineElementId, portId: emission.portId }, journeyId, emission.value);

      const appendRes = await recorder.append({
        rootId: invocationRootId,
        journeyId,
        parentId: parentTraceId,
        elementId: machineElementId,
        portId: emission.portId,
        kind: 'dispatch',
        code: 'emit',
        payload: emission.value,
        atMs: null,
        outcome: null,
      });
      if (!appendRes.ok) {
        return { ok: false, stopped: true };
      }

      // Check if this emission targets a call boundary
      const callPort = portsMap.get(emission.portId);
      if (callPort && callPort.channel === 'call') {
        const frameId = `frame:${runId}:${++frameCounter}`;
        const userRootId = promotedUserRoot ? invocationRootId : (activeUserRoots.has(invocationRootId) ? invocationRootId : null);
        openFrames.set(frameId, { userRootId });
        if (userRootId) {
          activeUserRoots.get(userRootId)!.openFrameCount++;
        }

        // Match against boundaries
        const boundary = activeScenario.boundaries.find(
          (b) =>
            (b.source.elementId === machineElementId && b.source.portId === emission.portId) ||
            document.connections.some(
              (c) =>
                c.kind === 'call' &&
                c.source.elementId === machineElementId &&
                c.source.portId === emission.portId &&
                c.target.elementId === b.source.elementId &&
                c.target.portId === b.source.portId,
            ),
        );

        if (!boundary) {
          return { ok: false, error: `No boundary configured for call on port '${emission.portId}'` };
        }

        let matchedResponse: BoundaryResponse | null = null;
        for (const resp of boundary.responses) {
          if (usedBoundaryResponseIds.has(resp.id)) continue;
          const matchRes = defaultEvaluator.evalGuard(resp.match, {
            input: emission.value,
            context: {},
            outcome: null,
          });
          if (matchRes.ok && matchRes.value) {
            matchedResponse = resp;
            break;
          }
        }

        if (!matchedResponse) {
          return { ok: false, error: `Boundary exhaustion or no matching response on port '${emission.portId}' (§6)` };
        }

        usedBoundaryResponseIds.add(matchedResponse.id);

        // Construct response payload via bindings over cloned fixture
        const fixtureVal = fixturesMap.get(matchedResponse.responseFixtureId);
        if (fixtureVal === undefined) {
          return { ok: false, error: `Boundary response fixture '${matchedResponse.responseFixtureId}' not found` };
        }
        let responsePayload = deepCloneJson(fixtureVal);
        for (const binding of matchedResponse.payloadBindings) {
          const reqVal = readPath(emission.value, binding.requestPath);
          if (isMissing(reqVal)) {
            return {
              ok: false,
              error: `Boundary payload binding: requestPath '${binding.requestPath.join('.')}' not found in request`,
            };
          }
          const setRes = setPathInContext(responsePayload, binding.targetPath, reqVal);
          if (!setRes.ok) {
            return { ok: false, error: `Boundary payload binding set failed: ${setRes.error}` };
          }
          responsePayload = setRes.context;
        }

        // Validate response payload against response schema
        const respSchema = schemasMap.get(boundary.schemaId);
        if (respSchema) {
          const valRes = validatePayloadShape(responsePayload, respSchema.shape);
          if (!valRes.ok) {
            return { ok: false, error: `Boundary response payload failed schema: ${valRes.reason}` };
          }
        }

        const held: HeldResponse = {
          response: matchedResponse,
          payload: responsePayload,
          callPortId: emission.portId,
          correlationRequestId: emission.correlationRequestId,
          initiatingFrameId: frameId,
          machineElementId,
          rootId: invocationRootId,
          journeyId,
        };

        // Determine delivery timing
        if (matchedResponse.afterInputId === null || finishedInputIds.has(matchedResponse.afterInputId)) {
          causalQueue.push({ kind: 'boundary-response', held });
        } else {
          heldBoundaryResponses.push(held);
        }
      }
    }

    return { ok: true };
  }

  // Drains the causal FIFO queue until empty
  async function drainCausalQueue(): Promise<{ ok: boolean; error?: string; stopped?: boolean }> {
    while (causalQueue.length > 0) {
      const item = causalQueue.shift()!;
      if (item.kind === 'boundary-response') {
        const { held } = item;
        const mb = (elementsMap.get(held.machineElementId)!.behavior as MachineBehavior);
        const binding = mb.responseBindings.find((rb) => rb.callPortId === held.callPortId);
        if (!binding) {
          return { ok: false, error: `No response binding found for call port '${held.callPortId}'` };
        }

        processedEvents++;
        if (processedEvents > budgets.maxEvents) {
          return { ok: false, stopped: true };
        }

        const appendRes = await recorder.append({
          rootId: held.rootId,
          journeyId: held.journeyId,
          parentId: null,
          elementId: held.machineElementId,
          portId: binding.eventPortId,
          kind: 'dispatch',
          code: 'boundary-response',
          payload: held.payload,
          atMs: null,
          outcome: held.response.outcome,
        });
        if (!appendRes.ok) {
          return { ok: false, stopped: true };
        }

        // Settle the call frame with response outcome
        settleFrame(held.initiatingFrameId, held.response.outcome);

        // Deliver response event to machine
        const invRes = await invokeMachine(
          held.machineElementId,
          binding.eventPortId,
          held.payload,
          held.rootId,
          held.journeyId,
          appendRes.event.id,
          held.correlationRequestId,
          held.response.outcome,
          false, // internal response event never creates roots (§5)
        );
        if (!invRes.ok) return invRes;
      }
    }
    return { ok: true };
  }

  // Main external input loop
  for (let inputIdx = 0; inputIdx < activeScenario.inputs.length; inputIdx++) {
    // Check budgets before starting next input
    if (recorder.status.stopped || processedEvents >= budgets.maxEvents) {
      break;
    }

    const input: Input = activeScenario.inputs[inputIdx];
    consumedInputs++;

    // Prepare input payload: clone fixture & apply bindings
    const fixture = fixturesMap.get(input.fixtureId);
    if (fixture === undefined) {
      return makeTerminalResult(
        'failed',
        recorder.events,
        buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
        [],
        `Input fixture '${input.fixtureId}' not found`,
      );
    }
    let inputPayload = deepCloneJson(fixture);

    for (const binding of input.payloadBindings) {
      const srcKey = `${binding.source.port.elementId}:${binding.source.port.portId}:${binding.source.journeyId}`;
      const earlierList = emissionsByPortAndJourney.get(srcKey);
      if (!earlierList || binding.source.occurrence >= earlierList.length) {
        return makeTerminalResult(
          'failed',
          recorder.events,
          buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
          [],
          `Input binding failed: missing earlier emission for ${srcKey} at occurrence ${binding.source.occurrence}`,
        );
      }
      const readVal = readPath(earlierList[binding.source.occurrence], binding.source.path);
      if (isMissing(readVal)) {
        return makeTerminalResult(
          'failed',
          recorder.events,
          buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
          [],
          `Input binding failed: path '${binding.source.path.join('.')}' is missing in source emission`,
        );
      }
      const setRes = setPathInContext(inputPayload, binding.targetPath, readVal);
      if (!setRes.ok) {
        return makeTerminalResult(
          'failed',
          recorder.events,
          buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
          [],
          `Input binding set failed: ${setRes.error}`,
        );
      }
      inputPayload = setRes.context;
    }

    // Validate input payload against entry port schema
    const entryPort = portsMap.get(input.entry.portId);
    if (entryPort) {
      const portSchema = schemasMap.get(entryPort.schemaId);
      if (portSchema) {
        const valRes = validatePayloadShape(inputPayload, portSchema.shape);
        if (!valRes.ok) {
          rootCounts.generated++;
          rootCounts.rejected++;
          return makeTerminalResult(
            'failed',
            recorder.events,
            buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
            [],
            `External input failed schema validation: ${valRes.reason}`,
          );
        }
      }
    }

    const inputRootId = rootId(input.id, 0);

    // Record trace event for external input arrival
    processedEvents++;
    if (processedEvents > budgets.maxEvents) break;
    const inputAppend = await recorder.append({
      rootId: inputRootId,
      journeyId: input.journeyId,
      parentId: null,
      elementId: input.entry.elementId,
      portId: input.entry.portId,
      kind: 'input',
      code: 'input',
      payload: inputPayload,
      atMs: null,
      outcome: null,
    });
    if (!inputAppend.ok) break;

    // Dispatch input to target machine
    const invRes = await invokeMachine(
      input.entry.elementId,
      input.entry.portId,
      inputPayload,
      inputRootId,
      input.journeyId,
      inputAppend.event.id,
      null,
      null,
      true, // external control invocation
    );
    if (!invRes.ok) {
      if (invRes.stopped) break;
      return makeTerminalResult(
        'failed',
        recorder.events,
        buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
        [],
        invRes.error ?? 'Machine invocation failed',
      );
    }

    // Drain causal queue for this input
    const drainRes = await drainCausalQueue();
    if (!drainRes.ok) {
      if (drainRes.stopped) break;
      return makeTerminalResult(
        'failed',
        recorder.events,
        buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
        [],
        drainRes.error ?? 'Causal queue drain failed',
      );
    }

    // Input and its immediate causal work have finished (§6)
    finishedInputIds.add(input.id);

    // Release any boundary responses waiting on this afterInputId
    const toRelease: HeldResponse[] = [];
    for (let hIdx = heldBoundaryResponses.length - 1; hIdx >= 0; hIdx--) {
      if (heldBoundaryResponses[hIdx].response.afterInputId === input.id) {
        toRelease.unshift(heldBoundaryResponses.splice(hIdx, 1)[0]);
      }
    }
    for (const rel of toRelease) {
      causalQueue.push({ kind: 'boundary-response', held: rel });
    }

    // Drain causal queue again after releasing held responses
    const secondDrainRes = await drainCausalQueue();
    if (!secondDrainRes.ok) {
      if (secondDrainRes.stopped) break;
      return makeTerminalResult(
        'failed',
        recorder.events,
        buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents),
        [],
        secondDrainRes.error ?? 'Causal queue drain after release failed',
      );
    }
  }

  // Check budgets
  if (recorder.status.stopped) {
    const summary = buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents);
    const checks = evaluateAssertions(activeScenario.assertions, summary, recorder.events);
    return makeTerminalResult('incomplete', recorder.events, summary, checks, `Budget exhausted: ${recorder.status.reason}`);
  }
  if (processedEvents >= budgets.maxEvents) {
    const summary = buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents);
    const checks = evaluateAssertions(activeScenario.assertions, summary, recorder.events);
    return makeTerminalResult('incomplete', recorder.events, summary, checks, 'Budget exhausted: maxEvents limit reached');
  }

  // Quiescent completion check (§6): all inputs consumed, queue drained, all frames settled
  const allInputsConsumed = consumedInputs === activeScenario.inputs.length;
  const queueDrained = causalQueue.length === 0 && heldBoundaryResponses.length === 0;
  const allFramesSettled = openFrames.size === 0;

  const terminalStatus: TerminalStatus = allInputsConsumed && queueDrained && allFramesSettled ? 'completed' : 'incomplete';
  const reason = terminalStatus === 'completed' ? null : 'Logical run incomplete: unsettled frames or undrained work remaining';

  const summary = buildSummary(activeScenario, machineStates, outputsMap, rootCounts, consumedInputs, processedEvents);
  const checks = evaluateAssertions(activeScenario.assertions, summary, recorder.events);

  return makeTerminalResult(terminalStatus, recorder.events, summary, checks, reason);
}

function buildSummary(
  scenario: Scenario,
  machineStates: Map<Id, { stateId: Id; context: Json }>,
  outputsMap: Map<string, { port: Endpoint; values: Json[] }>,
  rootCounts: Counts,
  consumedInputs: number,
  processedEvents: number,
): RunSummary {
  return {
    mode: 'logical',
    consumedInputs,
    rootCounts: { ...rootCounts },
    messageCounts: {
      generated: 0,
      succeeded: 0,
      rejected: 0,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    elementMetrics: [],
    finalStates: Array.from(machineStates.entries()).map(([elementId, st]) => ({
      elementId,
      stateId: st.stateId,
      context: st.context,
    })),
    outputs: Array.from(outputsMap.values()).map((o) => ({
      port: o.port,
      values: o.values,
    })),
    coverage: {
      includedElementIds: scenario.scopeElementIds,
      excludedElementIds: [],
    },
    processedEvents,
    elapsedMs: null,
    rowOutcomes: [],
  };
}

function makeEmptySummary(mode: 'logical' | 'timed', scopeElementIds: readonly Id[]): RunSummary {
  return {
    mode,
    consumedInputs: 0,
    rootCounts: {
      generated: 0,
      succeeded: 0,
      rejected: 0,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    messageCounts: {
      generated: 0,
      succeeded: 0,
      rejected: 0,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    elementMetrics: [],
    finalStates: [],
    outputs: [],
    coverage: {
      includedElementIds: scopeElementIds,
      excludedElementIds: [],
    },
    processedEvents: 0,
    elapsedMs: null,
    rowOutcomes: [],
  };
}

function makeTerminalResult(
  status: TerminalStatus,
  events: readonly TraceEvent[],
  summary: RunSummary,
  checks: readonly CheckResult[],
  reason: string | null,
): LogicalRunResult {
  return {
    status,
    events,
    summary,
    checks,
    reason,
  };
}
