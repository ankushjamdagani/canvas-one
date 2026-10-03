import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { validateDocument } from '../../domain/studio/validate';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import { CATALOG_ENTRIES } from './catalog';
import type { ProjectExposure } from '../../domain/studio/exposure';
import { placeEntry } from './place';

const FIXTURES_DIR = fileURLToPath(
  new URL('../../../specs/revamp/fixtures', import.meta.url),
);

function loadFixture(name: string): Document {
  const raw = readFileSync(resolve(FIXTURES_DIR, name), 'utf8');
  return JSON.parse(raw) as Document;
}

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
    title: 'Blank Test System',
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

// D52: the linked-project entry can only be placed with the project it links to.
const LINKED_PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';
const LINKED_EXPOSURES: readonly ProjectExposure[] = [
  { channel: 'call', protocol: 'http', path: '' },
  { channel: 'call', protocol: 'grpc', path: '/orders', contract: { expectedP95Ms: 80, idempotent: true } },
];

function linkFor(visualKind: string) {
  return visualKind === 'linked-project' ? { projectId: LINKED_PROJECT_ID, title: 'Orders system', exposures: LINKED_EXPOSURES } : undefined;
}

describe('place.ts', () => {
  describe('validation and error handling', () => {
    it('rejects when mintId is missing or not a function', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);
      const res = placeEntry({
        document,
        viewId,
        entryId: 'service',
        anchor: { x: 100, y: 100 },
        mintId: undefined as any,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues.some((i) => i.path.includes('mintId'))).toBe(true);
      }
    });

    it('rejects unknown viewId', () => {
      const mintId = createMintId();
      const { document } = makeBlankDocument(mintId);
      const res = placeEntry({
        document,
        viewId: '00000000-0000-4000-8000-999999999999',
        entryId: 'service',
        anchor: { x: 100, y: 100 },
        mintId,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues.some((i) => i.code === 'dangling-reference')).toBe(true);
      }
    });

    it('rejects unknown entryId', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);
      const res = placeEntry({
        document,
        viewId,
        entryId: 'nonexistent-kind',
        anchor: { x: 100, y: 100 },
        mintId,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues.some((i) => i.code === 'dangling-reference')).toBe(true);
      }
    });
  });

  describe('linked-project placement (D52)', () => {
    it('places a linked node with the link, the project title as label and one in-port per exposed connection type', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);
      const res = placeEntry({
        document, viewId, entryId: 'linked-project', anchor: { x: 10, y: 20 }, mintId,
        link: { projectId: LINKED_PROJECT_ID, title: 'Orders system', exposures: LINKED_EXPOSURES },
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const inserted = res.changes.find((c) => c.kind === 'insert' && c.value.recordKind === 'element');
      const element = (inserted as unknown as { value: { record: { label: string; linkedProjectId?: string; ports: { direction: string }[] } } }).value.record;
      expect(element.label).toBe('Orders system');
      expect(element.linkedProjectId).toBe(LINKED_PROJECT_ID);
      expect(element.ports.map((p) => p.direction)).toEqual(['in', 'in']);
      expect(element.ports.map((p) => (p as { protocol?: string }).protocol)).toEqual(['http', 'grpc']);
      expect(element.ports.map((p) => (p as { path?: string }).path)).toEqual([undefined, '/orders']);
      // The project's declared contract arrives with the endpoint.
      expect(element.ports.map((p) => (p as { settings?: unknown }).settings)).toEqual([undefined, { expectedP95Ms: 80, idempotent: true }]);
    });

    it('refuses to link a project that exposes no call connection type (D53)', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);
      const res = placeEntry({
        document, viewId, entryId: 'linked-project', anchor: { x: 0, y: 0 }, mintId,
        link: { projectId: LINKED_PROJECT_ID, title: 'Orders system', exposures: [] },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues[0].message).toMatch(/exposes no call connection type/);
    });

    it('validates: the link is required on linked-project elements and forbidden elsewhere', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);
      const placed = placeEntry({
        document, viewId, entryId: 'linked-project', anchor: { x: 0, y: 0 }, mintId,
        link: { projectId: LINKED_PROJECT_ID, title: 'Orders system', exposures: LINKED_EXPOSURES },
      });
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;
      const applied = applyRecordChanges(document, placed.changes);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(validateDocument(applied.document).ok).toBe(true);

      const element = applied.document.elements.find((e) => e.id === placed.elementId)!;
      const { linkedProjectId: _link, ...unlinked } = element;
      const withoutLink = { ...applied.document, elements: [unlinked] };
      expect(validateDocument(withoutLink as unknown as Document).ok).toBe(false);

      const misused = { ...applied.document, elements: [{ ...element, visualKind: 'service' }] };
      expect(validateDocument(misused as unknown as Document).ok).toBe(false);

      const badId = { ...applied.document, elements: [{ ...element, linkedProjectId: 'not-a-uuid' }] };
      expect(validateDocument(badId as unknown as Document).ok).toBe(false);
    });

    it('rejects a linked node without a link and a link on any other entry', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);
      const missing = placeEntry({ document, viewId, entryId: 'linked-project', anchor: { x: 0, y: 0 }, mintId });
      expect(missing.ok).toBe(false);
      const extra = placeEntry({
        document, viewId, entryId: 'service', anchor: { x: 0, y: 0 }, mintId,
        link: { projectId: LINKED_PROJECT_ID, title: 'x', exposures: LINKED_EXPOSURES },
      });
      expect(extra.ok).toBe(false);
    });
  });

  describe('blank document placement for every catalog entry', () => {
    it('places every catalog entry on a blank document and passes applyRecordChanges + validateDocument', () => {
      for (const entry of CATALOG_ENTRIES) {
        const mintId = createMintId();
        const { document, viewId } = makeBlankDocument(mintId);

        const placeResult = placeEntry({
          document,
          viewId,
          entryId: entry.entryId,
          anchor: { x: 250, y: 350 },
          mintId,
          link: linkFor(entry.visualKind),
        });

        expect(placeResult.ok).toBe(true);
        if (!placeResult.ok) continue;

        // Verify placement properties: width 184, expanded false, anchor x/y
        const viewChange = placeResult.changes.find(
          (c) => c.kind === 'replace' && c.value.recordKind === 'view',
        );
        expect(viewChange).toBeDefined();
        const updatedView = (viewChange as any).value.record;
        const placement = updatedView.placements.find(
          (p: any) => p.elementId === placeResult.elementId,
        );
        expect(placement).toBeDefined();
        expect(placement.x).toBe(250);
        expect(placement.y).toBe(350);
        expect(placement.width).toBe(184);
        expect(placement.expanded).toBe(false);

        // Apply changes
        const applyResult = applyRecordChanges(document, placeResult.changes);
        expect(applyResult.ok).toBe(true);
        if (!applyResult.ok) continue;

        // Validate storable document
        const valResult = validateDocument(applyResult.document);
        expect(valResult.ok).toBe(true);
        if (!valResult.ok) {
          expect(valResult.issues).toEqual([]);
        }
      }
    });
  });

  describe('placement on reference fixture documents (S01–S05)', () => {
    const fixtureNames = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];

    it('places all catalog entries on fixture S01 and passes validation', () => {
      const s01Doc = loadFixture('s01.json');
      const viewId = s01Doc.views[0].id;

      for (const entry of CATALOG_ENTRIES) {
        const mintId = createMintId();
        const placeResult = placeEntry({
          document: s01Doc,
          viewId,
          entryId: entry.entryId,
          anchor: { x: 500, y: 500 },
          mintId,
          link: linkFor(entry.visualKind),
        });

        expect(placeResult.ok).toBe(true);
        if (!placeResult.ok) continue;

        const applyResult = applyRecordChanges(s01Doc, placeResult.changes);
        expect(applyResult.ok).toBe(true);
        if (!applyResult.ok) continue;

        const valResult = validateDocument(applyResult.document);
        expect(valResult.ok).toBe(true);
        if (!valResult.ok) {
          expect(valResult.issues).toEqual([]);
        }
      }
    });

    it('places an entry on every S01–S05 fixture and passes validation', () => {
      for (const fixtureName of fixtureNames) {
        const doc = loadFixture(fixtureName);
        const viewId = doc.views[0].id;
        const mintId = createMintId();

        const placeResult = placeEntry({
          document: doc,
          viewId,
          entryId: 'service',
          anchor: { x: 400, y: 600 },
          mintId,
        });

        expect(placeResult.ok).toBe(true);
        if (!placeResult.ok) continue;

        const applyResult = applyRecordChanges(doc, placeResult.changes);
        expect(applyResult.ok).toBe(true);
        if (!applyResult.ok) continue;

        const valResult = validateDocument(applyResult.document);
        expect(valResult.ok).toBe(true);
      }
    });
  });

  describe('fresh IDs unique across two placements of the same entry', () => {
    it('creates completely disjoint IDs and validates cleanly when placing same entry twice', () => {
      const mintId = createMintId();
      const { document, viewId } = makeBlankDocument(mintId);

      // Placement 1
      const res1 = placeEntry({
        document,
        viewId,
        entryId: 'service',
        anchor: { x: 50, y: 50 },
        mintId,
      });
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;

      const apply1 = applyRecordChanges(document, res1.changes);
      expect(apply1.ok).toBe(true);
      if (!apply1.ok) return;

      // Placement 2
      const res2 = placeEntry({
        document: apply1.document,
        viewId,
        entryId: 'service',
        anchor: { x: 300, y: 50 },
        mintId,
      });
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;

      const apply2 = applyRecordChanges(apply1.document, res2.changes);
      expect(apply2.ok).toBe(true);
      if (!apply2.ok) return;

      const valResult = validateDocument(apply2.document);
      expect(valResult.ok).toBe(true);

      // Verify element IDs are different
      expect(res1.elementId).not.toBe(res2.elementId);
      expect(res1.placementId).not.toBe(res2.placementId);

      // Verify port and schema IDs are mutually disjoint
      const el1 = apply2.document.elements.find((e) => e.id === res1.elementId)!;
      const el2 = apply2.document.elements.find((e) => e.id === res2.elementId)!;

      const el1PortIds = new Set(el1.ports.map((p) => p.id));
      const el2PortIds = new Set(el2.ports.map((p) => p.id));
      for (const id of el1PortIds) {
        expect(el2PortIds.has(id)).toBe(false);
      }

      const el1SchemaIds = new Set(el1.ports.map((p) => p.schemaId));
      const el2SchemaIds = new Set(el2.ports.map((p) => p.schemaId));
      for (const id of el1SchemaIds) {
        expect(el2SchemaIds.has(id)).toBe(false);
      }
    });
  });
});
