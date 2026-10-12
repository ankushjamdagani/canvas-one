import { validatePortableBundle as validateArchive } from '@canvas-one/simulation-system-design/archive';
import { STORAGE_LIMITS } from './types';
export * from '@canvas-one/simulation-system-design/archive/validation';
export function validatePortableBundle(bytes: Uint8Array) {
  return validateArchive(bytes, STORAGE_LIMITS);
}
