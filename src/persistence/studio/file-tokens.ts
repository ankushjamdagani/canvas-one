/**
 * FileToken registry for System Studio transfer.
 *
 * A FileToken is an opaque local handle bound to user-selected bytes, their hash and size.
 * It expires on reload and cannot be imported or supplied remotely. Bytes are hashed and
 * validated outside transactions.
 *
 * Controller-owned and in memory, same unforgeability pattern as token.ts and
 * publish-ticket.ts: the token handed back is a frozen object whose only durable identity
 * is its entry in a module-instance-private WeakMap. A plain object built from JSON (e.g.
 * `{ id: '...' }`) is never in the registry, so `resolveFile` returns null for it even if
 * its `id` field happens to look like a valid UUID -- this is the "forged/plain token"
 * rejection. A new `FileTokenRegistry` instance (e.g.
 * after a reload) has an empty WeakMap, so every previously minted token expires with it.
 *
 * A bare UUID string cannot be bound to a WeakMap key, so the public `id` field is the
 * UUID (usable for display / `MissingResult.ids`), while the value callers pass as
 * `fileToken` is the frozen token object, whose authenticity is checked by object identity
 * in the registry -- exactly like
 * `RunStartToken` and `PublishTicket`, which are also called "tokens" despite being
 * objects, not primitive strings.
 */

import type { Id } from '../../domain/studio/model';

export type FileToken = {
  readonly id: Id;
};

export type FileTokenBinding = {
  readonly id: Id;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly size: number;
  readonly createdAt: number;
};

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Hashes raw bytes (not canonical JSON text) via Web Crypto SHA-256, lowercase hex.
 * Distinct from `sha256Hex` in canonical.ts, which hashes a canonical-json-v1 *string*;
 * a FileToken's hash is of the exact bytes the user selected, before any decoding.
 */
export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return toHex(digest);
}

/**
 * Controller-owned, in-memory registry of FileTokens. One instance's lifetime is the
 * "session" for transfer purposes: constructing a new registry (e.g. after a page reload)
 * discards every previously minted token.
 */
export class FileTokenRegistry {
  private readonly registry = new WeakMap<object, FileTokenBinding>();

  /**
   * Registers user-selected bytes, hashing and sizing them outside any transaction, and
   * returns an opaque, unforgeable FileToken bound to them.
   */
  async registerFile(bytes: Uint8Array, mintId: () => Id): Promise<FileToken> {
    const sha256 = await sha256HexOfBytes(bytes);
    const id = mintId();
    const binding: FileTokenBinding = Object.freeze({
      id,
      bytes,
      sha256,
      size: bytes.byteLength,
      createdAt: Date.now(),
    });
    const token: FileToken = Object.freeze({ id });
    this.registry.set(token, binding);
    return token;
  }

  /**
   * Resolves a FileToken against this registry's private WeakMap. Returns null for an
   * unknown, expired (different registry instance) or forged/plain token -- never throws,
   * so callers can uniformly treat it as a `missing` result.
   */
  resolveFile(token: unknown): FileTokenBinding | null {
    if (!token || typeof token !== 'object') return null;
    return this.registry.get(token as object) ?? null;
  }
}
