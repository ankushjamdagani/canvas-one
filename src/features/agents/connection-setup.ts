import { CollaborationBrowserClient } from '@canvas-one/agent-bridge';

export const CONNECTION_DETAILS_LIMIT = 8192;

/** Validate without making a request; the transport remains the URL authority. */
export function parseConnectionDetails(input: string): { url: string; pairingSecret: string } {
  if (input.length > CONNECTION_DETAILS_LIMIT) throw new Error('Connection details are too long. Copy only the JSON printed by the service.');
  let details: unknown;
  try { details = JSON.parse(input); } catch { throw new Error('Paste the complete JSON printed by the local service.'); }
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('Paste the connection details printed by the local service.');
  const { url, pairingSecret } = details as Record<string, unknown>;
  if (typeof url !== 'string' || url.length > 2048) throw new Error('Connection details need a local service address.');
  try { new CollaborationBrowserClient({ url, fetch: globalThis.fetch, now: () => 0 }); } catch { throw new Error('Use the http://127.0.0.1 address printed by the local service.'); }
  if (typeof pairingSecret !== 'string' || !/^[a-f0-9]{64}$/.test(pairingSecret)) throw new Error('Use the full pairing secret printed by the local service.');
  return { url, pairingSecret };
}

export function localServiceCommand(origin: string): string {
  // Shell quote the actual browser origin, including embedded quotes defensively.
  return `node packages/cli/dist/main.js collaborate --origin '${origin.replaceAll("'", "'\\''")}'`;
}
