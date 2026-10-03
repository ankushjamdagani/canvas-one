import { describe, expect, it } from 'vitest';
import { PROTOCOLS, PROTOCOL_LABELS, defaultProtocol, isProtocolOf, protocolsFor } from './protocols';
import { VISUAL_KINDS } from './model';
import { validateDocument } from './validate';
import { buildManifest } from './manifest';
import { isExposureList } from './exposure';
import type { Document } from './model';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const S01 = JSON.parse(readFileSync(resolve(__dirname, '../../../specs/revamp/fixtures/s01.json'), 'utf8')) as Document;

describe('protocols (D53)', () => {
  it('has a label for every protocol and none is listed under two channels', () => {
    const all = Object.values(PROTOCOLS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const protocol of all) expect(PROTOCOL_LABELS[protocol]).toBeTruthy();
  });

  it('every visual kind has a default protocol inside its channel, and event ports have none', () => {
    for (const kind of VISUAL_KINDS) {
      for (const channel of ['call', 'message', 'data'] as const) {
        expect(protocolsFor(channel)).toContain(defaultProtocol(kind, channel));
      }
      expect(defaultProtocol(kind, 'event')).toBeNull();
    }
    expect(defaultProtocol('database', 'call')).toBe('sql');
    expect(defaultProtocol('service', 'call')).toBe('http');
  });

  it('checks a protocol against its channel', () => {
    expect(isProtocolOf('call', 'grpc')).toBe(true);
    expect(isProtocolOf('call', 'kafka')).toBe(false);
    expect(isProtocolOf('event', 'http')).toBe(false);
  });

  it('validates the port protocol: it must fit the channel', () => {
    const withPort = (patch: Record<string, unknown>) => {
      const el = S01.elements.find((e) => e.ports.some((p) => p.direction === 'in' && p.channel === 'call'))!;
      const port = el.ports.find((p) => p.direction === 'in' && p.channel === 'call')!;
      return {
        ...S01,
        elements: S01.elements.map((e) => (e.id === el.id ? { ...e, ports: e.ports.map((p) => (p.id === port.id ? { ...p, ...patch } : p)) } : e)),
      } as unknown as Document;
    };
    expect(validateDocument(withPort({ protocol: 'grpc' })).ok).toBe(true);
    expect(validateDocument(withPort({ protocol: 'kafka' })).ok).toBe(false);
  });

  it('the run manifest ignores a port protocol', async () => {
    const el = S01.elements.find((e) => e.ports.some((p) => p.direction === 'in' && p.channel === 'call'))!;
    const port = el.ports.find((p) => p.direction === 'in' && p.channel === 'call')!;
    const marked = {
      ...S01,
      elements: S01.elements.map((e) => (e.id === el.id ? { ...e, ports: e.ports.map((p) => (p.id === port.id ? { ...p, protocol: 'grpc' } : p)) } : e)),
    } as unknown as Document;
    const scenarioId = S01.scenarios[0]?.id;
    if (!scenarioId) throw new Error('fixture has no scenario');
    expect(await buildManifest(marked, scenarioId, DEFAULT_BUILD_VERSIONS)).toEqual(await buildManifest(S01, scenarioId, DEFAULT_BUILD_VERSIONS));
  });

  it('accepts only well-formed exposure lists', () => {
    expect(isExposureList([])).toBe(true);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc' }, { channel: 'message', protocol: 'kafka' }])).toBe(true);
    expect(isExposureList([{ channel: 'call', protocol: 'kafka' }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc' }, { channel: 'call', protocol: 'grpc' }])).toBe(false);
    expect(isExposureList([{ channel: 'event', protocol: 'grpc' }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc', extra: 1 }])).toBe(false);
    expect(isExposureList('call')).toBe(false);
  });
});
