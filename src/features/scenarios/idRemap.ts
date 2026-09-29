/**
 * Scenario copy ID remapping (RV-05c).
 *
 * specs/revamp/contracts/commands.md §4 Scenarios (D41): "A copy remaps every nested ID
 * (workloads, classes, inputs, faults, boundaries, assertions, assumptions) with fresh
 * UUIDs."
 *
 * Remapped (scenario-owned nested identities): scenario.id, workload.id, request
 * class.id, input.id, input.journeyId (and every payloadBindings[].source.journeyId
 * that references it -- a shared journey grouping, not per-input), fault.id,
 * boundary.id, boundary response.id (and any afterInputId that references a remapped
 * input).
 *
 * NOT remapped (references into the rest of the document, or scenario-local
 * classification tokens the contract says are not references):
 * - scopeElementIds, entryPorts, refinementSelections[].refinementId,
 *   initialContexts[].{elementId,fixtureId}, inputs[].entry, inputs[].fixtureId,
 *   boundaries[].source, boundaries[].schemaId, boundaries[].responses[].responseFixtureId,
 *   assertions[].subject element/port ids -- all real document references, unchanged by
 *   a same-document copy.
 * - `ResourceMetadata.requestClassId` / `ResourceCallMetadata.requestClassId`: "a
 *   scenario-local classification token, not a required reference to a workload class"
 *   (model-and-runner.md §6) -- copied verbatim so requestClassId groupings that shared
 *   a token before the copy still share it after.
 */

import type { Boundary, Fault, Id, Input, InputBinding, Scenario, Workload } from '../../domain/studio/model';
import type { MintId } from './types';

type IdMap = Map<Id, Id>;

function remap(map: IdMap, mintId: MintId, oldId: Id): Id {
  const existing = map.get(oldId);
  if (existing) return existing;
  const fresh = mintId();
  map.set(oldId, fresh);
  return fresh;
}

function remapWorkload(workload: Workload, mintId: MintId): Workload {
  const classMap: IdMap = new Map();
  return {
    ...workload,
    id: mintId(),
    classes: workload.classes.map((c) => ({ ...c, id: remap(classMap, mintId, c.id) })),
  };
}

function remapBinding(binding: InputBinding, journeyMap: IdMap, mintId: MintId): InputBinding {
  return {
    ...binding,
    source: {
      ...binding.source,
      journeyId: remap(journeyMap, mintId, binding.source.journeyId),
    },
  };
}

function remapInput(input: Input, journeyMap: IdMap, mintId: MintId): Input {
  return {
    ...input,
    id: mintId(),
    journeyId: remap(journeyMap, mintId, input.journeyId),
    payloadBindings: input.payloadBindings.map((b) => remapBinding(b, journeyMap, mintId)),
  };
}

function remapFault(fault: Fault, mintId: MintId): Fault {
  return { ...fault, id: mintId() };
}

function remapBoundary(boundary: Boundary, mintId: MintId, inputMap: IdMap): Boundary {
  return {
    ...boundary,
    id: mintId(),
    responses: boundary.responses.map((r) => ({
      ...r,
      id: mintId(),
      afterInputId: r.afterInputId === null ? null : (inputMap.get(r.afterInputId) ?? r.afterInputId),
    })),
  };
}

/**
 * Remaps every nested ID of `source` with fresh UUIDs from `mintId`, and returns a new
 * Scenario carrying `label`, `scenario.id = mintId()` and `revision: 0` (a fresh,
 * unsaved copy -- see draft.ts on why new records start at revision 0).
 */
export function remapScenarioForCopy(source: Scenario, mintId: MintId, label: string): Scenario {
  const journeyMap: IdMap = new Map();

  const inputs = source.inputs.map((i) => remapInput(i, journeyMap, mintId));
  const inputMap: IdMap = new Map();
  for (let i = 0; i < source.inputs.length; i++) {
    inputMap.set(source.inputs[i].id, inputs[i].id);
  }

  return {
    ...source,
    id: mintId(),
    label,
    revision: 0,
    workloads: source.workloads.map((w) => remapWorkload(w, mintId)),
    inputs,
    faults: source.faults.map((f) => remapFault(f, mintId)),
    boundaries: source.boundaries.map((b) => remapBoundary(b, mintId, inputMap)),
    assertions: source.assertions.map((a) => ({ ...a, id: mintId() })),
    assumptions: source.assumptions.map((a) => ({ ...a, id: mintId() })),
  };
}
