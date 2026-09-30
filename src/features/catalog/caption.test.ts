import { describe, expect, it } from 'vitest';
import { defaultsLine, libraryCaption } from './caption';
import { CATALOG_ENTRIES, getEntry } from './catalog';

describe('caption.ts', () => {
  describe('libraryCaption', () => {
    it('joins entry tags with " · "', () => {
      const service = getEntry('service')!;
      expect(libraryCaption(service)).toBe('processor · retries');

      const queue = getEntry('queue')!;
      expect(libraryCaption(queue)).toBe('broker · competing');

      const pubsub = getEntry('pubsub')!;
      expect(libraryCaption(pubsub)).toBe('broker · broadcast');

      const dns = getEntry('dns')!;
      expect(libraryCaption(dns)).toBe('not simulated');

      const email = getEntry('email')!;
      expect(libraryCaption(email)).toBe('not simulated');
    });
  });

  describe('defaultsLine', () => {
    it('returns "DEFAULTS · none" for unmodeled and unconfigured entries', () => {
      const email = getEntry('email')!;
      expect(defaultsLine(email)).toBe('DEFAULTS · none');

      const traffic = getEntry('traffic')!;
      expect(defaultsLine(traffic)).toBe('DEFAULTS · none');

      const host = getEntry('host')!;
      expect(defaultsLine(host)).toBe('DEFAULTS · none');

      const custom = getEntry('custom')!;
      expect(defaultsLine(custom)).toBe('DEFAULTS · none');
    });

    it('formats processor defaults line', () => {
      const service = getEntry('service')!;
      expect(defaultsLine(service)).toBe('DEFAULTS · Capacity per slot 2000/s, Concurrency 64, Queue limit 500, Service time Variable (exponential)');

      const worker = getEntry('worker')!;
      expect(defaultsLine(worker)).toBe(
        'DEFAULTS · Capacity per slot 100/s, Concurrency 2, Queue limit 0, Max retries 2, Service time Variable (exponential)',
      );
    });

    it('formats storage defaults line', () => {
      const db = getEntry('database')!;
      expect(defaultsLine(db)).toBe(
        'DEFAULTS · Capacity per slot 500/s, Write capacity 200/s, Queue limit 500, Service time Variable (exponential)',
      );

      const nosql = getEntry('nosql')!;
      expect(defaultsLine(nosql)).toBe(
        'DEFAULTS · Capacity per slot 2000/s, Write capacity 1000/s, Queue limit 500, Service time Variable (exponential)',
      );
    });

    it('formats router defaults line', () => {
      const gateway = getEntry('gateway')!;
      expect(defaultsLine(gateway)).toBe(
        'DEFAULTS · Strategy Round robin, Capacity per slot 2000/s, Queue limit 500, Service time Variable (exponential)',
      );
    });

    it('formats cache defaults line', () => {
      const cache = getEntry('cache')!;
      expect(defaultsLine(cache)).toBe(
        'DEFAULTS · Mode LRU, Hit rate 80%, Entries 1000, TTL 60000ms, Capacity per slot 5000/s, Service time Variable (exponential)',
      );
    });

    it('formats broker defaults line', () => {
      const queue = getEntry('queue')!;
      expect(defaultsLine(queue)).toBe(
        'DEFAULTS · Delivery Competing, Capacity per slot 2000/s, Queue limit 10000, Service time Variable (exponential)',
      );

      const pubsub = getEntry('pubsub')!;
      expect(defaultsLine(pubsub)).toBe(
        'DEFAULTS · Delivery Broadcast, Capacity per slot 2000/s, Queue limit 10000, Service time Variable (exponential)',
      );
    });

    it('never exposes resource config storage keys', () => {
      for (const entry of CATALOG_ENTRIES) {
        expect(defaultsLine(entry)).not.toMatch(
          /\b(?:queueLimit|writeCapacity|hitRate|maxRetries|retryDelayMs|ttlMs)\b/,
        );
      }
    });
  });
});
