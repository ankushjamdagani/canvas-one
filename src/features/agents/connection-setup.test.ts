import { describe, expect, it } from 'vitest';
import { localServiceCommand, parseConnectionDetails } from './connection-setup';

const pairingSecret = 'a'.repeat(64);
describe('local connection setup', () => {
  it('accepts actual CLI JSON without assuming its port', () => {
    expect(parseConnectionDetails(JSON.stringify({ version: 1, url: 'http://127.0.0.1:53219', pairingSecret, leaseMs: 15000 }))).toEqual({ url: 'http://127.0.0.1:53219', pairingSecret });
  });
  it.each(['http://localhost:1234', 'https://127.0.0.1:1234', 'http://example.com', 'http://127.0.0.1:1234/path', 'http://user@127.0.0.1:1234', 'http://127.0.0.1:1234/?token=x'])('rejects unsupported address %s before pairing', url => {
    expect(() => parseConnectionDetails(JSON.stringify({ url, pairingSecret }))).toThrow('127.0.0.1');
  });
  it('bounds and validates pasted input', () => {
    for (const value of ['{', 'null', '[]', '{}', 'a'.repeat(8193), JSON.stringify({ url: 'http://127.0.0.1:1234', pairingSecret: 'short' })]) expect(() => parseConnectionDetails(value)).toThrow();
  });
  it('uses the current browser origin in the command', () => {
    expect(localServiceCommand('http://localhost:3001')).toBe("node packages/cli/dist/main.js collaborate --origin 'http://localhost:3001'");
    expect(localServiceCommand("http://host'bad")).toContain("'\\''");
  });
});
