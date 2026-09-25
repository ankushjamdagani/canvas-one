import { describe, expect, it } from 'vitest';
import type { Document, Id, PayloadSchema, Port } from '../../domain/studio/model';
import { validateDocument } from '../../domain/studio/validate';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import type { RecordChange } from '../../persistence/studio/types';
import { completeConnection, planConnection } from './connect';
import { placeEntry } from './place';

function createMintId(): () => Id {
  let counter = 1;
  return () => {
    const hex = (counter++).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}

function makeBlankDocument(mintId: () => Id): { document: Document; viewId: Id } {
  const viewId = mintId();
  const document: Document = {
    schema: 'studio-model/1',
    id: mintId(),
    title: 'Connection Test System',
    elements: [],
    connections: [],
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [
      {
        id: viewId,
        label: 'Main View',
        placements: [],
        connectionIds: [],
        relationIds: [],
        groups: [],
        notes: [],
      },
    ],
  };
  return { document, viewId };
}

function applyChanges(doc: Document, changes: readonly RecordChange[]): Document {
  const res = applyRecordChanges(doc, changes);
  if (!res.ok) {
    throw new Error(`applyRecordChanges failed: ${JSON.stringify(res.issues)}`);
  }
  return res.document;
}

function place(
  doc: Document,
  viewId: Id,
  entryId: string,
  anchor: { x: number; y: number },
  mintId: () => Id,
) {
  const res = placeEntry({ document: doc, viewId, entryId, anchor, mintId });
  if (!res.ok) {
    throw new Error(`placeEntry failed: ${JSON.stringify(res.issues)}`);
  }
  return res;
}

describe('connect.ts', () => {
  it('connects data channel ports directly (ready, empty config, view connectionIds updated)', () => {
    const mintId = createMintId();
    const { document: baseDoc, viewId } = makeBlankDocument(mintId);

    // Place two data-pipeline entries
    const p1 = place(baseDoc, viewId, 'data-pipeline', { x: 0, y: 0 }, mintId);
    const doc1 = applyChanges(baseDoc, p1.changes);

    const p2 = place(doc1, viewId, 'data-pipeline', { x: 300, y: 0 }, mintId);
    const doc2 = applyChanges(doc1, p2.changes);

    const el1 = doc2.elements.find((e) => e.id === p1.elementId)!;
    const el2 = doc2.elements.find((e) => e.id === p2.elementId)!;

    const sourceOutPort = el1.ports.find((p) => p.direction === 'out' && p.channel === 'data')!;
    const targetInPort = el2.ports.find((p) => p.direction === 'in' && p.channel === 'data')!;

    const plan = planConnection({
      document: doc2,
      viewId,
      source: { elementId: el1.id, portId: sourceOutPort.id },
      target: { elementId: el2.id, portId: targetInPort.id },
      mintId,
    });

    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') return;

    // View connectionIds updated
    const viewChange = plan.changes.find((c) => c.kind === 'replace' && c.value.recordKind === 'view');
    expect(viewChange).toBeDefined();
    const updatedView = (viewChange as any).value.record;
    expect(updatedView.connectionIds).toContain(plan.connectionId);

    // Connection config is empty for data
    const connChange = plan.changes.find((c) => c.kind === 'insert' && c.value.recordKind === 'connection');
    expect(connChange).toBeDefined();
    expect((connChange as any).value.record.config).toEqual({});

    // Apply and validate
    const finalDoc = applyChanges(doc2, plan.changes);
    const valRes = validateDocument(finalDoc);
    expect(valRes.ok).toBe(true);
  });

  it('connects to a non-resource element with ready and resource: null', () => {
    const mintId = createMintId();
    const { document: baseDoc, viewId } = makeBlankDocument(mintId);

    // Service -> Third-party (unmodeled, non-resource)
    const p1 = place(baseDoc, viewId, 'service', { x: 0, y: 0 }, mintId);
    const doc1 = applyChanges(baseDoc, p1.changes);

    const p2 = place(doc1, viewId, 'thirdparty', { x: 300, y: 0 }, mintId);
    const doc2 = applyChanges(doc1, p2.changes);

    const service = doc2.elements.find((e) => e.id === p1.elementId)!;
    const thirdparty = doc2.elements.find((e) => e.id === p2.elementId)!;

    const serviceOut = service.ports.find((p) => p.direction === 'out' && p.channel === 'call')!;
    const tpIn = thirdparty.ports.find((p) => p.direction === 'in' && p.channel === 'call')!;

    const plan = planConnection({
      document: doc2,
      viewId,
      source: { elementId: service.id, portId: serviceOut.id },
      target: { elementId: thirdparty.id, portId: tpIn.id },
      mintId,
    });

    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') return;

    const connChange = plan.changes.find((c) => c.kind === 'insert' && c.value.recordKind === 'connection');
    expect((connChange as any).value.record.config.resource).toBeNull();
    expect((connChange as any).value.record.config.latencyMs).toBe(0);
    expect((connChange as any).value.record.config.weight).toBe(1);

    const finalDoc = applyChanges(doc2, plan.changes);
    expect(validateDocument(finalDoc).ok).toBe(true);
  });

  it('connecting to a resource element requires interactive metadata (needs-resource-metadata)', () => {
    const mintId = createMintId();
    const { document: baseDoc, viewId } = makeBlankDocument(mintId);

    // Gateway -> Service (resource)
    const p1 = place(baseDoc, viewId, 'gateway', { x: 0, y: 0 }, mintId);
    const doc1 = applyChanges(baseDoc, p1.changes);

    const p2 = place(doc1, viewId, 'service', { x: 300, y: 0 }, mintId);
    const doc2 = applyChanges(doc1, p2.changes);

    const gateway = doc2.elements.find((e) => e.id === p1.elementId)!;
    const service = doc2.elements.find((e) => e.id === p2.elementId)!;
    const gatewayOut = gateway.ports.find((p) => p.direction === 'out' && p.channel === 'call')!;

    // Pass target as { elementId }
    const plan = planConnection({
      document: doc2,
      viewId,
      source: { elementId: gateway.id, portId: gatewayOut.id },
      target: { elementId: service.id },
      mintId,
    });

    expect(plan.kind).toBe('needs-resource-metadata');
    if (plan.kind !== 'needs-resource-metadata') return;

    // Reject invalid metadata
    const badComplete = completeConnection(plan.draft, {
      requestClassId: '',
      operation: 'read',
      deadlineDurationMs: 0,
    });
    expect(badComplete.ok).toBe(false);

    // Complete with valid metadata
    const complete = completeConnection(plan.draft, {
      requestClassId: mintId(),
      operation: 'read',
      deadlineDurationMs: 500,
    });

    expect(complete.ok).toBe(true);
    if (!complete.ok) return;

    const connChange = complete.changes.find((c) => c.kind === 'insert' && c.value.recordKind === 'connection');
    expect((connChange as any).value.record.config.resource).toEqual({
      requestClassId: expect.any(String),
      operation: 'read',
      key: null,
      tags: [],
      deadlineDurationMs: 500,
    });

    const finalDoc = applyChanges(doc2, complete.changes);
    expect(validateDocument(finalDoc).ok).toBe(true);
  });

  it('Resolution 11: router/broker route addition adds a NEW out port when existing out port is connected', () => {
    const mintId = createMintId();
    const { document: baseDoc, viewId } = makeBlankDocument(mintId);

    // Balancer -> Service 1, then Balancer -> Service 2
    const pB = place(baseDoc, viewId, 'balancer', { x: 0, y: 0 }, mintId);
    const pS1 = place(baseDoc, viewId, 'service', { x: 300, y: 0 }, mintId);
    const pS2 = place(baseDoc, viewId, 'service', { x: 300, y: 200 }, mintId);

    let doc = applyChanges(baseDoc, pB.changes);
    doc = applyChanges(doc, pS1.changes);
    doc = applyChanges(doc, pS2.changes);

    const balancer = doc.elements.find((e) => e.id === pB.elementId)!;
    const s1 = doc.elements.find((e) => e.id === pS1.elementId)!;
    const s2 = doc.elements.find((e) => e.id === pS2.elementId)!;
    const balancerOut1 = balancer.ports.find((p) => p.direction === 'out')!;

    // Connection 1: Balancer out1 -> S1
    const plan1 = planConnection({
      document: doc,
      viewId,
      source: { elementId: balancer.id, portId: balancerOut1.id },
      target: { elementId: s1.id },
      mintId,
    });
    expect(plan1.kind).toBe('needs-resource-metadata');
    if (plan1.kind !== 'needs-resource-metadata') return;

    const comp1 = completeConnection(plan1.draft, {
      requestClassId: mintId(),
      operation: 'read',
      deadlineDurationMs: 200,
    });
    expect(comp1.ok).toBe(true);
    if (!comp1.ok) return;

    doc = applyChanges(doc, comp1.changes);
    expect(validateDocument(doc).ok).toBe(true);

    // Connection 2 from same balancer out1 -> S2: Resolution 11 triggers!
    const plan2 = planConnection({
      document: doc,
      viewId,
      source: { elementId: balancer.id, portId: balancerOut1.id },
      target: { elementId: s2.id },
      mintId,
    });
    expect(plan2.kind).toBe('needs-resource-metadata');
    if (plan2.kind !== 'needs-resource-metadata') return;

    // Check that draft has sourceElementReplacement with 3 ports (1 in, 2 out)
    expect(plan2.draft.sourceElementReplacement).toBeDefined();
    expect(plan2.draft.sourceElementReplacement!.ports.length).toBe(3);

    const comp2 = completeConnection(plan2.draft, {
      requestClassId: mintId(),
      operation: 'read',
      deadlineDurationMs: 200,
    });
    expect(comp2.ok).toBe(true);
    if (!comp2.ok) return;

    doc = applyChanges(doc, comp2.changes);
    expect(validateDocument(doc).ok).toBe(true);

    // Verify Balancer now has 2 out ports and 2 connections
    const updatedBalancer = doc.elements.find((e) => e.id === balancer.id)!;
    expect(updatedBalancer.ports.filter((p) => p.direction === 'out').length).toBe(2);
    expect(doc.connections.length).toBe(2);
  });

  describe('rejection rules', () => {
    it('rejects event-channel ports', () => {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);

      const pSM = place(baseDoc, viewId, 'state-machine', { x: 0, y: 0 }, mintId);
      const pS = place(baseDoc, viewId, 'service', { x: 300, y: 0 }, mintId);
      let doc = applyChanges(baseDoc, pSM.changes);
      doc = applyChanges(doc, pS.changes);

      const sm = doc.elements.find((e) => e.id === pSM.elementId)!;
      const s = doc.elements.find((e) => e.id === pS.elementId)!;
      const smEventPort = sm.ports.find((p) => p.channel === 'event')!;
      const sInPort = s.ports.find((p) => p.direction === 'in')!;

      const plan = planConnection({
        document: doc,
        viewId,
        source: { elementId: sm.id, portId: smEventPort.id },
        target: { elementId: s.id, portId: sInPort.id },
        mintId,
      });

      expect(plan.kind).toBe('rejected');
    });

    it('rejects direction mismatch (in -> in or out -> out)', () => {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);

      const p1 = place(baseDoc, viewId, 'service', { x: 0, y: 0 }, mintId);
      const p2 = place(baseDoc, viewId, 'service', { x: 300, y: 0 }, mintId);
      let doc = applyChanges(baseDoc, p1.changes);
      doc = applyChanges(doc, p2.changes);

      const s1 = doc.elements.find((e) => e.id === p1.elementId)!;
      const s2 = doc.elements.find((e) => e.id === p2.elementId)!;
      const in1 = s1.ports.find((p) => p.direction === 'in')!;
      const in2 = s2.ports.find((p) => p.direction === 'in')!;

      // in -> in
      const planInIn = planConnection({
        document: doc,
        viewId,
        source: { elementId: s1.id, portId: in1.id },
        target: { elementId: s2.id, portId: in2.id },
        mintId,
      });
      expect(planInIn.kind).toBe('rejected');

      // out -> out
      const out1 = s1.ports.find((p) => p.direction === 'out')!;
      const out2 = s2.ports.find((p) => p.direction === 'out')!;
      const planOutOut = planConnection({
        document: doc,
        viewId,
        source: { elementId: s1.id, portId: out1.id },
        target: { elementId: s2.id, portId: out2.id },
        mintId,
      });
      expect(planOutOut.kind).toBe('rejected');
    });

    it('rejects channel mismatch when route addition does not apply', () => {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);

      // Service (out:call) -> Email (in:message)
      const p1 = place(baseDoc, viewId, 'service', { x: 0, y: 0 }, mintId);
      const p2 = place(baseDoc, viewId, 'email', { x: 300, y: 0 }, mintId);
      let doc = applyChanges(baseDoc, p1.changes);
      doc = applyChanges(doc, p2.changes);

      const s = doc.elements.find((e) => e.id === p1.elementId)!;
      const email = doc.elements.find((e) => e.id === p2.elementId)!;
      const sOut = s.ports.find((p) => p.direction === 'out')!;
      const emailIn = email.ports.find((p) => p.direction === 'in')!;

      const plan = planConnection({
        document: doc,
        viewId,
        source: { elementId: s.id, portId: sOut.id },
        target: { elementId: email.id, portId: emailIn.id },
        mintId,
      });
      expect(plan.kind).toBe('rejected');
    });

    it('rejects duplicate connection pair', () => {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);

      const p1 = place(baseDoc, viewId, 'service', { x: 0, y: 0 }, mintId);
      const p2 = place(baseDoc, viewId, 'thirdparty', { x: 300, y: 0 }, mintId);
      let doc = applyChanges(baseDoc, p1.changes);
      doc = applyChanges(doc, p2.changes);

      const s = doc.elements.find((e) => e.id === p1.elementId)!;
      const tp = doc.elements.find((e) => e.id === p2.elementId)!;
      const sOut = s.ports.find((p) => p.direction === 'out')!;
      const tpIn = tp.ports.find((p) => p.direction === 'in')!;

      const plan1 = planConnection({
        document: doc,
        viewId,
        source: { elementId: s.id, portId: sOut.id },
        target: { elementId: tp.id, portId: tpIn.id },
        mintId,
      });
      expect(plan1.kind).toBe('ready');
      if (plan1.kind !== 'ready') return;

      doc = applyChanges(doc, plan1.changes);

      // Try duplicate connection between exact same ports
      const plan2 = planConnection({
        document: doc,
        viewId,
        source: { elementId: s.id, portId: sOut.id },
        target: { elementId: tp.id, portId: tpIn.id },
        mintId,
      });
      expect(plan2.kind).toBe('rejected');
    });

    it('rejects synchronous call cycle (direct self-cycle and multi-hop)', () => {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);

      const p1 = place(baseDoc, viewId, 'service', { x: 0, y: 0 }, mintId);
      const p2 = place(baseDoc, viewId, 'thirdparty', { x: 300, y: 0 }, mintId);
      let doc = applyChanges(baseDoc, p1.changes);
      doc = applyChanges(doc, p2.changes);

      const s1 = doc.elements.find((e) => e.id === p1.elementId)!;
      const s1Out = s1.ports.find((p) => p.direction === 'out')!;
      const s1In = s1.ports.find((p) => p.direction === 'in')!;

      // 1. Direct self-cycle: Service -> Service
      const selfPlan = planConnection({
        document: doc,
        viewId,
        source: { elementId: s1.id, portId: s1Out.id },
        target: { elementId: s1.id, portId: s1In.id },
        mintId,
      });
      expect(selfPlan.kind).toBe('rejected');

      // 2. Multi-hop cycle: S1 -> TP, then try TP -> S1
      // Connect S1 -> TP
      const tp = doc.elements.find((e) => e.id === p2.elementId)!;
      const tpIn = tp.ports.find((p) => p.direction === 'in')!;

      const plan1 = planConnection({
        document: doc,
        viewId,
        source: { elementId: s1.id, portId: s1Out.id },
        target: { elementId: tp.id, portId: tpIn.id },
        mintId,
      });
      expect(plan1.kind).toBe('ready');
      if (plan1.kind !== 'ready') return;
      doc = applyChanges(doc, plan1.changes);

      // Add out:call port to TP so it could call S1
      const tpOutPortId = mintId();
      const tpWithOut = {
        ...tp,
        ports: [
          ...tp.ports,
          {
            id: tpOutPortId,
            label: 'out',
            direction: 'out' as const,
            channel: 'call' as const,
            schemaId: s1.ports[0].schemaId,
            responseSchemaId: s1.ports[0].responseSchemaId,
          },
        ],
      };
      doc = {
        ...doc,
        elements: doc.elements.map((e) => (e.id === tp.id ? tpWithOut : e)),
      };

      // Try TP -> S1 (closing cycle S1 -> TP -> S1)
      const cyclePlan = planConnection({
        document: doc,
        viewId,
        source: { elementId: tp.id, portId: tpOutPortId },
        target: { elementId: s1.id, portId: s1In.id },
        mintId,
      });
      expect(cyclePlan.kind).toBe('rejected');
    });

    it('rejects incompatible payload shapes', () => {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);

      const p1 = place(baseDoc, viewId, 'service', { x: 0, y: 0 }, mintId);
      const p2 = place(baseDoc, viewId, 'thirdparty', { x: 300, y: 0 }, mintId);
      let doc = applyChanges(baseDoc, p1.changes);
      doc = applyChanges(doc, p2.changes);

      // Mutate TP schema to incompatible shape
      const s = doc.elements.find((e) => e.id === p1.elementId)!;
      const tp = doc.elements.find((e) => e.id === p2.elementId)!;
      const tpIn = tp.ports.find((p) => p.direction === 'in')!;

      const incompatibleSchema: PayloadSchema = {
        id: mintId(),
        label: 'Incompatible',
        shape: {
          type: 'record',
          nullable: false,
          fields: [
            {
              id: mintId(),
              key: 'amount',
              optional: false,
              shape: { type: 'number', nullable: false },
            },
          ],
        },
      };

      const mutatedTpIn: Port = { ...tpIn, schemaId: incompatibleSchema.id };
      doc = {
        ...doc,
        schemas: [...doc.schemas, incompatibleSchema],
        elements: doc.elements.map((e) =>
          e.id === tp.id
            ? { ...e, ports: e.ports.map((p) => (p.id === tpIn.id ? mutatedTpIn : p)) }
            : e,
        ),
      };

      const sOut = s.ports.find((p) => p.direction === 'out')!;
      const plan = planConnection({
        document: doc,
        viewId,
        source: { elementId: s.id, portId: sOut.id },
        target: { elementId: tp.id, portId: tpIn.id },
        mintId,
      });

      expect(plan.kind).toBe('rejected');
    });
  });
});
