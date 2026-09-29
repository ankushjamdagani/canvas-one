import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const retiredPath = /(?:^|\/)(?:state\/editor|persistence\/projects|simulation\/(?:engine|jobs|worker))(?:$|[.?])/;

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
  it('does not import the old editor, persistence, or worker paths from production source', () => {
    const violations: string[] = [];
    for (const path of productionSources(sourceRoot)) {
      const source = readFileSync(path, 'utf8');
      const imports = source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/g);
      for (const [, specifier] of imports) {
        if (retiredPath.test(specifier)) {
          violations.push(`${path.slice(sourceRoot.length)}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
