import { describe, expect, it } from 'vitest';
import { VALID_KINDS } from '../../domain/execution';
import { VISUAL_KINDS } from '../../domain/studio/model';
import {
  CATALOG_ENTRIES,
  GROUP_STRIPE_COLORS,
  STRIPE_COLORS,
  getEntry,
  groupOf,
  type CatalogGroup,
} from './catalog';

describe('catalog.ts', () => {
  describe('catalog completeness', () => {
    it('contains every VALID_KINDS kind plus state-machine, data-pipeline, host exactly once (32 total)', () => {
      expect(CATALOG_ENTRIES.length).toBe(32);
      expect(CATALOG_ENTRIES.length).toBe(VISUAL_KINDS.length);

      const entryKinds = CATALOG_ENTRIES.map((e) => e.visualKind);
      const uniqueKinds = new Set(entryKinds);
      expect(uniqueKinds.size).toBe(32);

      // Check all 29 VALID_KINDS
      for (const kind of VALID_KINDS) {
        expect(uniqueKinds.has(kind as any)).toBe(true);
      }

      // Check the 3 extra kinds
      expect(uniqueKinds.has('state-machine')).toBe(true);
      expect(uniqueKinds.has('data-pipeline')).toBe(true);
      expect(uniqueKinds.has('host')).toBe(true);
    });

    it('getEntry resolves every entry by entryId and by visualKind', () => {
      for (const entry of CATALOG_ENTRIES) {
        expect(getEntry(entry.entryId)).toBe(entry);
        expect(getEntry(entry.visualKind)).toBe(entry);
      }
      expect(getEntry('nonexistent')).toBeUndefined();
    });
  });

  describe('groups and colours per D35 + D42', () => {
    it('defines colors for all 10 catalog groups with custom having no stripe', () => {
      expect(GROUP_STRIPE_COLORS.Clients).toBe('#4F6D8F');
      expect(GROUP_STRIPE_COLORS.Edge).toBe('#2B7A83');
      expect(GROUP_STRIPE_COLORS.Compute).toBe('#56773A');
      expect(GROUP_STRIPE_COLORS.Messaging).toBe('#8A6A1F');
      expect(GROUP_STRIPE_COLORS.Data).toBe('#8A4F6E');
      expect(GROUP_STRIPE_COLORS.Operations).toBe('#5F646B');
      expect(GROUP_STRIPE_COLORS['State Machine']).toBe('#5A5B8C');
      expect(GROUP_STRIPE_COLORS['Data Pipeline']).toBe('#7A5C3E');
      expect(GROUP_STRIPE_COLORS.Host).toBe('#3A3F3C');
      expect(GROUP_STRIPE_COLORS.Other).toBeNull();
    });

    it('supports lowercase and kebab-case aliases in STRIPE_COLORS', () => {
      expect((STRIPE_COLORS as any).clients).toBe('#4F6D8F');
      expect((STRIPE_COLORS as any)['state-machine']).toBe('#5A5B8C');
      expect((STRIPE_COLORS as any)['data-pipeline']).toBe('#7A5C3E');
      expect((STRIPE_COLORS as any).host).toBe('#3A3F3C');
      expect((STRIPE_COLORS as any).other).toBeNull();
    });

    it('maps thirdparty to Edge (teal stripe) and custom to Other (no stripe)', () => {
      const thirdparty = getEntry('thirdparty')!;
      expect(thirdparty.group).toBe('Edge');
      expect(groupOf(thirdparty)).toBe('Edge');
      expect(GROUP_STRIPE_COLORS[groupOf(thirdparty)]).toBe('#2B7A83');

      const custom = getEntry('custom')!;
      expect(custom.group).toBe('Other');
      expect(groupOf(custom)).toBe('Other');
      expect(GROUP_STRIPE_COLORS[groupOf(custom)]).toBeNull();
    });

    it('maps state-machine, data-pipeline, and host to their own D42 groups', () => {
      const sm = getEntry('state-machine')!;
      expect(sm.group).toBe('State Machine');
      expect(GROUP_STRIPE_COLORS[sm.group]).toBe('#5A5B8C');

      const dp = getEntry('data-pipeline')!;
      expect(dp.group).toBe('Data Pipeline');
      expect(GROUP_STRIPE_COLORS[dp.group]).toBe('#7A5C3E');

      const host = getEntry('host')!;
      expect(host.group).toBe('Host');
      expect(GROUP_STRIPE_COLORS[host.group]).toBe('#3A3F3C');
    });
  });

  describe('reviewed tags list (only modeled behavior, no autoscale)', () => {
    it('no tag in any entry contains "autoscale"', () => {
      for (const entry of CATALOG_ENTRIES) {
        for (const tag of entry.tags) {
          expect(tag.toLowerCase()).not.toContain('autoscale');
        }
      }
    });

    it('every entry has between 1 and 3 tags', () => {
      for (const entry of CATALOG_ENTRIES) {
        expect(entry.tags.length).toBeGreaterThanOrEqual(1);
        expect(entry.tags.length).toBeLessThanOrEqual(3);
      }
    });

    it('unmodeled entries have "not simulated" tag per resolutions 7 & 12', () => {
      const unmodeledNotSimulated = [
        'traffic',
        'client',
        'mobile',
        'device',
        'scheduler',
        'email',
        'monitoring',
        'analytics',
        'secrets',
      ];

      for (const id of unmodeledNotSimulated) {
        const entry = getEntry(id)!;
        expect(entry.behaviorKind).toBe('unmodeled');
        expect(entry.defaultConfig).toBeNull();
        expect(entry.tags).toContain('not simulated');
      }
    });
  });

  describe('models and doesNotModel statements', () => {
    it('every entry has non-empty models and doesNotModel strings', () => {
      for (const entry of CATALOG_ENTRIES) {
        expect(entry.models.trim().length).toBeGreaterThan(0);
        expect(entry.doesNotModel.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
