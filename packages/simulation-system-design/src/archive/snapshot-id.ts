import { canonicalJson, sha256Hex } from '@canvas-one/system-design/studio/canonical';
import type { Document } from '@canvas-one/system-design/studio/model';

/** Hash only authored content; archived history records retain their original payloads and identities. */
export async function computeArchiveSnapshotId(document: Document): Promise<string> {
  const canonical = canonicalJson(document);
  if (!canonical.ok) throw new Error('Failed to serialize document to canonical JSON');
  return sha256Hex(canonical.text);
}
