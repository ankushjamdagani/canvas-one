/**
 * Scenario scope closure computation: the set of elements, connections, relations and
 * schemas a scenario reaches from its declared scope, entry ports, inputs, boundaries,
 * refinement selections and faults.
 *
 * Limits: at most 2,000 expanded entities and 10,000 references; the work queue is
 * processed in batches of at most 100, checking for cancellation after every batch.
 */

import type {
  Document,
  Id,
  Relation,
  Refinement,
  MachineBehavior,
  PipelineBehavior,
  DecisionBehavior,
} from './model';
import type { Issue } from './validate';
import { resolveRefinementRouting } from './refinementRouting';

// ============================================================================
// Closure Issue Codes and Types
// ============================================================================

/**
 * Documented issue codes specific to scenario scope closure and readiness.
 *
 */
const CLOSURE_ISSUE_CODES = [
  'unresolved-crossing',
  'missing-target',
  'recursive-refinement',
  'unsupported-relation',
] as const;

export type ClosureIssueCode = (typeof CLOSURE_ISSUE_CODES)[number];

export type ClosureIssue = Omit<Issue, 'code'> & {
  readonly code: Issue['code'] | ClosureIssueCode;
};

export type ClosureResultOk = {
  readonly status: 'ok';
  readonly declaredScope: Id[];
  readonly includedElementIds: Id[];
  readonly includedConnectionIds: Id[];
  readonly boundaryIds: Id[];
  readonly excludedElementIds: Id[];
  readonly schemaIds: Id[];
  readonly fixtureIds: Id[];
  readonly structuralRelationIds: Id[];
};

export type ClosureResultNotReady = {
  readonly status: 'not-ready';
  readonly issues: ClosureIssue[];
};

export type ClosureResultAnalysisLimit = {
  readonly status: 'analysis-limit';
};

export type ClosureResultCancelled = {
  readonly status: 'cancelled';
};

export type ClosureResult =
  | ClosureResultOk
  | ClosureResultNotReady
  | ClosureResultAnalysisLimit
  | ClosureResultCancelled;

export type ComputeClosureOptions = {
  readonly shouldCancel?: () => boolean;
};

// ============================================================================
// Internal Work Queue Item Types
// ============================================================================

type WorkItem =
  | { readonly kind: 'element'; readonly id: Id }
  | { readonly kind: 'connection'; readonly id: Id }
  | { readonly kind: 'boundary'; readonly id: Id }
  | { readonly kind: 'relation'; readonly id: Id }
  | { readonly kind: 'schema'; readonly id: Id }
  | { readonly kind: 'fixture'; readonly id: Id };

// ============================================================================
// Pre-expansion Validation: Recursive Refinement
// ============================================================================

/**
 * Each member has at most one owner, and recursive ownership is rejected before
 * expansion ('recursive-refinement').
 *
 * Checks the refinement ownership graph for directed cycles.
 */
function findRecursiveRefinement(refinements: readonly Refinement[]): { cycleOwnerId: Id; refId: Id } | null {
  // Map ownerElementId -> { members: memberElementIds, refId }
  const ownerMap = new Map<Id, { members: readonly Id[]; refId: Id }>();
  for (const ref of refinements) {
    ownerMap.set(ref.ownerElementId, { members: ref.memberElementIds, refId: ref.id });
  }

  // Detect cycle using 3-color state: unvisited (not in map), visiting, visited
  const state = new Map<Id, 'visiting' | 'visited'>();

  for (const startOwner of ownerMap.keys()) {
    if (state.get(startOwner) === 'visited') continue;

    const stack: { id: Id; memberIndex: number }[] = [{ id: startOwner, memberIndex: 0 }];
    state.set(startOwner, 'visiting');

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const entry = ownerMap.get(top.id);
      const members = entry?.members ?? [];

      if (top.memberIndex < members.length) {
        const nextId = members[top.memberIndex];
        top.memberIndex++;

        // If self-referential or points to an owner currently in 'visiting' state
        if (state.get(nextId) === 'visiting') {
          return { cycleOwnerId: nextId, refId: ownerMap.get(nextId)?.refId ?? entry!.refId };
        }

        if (!state.has(nextId) && ownerMap.has(nextId)) {
          state.set(nextId, 'visiting');
          stack.push({ id: nextId, memberIndex: 0 });
        }
      } else {
        state.set(top.id, 'visited');
        stack.pop();
      }
    }
  }

  return null;
}

