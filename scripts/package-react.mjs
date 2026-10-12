import { readFile, writeFile, copyFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const source = JSON.parse(await readFile('package.json', 'utf8'));
const require = createRequire(import.meta.url);
const boardStyles = await readFile('packages/react/style.css', 'utf8');
await writeFile('dist-react/board.css', boardStyles);
await writeFile('dist-react/reactflow.css', `${await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8')}\n${boardStyles}`);
// Vite can prepend helpers before the output banner. Next requires the directive first.
for (const file of await readdir('dist-react')) {
  if (!file.endsWith('.js')) continue;
  const code = (await readFile(`dist-react/${file}`, 'utf8'))
    .replace(/["']use client["'];?/g, '')
    // Preserve the standard Worker(new URL(relative, import.meta.url)) shape so
    // a consuming bundler emits the worker instead of retaining a file:// base.
    .replace(/new URL\(``\+new URL\(`(assets\/runner\.worker-[^`]+)`,import\.meta\.url\)\.href,``\+import\.meta\.url\)/g,
      (_match, asset) => `new URL(${JSON.stringify(asset)},import.meta.url)`);
  await writeFile(`dist-react/${file}`, `"use client";\n${code}`);
}
await writeFile('dist-react/package.json', JSON.stringify({
  name: '@canvas-one/react', version: source.version, type: 'module', license: source.license,
  description: 'The reusable Canvas One local-first workspace.',
  exports: {
    '.': { types: './types/src/embed/library.d.ts', import: './index.js' },
    './board': {types: './types/composables/react/index.d.ts', import: './board.js'},
    './reactflow': {types: './types/composables/react/reactflow.d.ts', import: './reactflow.js'},
    './styles.css': './styles.css',
    './board.css': './board.css',
    './reactflow.css': './reactflow.css',
  },
  files: ['*.js', '*.css', 'assets', 'types'],
  sideEffects: ['**/*.css'],
  peerDependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' },
}, null, 2) + '\n');
await copyFile('LICENSE', 'dist-react/LICENSE');
await copyFile('docs/embedding.md', 'dist-react/README.md');

// Bundle declarations for workspace-owned contracts into the full-app artifact.
// Its consumers should not need unpublished workspace packages just for types.
const manifests = new Map();
for (const entry of await readdir('packages', {withFileTypes: true})) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(await readFile(`packages/${entry.name}/package.json`, 'utf8'));
  manifests.set(manifest.name, {directory: entry.name, exports: manifest.exports});
}
async function declarationFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await declarationFiles(file));
    else if (entry.name.endsWith('.d.ts')) result.push(file);
  }
  return result;
}
for (const [name, manifest] of manifests) {
  const directory = `packages/${manifest.directory}/dist`;
  for (const file of await declarationFiles(directory)) {
    const target = path.join('dist-react/types/composables', manifest.directory, path.relative(directory, file));
    await mkdir(path.dirname(target), {recursive: true});
    await copyFile(file, target);
  }
}
for (const file of await declarationFiles('dist-react/types')) {
  let declaration = await readFile(file, 'utf8');
  declaration = declaration.replace(/(['"])(@canvas-one\/[^'"\n]+)\1/g, (match, quote, specifier) => {
    const owner = specifier.split('/').slice(0, 2).join('/');
    const manifest = manifests.get(owner);
    if (!manifest) return match;
    const key = specifier === owner ? '.' : '.' + specifier.slice(owner.length);
    const exported = manifest.exports[key];
    const typeFile = typeof exported === 'object' ? exported.types : undefined;
    if (!typeFile) return match;
    const target = path.join('dist-react/types/composables', manifest.directory, typeFile.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '.js'));
    let relative = path.relative(path.dirname(file), target).replaceAll(path.sep, '/');
    if (!relative.startsWith('.')) relative = './' + relative;
    return quote + relative + quote;
  });
  await writeFile(file, declaration);
}
