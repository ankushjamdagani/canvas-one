import { readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
const source = JSON.parse(await readFile('package.json', 'utf8'));
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
  exports: { '.': { types: './types/embed/library.d.ts', import: './index.js' }, './styles.css': './styles.css' },
  files: ['*.js', '*.css', 'assets', 'types'],
  sideEffects: ['**/*.css'],
  peerDependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' },
}, null, 2) + '\n');
await copyFile('LICENSE', 'dist-react/LICENSE');
await copyFile('docs/embedding.md', 'dist-react/README.md');
