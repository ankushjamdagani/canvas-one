import { describe, expect, it } from 'vitest';
import { PROTOCOLS, PROTOCOL_LABELS, defaultProtocol, isProtocolOf, protocolsFor } from './protocols';
import { VISUAL_KINDS } from './model';
import { validateDocument } from './validate';
import { buildManifest } from './manifest';
import { declaredContractOf, isExposureList } from './exposure';
import type { Document } from './model';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const S01 = JSON.parse(readFileSync(resolve(__dirname, '../../features/entry/examples/s01.json'), 'utf8')) as Document;

describe('protocols', () => {
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

  it('validates the port protocol and path: every connectable port has a protocol of its channel, the path is bounded', () => {
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
    expect(validateDocument(withPort({ protocol: null })).ok).toBe(false);
    expect(validateDocument(withPort({ path: '/orders' })).ok).toBe(true);
    expect(validateDocument(withPort({ path: '' })).ok).toBe(false);
    expect(validateDocument(withPort({ path: 'x'.repeat(121) })).ok).toBe(false);
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
    expect(isExposureList([{ channel: 'call', protocol: 'grpc', path: '' }, { channel: 'message', protocol: 'kafka', path: 'orders' }])).toBe(true);
    // The same type with two paths is two endpoints.
    expect(isExposureList([{ channel: 'call', protocol: 'http', path: '/a' }, { channel: 'call', protocol: 'http', path: '/b' }])).toBe(true);
    expect(isExposureList([{ channel: 'call', protocol: 'kafka', path: '' }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc', path: '/a' }, { channel: 'call', protocol: 'grpc', path: '/a' }])).toBe(false);
    expect(isExposureList([{ channel: 'event', protocol: 'grpc', path: '' }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc', path: '', extra: 1 }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc' }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc', path: ' /a ' }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'grpc', path: 'x'.repeat(121) }])).toBe(false);
    expect(isExposureList('call')).toBe(false);
    // A declared contract rides along; simulated settings and wrong channels' keys do not.
    expect(isExposureList([{ channel: 'call', protocol: 'http', path: '/a', contract: { expectedP95Ms: 80, idempotent: true } }])).toBe(true);
    expect(isExposureList([{ channel: 'message', protocol: 'kafka', path: 't', contract: { delivery: 'at-least-once', ordering: 'per-key' } }])).toBe(true);
    expect(isExposureList([{ channel: 'call', protocol: 'http', path: '/a', contract: { failureRate: 5 } }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'http', path: '/a', contract: { delivery: 'at-least-once' } }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'http', path: '/a', contract: {} }])).toBe(false);
    expect(isExposureList([{ channel: 'call', protocol: 'http', path: '/a', contract: { expectedP95Ms: -1 } }])).toBe(false);
    expect(declaredContractOf('call', { expectedP95Ms: 80, rateLimit: { rps: 1, burst: 1 }, failureRate: 3 })).toEqual({ expectedP95Ms: 80 });
    expect(declaredContractOf('call', { failureRate: 3 })).toBeUndefined();
    expect(declaredContractOf('call', undefined)).toBeUndefined();
  });
});
