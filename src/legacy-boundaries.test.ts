import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const retiredPath = /(?:^|\/)(?:state\/editor|persistence\/projects|simulation\/(?:engine|jobs|worker)|domain\/(?:model|results|openResults|metrics|notes|subsystems|revisions))(?:$|[.?])/;

/** Relative specifiers resolve against the importing file so `domain/studio/model` never matches `domain/model`. */
function normalizedSpecifier(path: string, specifier: string): string {
  return specifier.startsWith('.') ? relative(sourceRoot, resolve(dirname(path), specifier)) : specifier;
}

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('retired runtime boundaries', () => {
  it('does not import the old editor, persistence, worker or graph-model paths from production source', () => {
    const violations: string[] = [];
    for (const path of productionSources(sourceRoot)) {
      const source = readFileSync(path, 'utf8');
      const imports = source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/g);
      for (const [, specifier] of imports) {
        if (retiredPath.test(normalizedSpecifier(path, specifier))) {
          violations.push(`${path.slice(sourceRoot.length)}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