// ============================================================================
// Main Closure Algorithm
// ============================================================================

/**
 * Computes scenario scope closure for a given scenario in a Document.
 *
 * Assumes the document has already passed validateDocument.
 */
export function computeClosure(
  doc: Document,
  scenarioId: Id,
  opts?: ComputeClosureOptions,
): ClosureResult {
  // Check early cancellation
  if (opts?.shouldCancel?.()) {
    return { status: 'cancelled' };
  }

  // Locate the scenario
  const scenarioIndex = doc.scenarios.findIndex((s) => s.id === scenarioId);
  if (scenarioIndex === -1) {
    return {
      status: 'not-ready',
      issues: [
        {
          code: 'missing-target',
          path: ['scenarios'],
          entityId: scenarioId,
          severity: 'error',
          message: `Scenario '${scenarioId}' not found in document`,
        },
      ],
    };
  }
  const scenario = doc.scenarios[scenarioIndex];

  // --------------------------------------------------------------------------
  // Step 1: Pre-expansion Refinement Check
  // "Reject recursive ownership before expansion ('recursive-refinement')."
  // --------------------------------------------------------------------------
  const recursiveRef = findRecursiveRefinement(doc.refinements);
  if (recursiveRef) {
    return {
      status: 'not-ready',
      issues: [
        {
          code: 'recursive-refinement',
          path: ['refinements'],
          entityId: recursiveRef.refId,
          severity: 'error',
          message: `Recursive ownership detected involving owner element '${recursiveRef.cycleOwnerId}'`,
        },
      ],
    };
  }

  // --------------------------------------------------------------------------
  // Step 2: Index Lookups and Refinement Routing
  // --------------------------------------------------------------------------
  const elementsMap = new Map<Id, (typeof doc.elements)[number]>();
  for (const el of doc.elements) elementsMap.set(el.id, el);

  const fixturesMap = new Map<Id, (typeof doc.fixtures)[number]>();
  for (const fix of doc.fixtures) fixturesMap.set(fix.id, fix);

  const boundariesMap = new Map<Id, (typeof scenario.boundaries)[number]>();
  for (const b of scenario.boundaries) boundariesMap.set(b.id, b);

  const relationsMap = new Map<Id, Relation>();
  for (const rel of doc.relations) relationsMap.set(rel.id, rel);

  // Process scenario refinement selections through the shared runtime/compiler routing model.
  // Mappings are transitive in both directions; a nested
  // selection below an aggregate outer refinement is inert.
  const refinementMap = new Map<Id, Refinement>();
  for (const ref of doc.refinements) refinementMap.set(ref.id, ref);
  const refinementRouting = resolveRefinementRouting(doc, scenario);
  const refinementExcludedElementIds = new Set(refinementRouting.excludedElementIds);

  // --------------------------------------------------------------------------
  // Step 3: Work Queue and Visited Sets Setup
  // "<=2,000 expanded entities, <=10,000 references; batches <=100 items; cancellation checked after every batch"
  // --------------------------------------------------------------------------
  let expandedEntitiesCount = 0;
  let referencesCount = 0;

  const queue: WorkItem[] = [];
  const visitedElementIds = new Set<Id>();
  const visitedConnectionIds = new Set<Id>();
  const visitedBoundaryIds = new Set<Id>();
  const visitedRelationIds = new Set<Id>();
  const visitedSchemaIds = new Set<Id>();
  const visitedFixtureIds = new Set<Id>();

  const declaredScopeSet = new Set<Id>(scenario.scopeElementIds);
  const issues: ClosureIssue[] = [];

  // Helper to safely enqueue items and check limits
  function enqueueSchema(schemaId: Id | null): void {
    if (!schemaId) return;
    referencesCount++;
    if (!visitedSchemaIds.has(schemaId)) {
      visitedSchemaIds.add(schemaId);
      queue.push({ kind: 'schema', id: schemaId });
    }
  }

  function enqueueFixture(fixtureId: Id | null): void {
    if (!fixtureId) return;
    referencesCount++;
    if (!visitedFixtureIds.has(fixtureId)) {
      visitedFixtureIds.add(fixtureId);
      queue.push({ kind: 'fixture', id: fixtureId });
    }
  }

  function enqueueElement(elementId: Id): void {
    referencesCount++;
    if (!visitedElementIds.has(elementId) && !refinementExcludedElementIds.has(elementId)) {
      visitedElementIds.add(elementId);
      queue.push({ kind: 'element', id: elementId });
    }
  }

  // --------------------------------------------------------------------------
  // Step 4: Seed from Scenario Entry Points
  // "Start from the scenario entry points: entryPorts, every input.entry, every workload.entry."
  // --------------------------------------------------------------------------
  for (const ep of scenario.entryPorts) {
    referencesCount += 2;
    const resolved = refinementRouting.resolveOuterToInner(ep);
    enqueueElement(resolved.elementId);
  }

  for (const inp of scenario.inputs) {
    referencesCount += 2;
    const resolved = refinementRouting.resolveOuterToInner(inp.entry);
    enqueueElement(resolved.elementId);
    enqueueFixture(inp.fixtureId);
  }

  for (const w of scenario.workloads) {
    referencesCount += 2;
    const resolved = refinementRouting.resolveOuterToInner(w.entry);
    enqueueElement(resolved.elementId);
  }

  // Scenario initialContexts for included elements
  // "fixtures: scenario inputs, initialContexts, machine initialContextFixtureId, boundary responseFixtureIds."
  for (const ic of scenario.initialContexts) {
    referencesCount += 2;
    enqueueFixture(ic.fixtureId);
  }

  // Structural relations: contains when used by active refinement
  // "structuralRelationIds: Id[] (sorted: only interpreted relations — deployed-on for included resources, contains when used by refinement)"
  for (const sel of scenario.refinementSelections) {
    if (!refinementRouting.activeRefinementIds.includes(sel.refinementId)) continue;
    const ref = refinementMap.get(sel.refinementId);
    if (!ref) continue;
    const memberSet = new Set(ref.memberElementIds);
    for (const rel of doc.relations) {
      if (rel.kind === 'contains' && rel.parentId === ref.ownerElementId && memberSet.has(rel.childId)) {
        referencesCount += 2;
        if (!visitedRelationIds.has(rel.id)) {
          visitedRelationIds.add(rel.id);
          queue.push({ kind: 'relation', id: rel.id });
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Step 5: Iterative Fixed-Point Work Queue Traversal
  // (batches <=100, cancellation checked after every batch)
  // --------------------------------------------------------------------------
  let batchCount = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    expandedEntitiesCount++;

    if (expandedEntitiesCount > 2000 || referencesCount > 10000) {
      return { status: 'analysis-limit' };
    }

    if (item.kind === 'element') {
      const el = elementsMap.get(item.id);
      if (el) {
        // Schemas from included ports (schemaId, responseSchemaId)
        for (const p of el.ports) {
          enqueueSchema(p.schemaId);
          enqueueSchema(p.responseSchemaId);
        }

        // Behavior schemas and fixtures
        const b = el.behavior;
        if (b.kind === 'machine') {
          const mb = b as MachineBehavior;
          enqueueSchema(mb.contextSchemaId);
          enqueueFixture(mb.initialContextFixtureId);
        } else if (b.kind === 'pipeline') {
          const pb = b as PipelineBehavior;
          enqueueSchema(pb.inputSchemaId);
          enqueueSchema(pb.outputSchemaId);
          enqueueSchema(pb.errorSchemaId);
          for (const op of pb.operations) {
            if (op.kind === 'validate') {
              enqueueSchema(op.schemaId);
            }
          }
        } else if (b.kind === 'decision') {
          const db = b as DecisionBehavior;
          enqueueSchema(db.inputSchemaId);
        } else if (b.kind === 'resource') {
          // Deployed-on relations for included resources
          // "Structural: included resources with a deployed-on relation include that relation and its host"
          for (const rel of doc.relations) {
            if (rel.kind === 'deployed-on' && rel.elementId === el.id) {
              referencesCount += 2;
              if (!visitedRelationIds.has(rel.id)) {
                visitedRelationIds.add(rel.id);
                queue.push({ kind: 'relation', id: rel.id });
              }
            }
          }
        }

        // Determine reachable declared outputs
        // - machine -> ports used by emit effects in any transition and callPortIds of responseBindings
        // - pipeline -> outputPortId and errorPortId
        // - decision -> every case outputPortId and fallback outputPortId
        // - resource -> all its outbound ports that have connections
        // - host and unmodeled never dispatch
        const reachablePortIds = new Set<Id>();
        if (b.kind === 'machine') {
          const mb = b as MachineBehavior;
          for (const t of mb.transitions) {
            for (const eff of t.effects) {
              if (eff.kind === 'emit') {
                reachablePortIds.add(eff.portId);
              }
            }
          }
          for (const rb of mb.responseBindings) {
            reachablePortIds.add(rb.callPortId);
          }
        } else if (b.kind === 'pipeline') {
          const pb = b as PipelineBehavior;
          reachablePortIds.add(pb.outputPortId);
          reachablePortIds.add(pb.errorPortId);
        } else if (b.kind === 'decision') {
          const db = b as DecisionBehavior;
          for (const c of db.cases) {
            reachablePortIds.add(c.outputPortId);
          }
          reachablePortIds.add(db.fallback.outputPortId);
        } else if (b.kind === 'resource') {
          for (const p of el.ports) {
            if (p.direction === 'out') {
              const hasConn = doc.connections.some(
                (c) => c.source.elementId === el.id && c.source.portId === p.id,
              );
              if (hasConn) reachablePortIds.add(p.id);
            }
          }
        }

        // Follow connections originating from reachable outbound ports
        // Sort connections by ID to guarantee deterministic traversal
        const sortedConns = [...doc.connections].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const portId of reachablePortIds) {
          // Resolve endpoints that could trigger outbound connections (including refinement outer mappings)
          const sourceEndpoints = refinementRouting.outboundEndpoints(el.id, portId);
          for (const srcEp of sourceEndpoints) {
            for (const conn of sortedConns) {
              if (conn.source.elementId === srcEp.elementId && conn.source.portId === srcEp.portId) {
                referencesCount += 2;
                if (!visitedConnectionIds.has(conn.id)) {
                  visitedConnectionIds.add(conn.id);
                  queue.push({ kind: 'connection', id: conn.id });
                }
              }
            }
          }
        }
      }
    } else if (item.kind === 'connection') {
      const conn = doc.connections.find((c) => c.id === item.id);
      if (conn) {
        // Crossings check:
        // "Crossings: a followed connection whose target is outside the declared scope
        // (scenario.scopeElementIds) must be matched by a scenario boundary whose source
        // equals that connection's source endpoint; otherwise 'unresolved-crossing'.
        // A matched crossing does not include the outside element; record the boundary id."
        if (!declaredScopeSet.has(conn.target.elementId)) {
          const matchingBoundary = scenario.boundaries.find(
            (b) => b.source.elementId === conn.source.elementId && b.source.portId === conn.source.portId,
          );
          if (!matchingBoundary) {
            issues.push({
              code: 'unresolved-crossing',
              path: ['connections', doc.connections.indexOf(conn)],
              entityId: conn.id,
              severity: 'error',
              message: `Connection '${conn.id}' crosses declared scope to '${conn.target.elementId}' without matching boundary at source (${conn.source.elementId}, ${conn.source.portId})`,
            });
          } else {
            referencesCount += 2;
            if (!visitedBoundaryIds.has(matchingBoundary.id)) {
              visitedBoundaryIds.add(matchingBoundary.id);
              queue.push({ kind: 'boundary', id: matchingBoundary.id });
            }
          }
        } else {
          // Target is inside declared scope: element becomes reached
          const resolvedTarget = refinementRouting.resolveOuterToInner(conn.target);
          enqueueElement(resolvedTarget.elementId);
        }
      }
    } else if (item.kind === 'boundary') {
      const boundary = boundariesMap.get(item.id);
      if (boundary) {
        enqueueSchema(boundary.schemaId);
        for (const resp of boundary.responses) {
          enqueueFixture(resp.responseFixtureId);
        }
      }
    } else if (item.kind === 'fixture') {
      const fix = fixturesMap.get(item.id);
      if (fix) {
        enqueueSchema(fix.schemaId);
      }
    } else if (item.kind === 'relation') {
      const rel = relationsMap.get(item.id);
      if (rel) {
        if (rel.kind === 'deployed-on') {
          // "include that relation and its host"
          enqueueElement(rel.hostId);
        } else if ((rel as { kind: string }).kind !== 'contains' && (rel as { kind: string }).kind !== 'descriptive') {
          // Unsupported relation kind
          const badRel = rel as { id: Id; kind: string };
          issues.push({
            code: 'unsupported-relation',
            path: ['relations', doc.relations.indexOf(rel)],
            entityId: badRel.id,
            severity: 'error',
            message: `Unsupported relation kind '${badRel.kind}'`,
          });
        }
      }
    }

    if (expandedEntitiesCount > 2000 || referencesCount > 10000) {
      return { status: 'analysis-limit' };
    }

    // Check cancellation after each batch of <=100 items
    batchCount++;
    if (batchCount >= 100) {
      batchCount = 0;
      if (opts?.shouldCancel?.()) {
        return { status: 'cancelled' };
      }
    }
  }

  // Check cancellation after final batch
  if (batchCount > 0) {
    if (opts?.shouldCancel?.()) {
      return { status: 'cancelled' };
    }
  }

  // --------------------------------------------------------------------------
  // Step 6: Post-traversal Fault Host Validation
  // "faults' hostIds must be included hosts."
  // --------------------------------------------------------------------------
  for (let fIdx = 0; fIdx < scenario.faults.length; fIdx++) {
    const fault = scenario.faults[fIdx];
    const hostEl = elementsMap.get(fault.hostId);
    if (!visitedElementIds.has(fault.hostId) || hostEl?.behavior.kind !== 'host') {
      issues.push({
        code: 'missing-target',
        path: ['scenarios', scenarioIndex, 'faults', fIdx, 'hostId'],
        entityId: fault.id,
        severity: 'error',
        message: `Fault '${fault.id}' targets host '${fault.hostId}' which is not an included host`,
      });
    }
  }

  // If any readiness issues were encountered, fail readiness
  if (issues.length > 0) {
    return {
      status: 'not-ready',
      issues,
    };
  }

  // --------------------------------------------------------------------------
  // Step 7: Assemble Result Sets (Sorted)
  // --------------------------------------------------------------------------
  const declaredScope = [...declaredScopeSet].sort();
  const includedElementIds = [...visitedElementIds].sort();
  const includedConnectionIds = [...visitedConnectionIds].sort();
  const boundaryIds = [...visitedBoundaryIds].sort();

  // excludedElementIds: declared-scope elements not reached (uncovered) + refinement-excluded
  const excludedSet = new Set<Id>();
  for (const id of declaredScopeSet) {
    if (!visitedElementIds.has(id)) {
      excludedSet.add(id);
    }
  }
  for (const id of refinementExcludedElementIds) {
    if (!visitedElementIds.has(id)) {
      excludedSet.add(id);
    }
  }
  const excludedElementIds = [...excludedSet].sort();

  const schemaIds = [...visitedSchemaIds].sort();
  const fixtureIds = [...visitedFixtureIds].sort();
  const structuralRelationIds = [...visitedRelationIds].sort();

  return {
    status: 'ok',
    declaredScope,
    includedElementIds,
    includedConnectionIds,
    boundaryIds,
    excludedElementIds,
    schemaIds,
    fixtureIds,
    structuralRelationIds,
  };
}
