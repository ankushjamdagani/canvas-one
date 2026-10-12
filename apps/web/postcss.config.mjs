import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(startDir) {
  let curr = path.resolve(startDir);
  while (curr && curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'scripts', 'scoped-postcss.cjs'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return null;
}

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = findRoot(fileDir) || findRoot(process.cwd()) || path.resolve(fileDir, '../..');
const scopedPostcss = path.join(rootDir, 'scripts', 'scoped-postcss.cjs');

export default {
  plugins: {
    '@tailwindcss/postcss': { base: rootDir },
    [scopedPostcss]: {},
  },
};
