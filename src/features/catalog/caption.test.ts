import { describe, expect, it } from 'vitest';
import { defaultsLine, libraryCaption } from './caption';
import { getEntry } from './catalog';

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
      expect(libraryCaption(dns)).toBe('cache · fixed');

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
      expect(defaultsLine(service)).toBe('DEFAULTS · capacity 2000/s, concurrency 1, queueLimit 500');

      const worker = getEntry('worker')!;
      expect(defaultsLine(worker)).toBe(
        'DEFAULTS · capacity 100/s, concurrency 2, queueLimit 0, maxRetries 2',
      );
    });

    it('formats storage defaults line', () => {
      const db = getEntry('database')!;
      expect(defaultsLine(db)).toBe(
        'DEFAULTS · capacity 500/s, writeCapacity 500/s, queueLimit 500',
      );

      const nosql = getEntry('nosql')!;
      expect(defaultsLine(nosql)).toBe(
        'DEFAULTS · capacity 2000/s, writeCapacity 2000/s, queueLimit 500',
      );
    });

    it('formats router defaults line', () => {
      const gateway = getEntry('gateway')!;
      expect(defaultsLine(gateway)).toBe(
        'DEFAULTS · strategy round-robin, capacity 2000/s, queueLimit 500',
      );
    });

    it('formats cache defaults line', () => {
      const dns = getEntry('dns')!;
      expect(defaultsLine(dns)).toBe(
        'DEFAULTS · mode fixed, hitRate 80%, entries 100, ttl 10000ms, capacity 5000/s',
      );
    });

    it('formats broker defaults line', () => {
      const queue = getEntry('queue')!;
      expect(defaultsLine(queue)).toBe(
        'DEFAULTS · delivery competing, capacity 2000/s, queueLimit 500',
      );

      const pubsub = getEntry('pubsub')!;
      expect(defaultsLine(pubsub)).toBe(
        'DEFAULTS · delivery broadcast, capacity 2000/s, queueLimit 500',
      );
    });
  });
});
