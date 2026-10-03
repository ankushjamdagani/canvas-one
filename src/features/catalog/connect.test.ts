import { describe, expect, it } from 'vitest';
import type { Document, Id, PayloadSchema, Port } from '../../domain/studio/model';
import { validateDocument } from '../../domain/studio/validate';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import type { RecordChange } from '../../persistence/studio/types';
import { completeConnection, planConnection } from './connect';
import { describeConnection } from '../../domain/studio/connection-label';
import type { ProjectExposure } from '../../domain/studio/exposure';
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

  describe('connection types (D53)', () => {
    const exposure = (protocol: ProjectExposure['protocol'], path = ''): ProjectExposure => ({ channel: 'call', protocol, path });

    function setup() {
      const mintId = createMintId();
      const { document: baseDoc, viewId } = makeBlankDocument(mintId);
      let doc = baseDoc;
      const add = (kind: string, x: number): Id => {
        const placed = place(doc, viewId, kind, { x, y: 0 }, mintId);
        doc = applyChanges(doc, placed.changes);
        return placed.elementId;
      };
      const el = (id: Id) => doc.elements.find((e) => e.id === id)!;
      const connect = (from: Id, to: Id, extra: { protocol?: ProjectExposure['protocol']; path?: string; linkedExposures?: readonly ProjectExposure[] } = {}) => {
        const plan = planConnection({
          document: doc, viewId,
          source: { elementId: from, portId: el(from).ports.find((p) => p.direction === 'out' && p.channel !== 'event')!.id },
          target: { elementId: to }, mintId, ...extra,
        });
        if (plan.kind === 'rejected') return plan;
        if (plan.kind === 'ready') { doc = applyChanges(doc, plan.changes); return plan; }
        const done = completeConnection(plan.draft, { requestClassId: mintId(), requestClassLabel: 'R', operation: 'read', deadlineDurationMs: 500 });
        if (!done.ok) throw new Error(JSON.stringify(done));
        doc = applyChanges(doc, done.changes);
        return plan;
      };
      const ports = (id: Id, direction: 'in' | 'out') => el(id).ports.filter((p) => p.direction === direction && p.channel === 'call');
      return { add, el, connect, ports, getDoc: () => doc, viewId, mintId, setDoc: (d: Document) => { doc = d; } };
    }

    it("uses the target's type by default and adds the missing out-port on the source", () => {
      const t = setup();
      const service = t.add('service', 0);
      const db1 = t.add('database', 300);
      const db2 = t.add('database', 600);
      t.connect(service, db1);
      expect(t.ports(service, 'out').map((p) => p.protocol)).toEqual(['http', 'sql']);
      expect(t.ports(db1, 'in')).toHaveLength(1);
      // A second SQL dependency reuses the same out-port.
      t.connect(service, db2);
      expect(t.ports(service, 'out')).toHaveLength(2);
      expect(validateDocument(t.getDoc()).ok).toBe(true);
    });

    it('a new connection type adds the port to both nodes, and later connections of that type reuse it', () => {
      const t = setup();
      const a = t.add('service', 0);
      const b = t.add('service', 300);
      const c = t.add('service', 600);
      const plan = t.connect(a, b, { protocol: 'grpc' });
      expect(plan.kind).toBe('needs-resource-metadata');
      expect(t.ports(b, 'in').map((p) => p.protocol)).toEqual(['http', 'grpc']);
      expect(t.ports(a, 'out').map((p) => p.protocol)).toEqual(['http', 'grpc']);
      t.connect(a, c, { protocol: 'grpc' });
      expect(t.ports(a, 'out')).toHaveLength(2);
      expect(t.ports(c, 'in').map((p) => p.protocol)).toEqual(['http', 'grpc']);
      // The default type still uses the original ports.
      const d = t.add('service', 900);
      t.connect(a, d, { protocol: 'http' });
      expect(t.ports(a, 'out')).toHaveLength(2);
      expect(t.ports(d, 'in')).toHaveLength(1);
      expect(validateDocument(t.getDoc()).ok).toBe(true);
    });

    it('a path or name is part of the endpoint: each distinct path gets its own port on both nodes, and a repeat reuses it', () => {
      const t = setup();
      const a = t.add('service', 0);
      const b = t.add('service', 300);
      const c = t.add('service', 600);
      const plan = t.connect(a, b, { path: '/orders' });
      if (plan.kind !== 'needs-resource-metadata') throw new Error(plan.kind);
      expect(plan.draft.path).toBe('/orders');
      // The connection stores no label: it reads as its channel plus the protocol and path of the port it enters.
      const connection = t.getDoc().connections[t.getDoc().connections.length - 1];
      expect('label' in connection).toBe(false);
      expect(describeConnection(t.getDoc(), connection)).toBe('call · HTTP / REST /orders');
      expect(t.ports(b, 'in').map((p) => p.path)).toEqual([undefined, '/orders']);
      expect(t.ports(a, 'out').map((p) => p.path)).toEqual([undefined, '/orders']);
      expect(t.ports(b, 'in')[1].label).toBe('HTTP / REST /orders');

      // The same path on another node adds that node's port; a second path adds a second port on the source.
      t.connect(a, c, { path: '/orders' });
      expect(t.ports(a, 'out')).toHaveLength(2);
      t.connect(a, c, { path: '/invoices' });
      expect(t.ports(a, 'out').map((p) => p.path)).toEqual([undefined, '/orders', '/invoices']);
      expect(t.ports(c, 'in').map((p) => p.path)).toEqual([undefined, '/orders', '/invoices']);
      expect(validateDocument(t.getDoc()).ok).toBe(true);
    });

    it('defaults the path to the target\'s own and offers the paths it has for the type', () => {
      const t = setup();
      const a = t.add('service', 0);
      const b = t.add('service', 300);
      t.connect(a, b, { path: '/orders' });
      const d = t.add('service', 600);
      // A fresh caller to b: the entry port has no path, so the default is none; /orders is offered.
      const plan = t.connect(d, b);
      if (plan.kind !== 'needs-resource-metadata') throw new Error(plan.kind);
      expect(plan.draft.path).toBe('');
      expect(plan.draft.pathOptions).toEqual(['', '/orders']);
    });

    it('rejects a path longer than the limit', () => {
      const t = setup();
      const a = t.add('service', 0);
      const b = t.add('service', 300);
      const res = t.connect(a, b, { path: 'x'.repeat(121) });
      expect(res.kind).toBe('rejected');
    });

    it('rejects a type that is not valid for the channel, and shapes that conflict on an existing pair', () => {
      const t = setup();
      const a = t.add('service', 0);
      const b = t.add('service', 300);
      const bad = t.connect(a, b, { protocol: 'kafka' });
      expect(bad.kind).toBe('rejected');

      const inPort = t.ports(b, 'in')[0];
      const schema = t.getDoc().schemas.find((x) => x.id === inPort.schemaId)!;
      t.setDoc(applyChanges(t.getDoc(), [{
        kind: 'replace',
        value: { recordKind: 'schema', record: { ...schema, shape: { type: 'record', nullable: false, fields: [{ id: t.mintId(), key: 'x', optional: false, shape: { type: 'string', nullable: false } }] } } },
      }] as never));
      const conflict = t.connect(a, b);
      expect(conflict.kind).toBe('rejected');
      if (conflict.kind === 'rejected') expect(conflict.issues[0].message).toMatch(/Incompatible payload shapes/);
    });

    it('offers the channel types in the draft and the chosen one is recorded', () => {
      const t = setup();
      const a = t.add('service', 0);
      const b = t.add('service', 300);
      const plan = t.connect(a, b);
      if (plan.kind !== 'needs-resource-metadata') throw new Error(plan.kind);
      expect(plan.draft.protocol).toBe('http');
      expect(plan.draft.protocolOptions).toContain('grpc');
      expect(plan.draft.protocolOptions).not.toContain('kafka');
    });

    describe('linked projects', () => {
      function linkedSetup(exposures: readonly ProjectExposure[]) {
        const t = setup();
        const caller = t.add('service', 0);
        const placed = placeEntry({
          document: t.getDoc(), viewId: t.viewId, entryId: 'linked-project', anchor: { x: 300, y: 0 }, mintId: t.mintId,
          link: { projectId: '00000000-0000-4000-8000-0000000000aa', title: 'Orders system', exposures },
        });
        if (!placed.ok) throw new Error(JSON.stringify(placed.issues));
        t.setDoc(applyChanges(t.getDoc(), placed.changes));
        return { ...t, caller, linked: placed.elementId };
      }

      it('connects with an exposed type and validates', () => {
        const t = linkedSetup([exposure('http'), exposure('grpc')]);
        expect(t.connect(t.caller, t.linked, { linkedExposures: [exposure('http'), exposure('grpc')] }).kind).toBe('needs-resource-metadata');
        expect(t.connect(t.caller, t.linked, { protocol: 'grpc', linkedExposures: [exposure('http'), exposure('grpc')] }).kind).toBe('needs-resource-metadata');
        expect(t.ports(t.linked, 'in')).toHaveLength(2);
        expect(validateDocument(t.getDoc()).ok).toBe(true);
      });

      it('never adds a type the project does not expose', () => {
        const live = [exposure('http')];
        const t = linkedSetup(live);
        const res = t.connect(t.caller, t.linked, { protocol: 'grpc', linkedExposures: live });
        expect(res.kind).toBe('rejected');
        if (res.kind === 'rejected') expect(res.issues[0].message).toMatch(/doesn't expose gRPC/);
        expect(t.ports(t.linked, 'in')).toHaveLength(1);
      });

      it('matches the exposed path too: an unexposed path is rejected, an exposed one connects', () => {
        const live = [exposure('http', '/orders')];
        const t = linkedSetup(live);
        const wrong = t.connect(t.caller, t.linked, { path: '/refunds', linkedExposures: live });
        expect(wrong.kind).toBe('rejected');
        if (wrong.kind === 'rejected') expect(wrong.issues[0].message).toMatch(/doesn't expose HTTP \/ REST \/refunds/);
        const right = t.connect(t.caller, t.linked, { path: '/orders', linkedExposures: live });
        expect(right.kind).toBe('needs-resource-metadata');
        expect(t.ports(t.linked, 'in').map((p) => p.path)).toEqual(['/orders']);
      });

      it('adds a type the project started exposing after the link', () => {
        const t = linkedSetup([exposure('http')]);
        const live = [exposure('http'), exposure('thrift')];
        const plan = t.connect(t.caller, t.linked, { protocol: 'thrift', linkedExposures: live });
        expect(plan.kind).toBe('needs-resource-metadata');
        expect(t.ports(t.linked, 'in').map((p) => p.protocol)).toEqual(['http', 'thrift']);
        expect(validateDocument(t.getDoc()).ok).toBe(true);
      });

      it('offers only the exposed types in the form', () => {
        const live = [exposure('http'), exposure('grpc')];
        const t = linkedSetup(live);
        const plan = t.connect(t.caller, t.linked, { linkedExposures: live });
        if (plan.kind !== 'needs-resource-metadata') throw new Error(plan.kind);
        expect([...plan.draft.protocolOptions].sort()).toEqual(['grpc', 'http']);
      });
    });
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
    expect((connChange as any).value.record.config.latencyMs).toBe(2); // D49 default
    expect((connChange as any).value.record.config.retry).toBeNull();
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
      requestClassLabel: 'Order',
      operation: 'read',
      deadlineDurationMs: 0,
    });
    expect(badComplete.ok).toBe(false);

    const requestClassId = mintId();
    for (const requestClassLabel of ['', '😀'.repeat(61)]) {
      expect(completeConnection(plan.draft, {
        requestClassId, requestClassLabel, operation: 'read', deadlineDurationMs: 500,
      }).ok).toBe(false);
    }
    expect(completeConnection(plan.draft, {
      requestClassId, requestClassLabel: '😀'.repeat(60), operation: 'read', deadlineDurationMs: 500,
    }).ok).toBe(true);

    // Complete with valid metadata
    const complete = completeConnection(plan.draft, {
      requestClassId,
      requestClassLabel: 'Order',
      operation: 'read',
      deadlineDurationMs: 500,
    });

    expect(complete.ok).toBe(true);
    if (!complete.ok) return;

    const connChange = complete.changes.find((c) => c.kind === 'insert' && c.value.recordKind === 'connection');
    expect((connChange as any).value.record.config.resource).toEqual({
      requestClassId,
      requestClassLabel: 'Order',
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
      requestClassLabel: 'Order',
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
      requestClassLabel: 'Order',
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
            protocol: 'http' as const,
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
