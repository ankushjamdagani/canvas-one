import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];
const packages = new Map();
for (const entry of await readdir(path.join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(root, 'packages', entry.name);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  packages.set(manifest.name, { directory, manifest, imports: new Set() });
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', '.next', 'dist', 'dist-react'].includes(entry.name)) result.push(...await files(target));
    else if (/\.tsx?$/.test(entry.name)) result.push(target);
  }
  return result;
}
const declarations = /(?:\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"\n]+)['"]/g;
function checkPublicExport(target, consumer) {
  if (!target.startsWith('@canvas-one/')) return;
  const owner = target.split('/').slice(0, 2).join('/');
  const pkg = packages.get(owner);
  // Existing build:react emits this compatibility entry into dist-react;
  // it becomes a workspace during the later host/authority extraction.
  if (!pkg && owner === '@canvas-one/react' && [owner, `${owner}/styles.css`].includes(target)) return;
  if (!pkg) { failures.push(`${consumer}: missing workspace ${owner}`); return; }
  const key = target === owner ? '.' : '.' + target.slice(owner.length);
  if (!Object.hasOwn(pkg.manifest.exports ?? {}, key)) failures.push(`${consumer}: non-public package import ${target}`);
}
for (const [name, pkg] of packages) {
  const dependencies = { ...pkg.manifest.dependencies, ...pkg.manifest.peerDependencies };
  for (const file of await files(path.join(pkg.directory, 'src'))) {
    // TS7's native compiler has no JavaScript AST API. Scan literal module
    // declarations here; tsc independently verifies their syntax and resolution.
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(declarations)) {
        const target = match[1];
        if (target.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), target);
          if (!resolved.startsWith(pkg.directory + path.sep)) failures.push(`${name}: import escapes package: ${target}`);
        } else {
          const owner = target.startsWith('@') ? target.split('/').slice(0, 2).join('/') : target.split('/')[0];
          if (!dependencies[owner]) failures.push(`${name}: undeclared dependency ${target}`);
          if (target.startsWith('@canvas-one/') && !packages.has(owner)) failures.push(`${name}: missing workspace ${owner}`);
          checkPublicExport(target, name);
          pkg.imports.add(owner);
        }
    }
  }
}
// Application and embedding consumers must use exports, never package source
// or dist paths, even though TypeScript can resolve relative internal imports.
for (const directory of ['src', 'apps', 'examples', 'tests']) {
  for (const file of await files(path.join(root, directory))) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(declarations)) {
      const target = match[1];
      if (target.startsWith('.') && path.resolve(path.dirname(file), target).startsWith(path.join(root, 'packages') + path.sep)) {
        failures.push(`${path.relative(root, file)}: relative package import bypasses exports: ${target}`);
      }
      checkPublicExport(target, path.relative(root, file));
    }
  }
}
function traverse(name, stack = []) {
  if (stack.includes(name)) { failures.push(`Package cycle: ${[...stack, name].join(' -> ')}`); return; }
  for (const imported of packages.get(name).imports) if (packages.has(imported)) traverse(imported, [...stack, name]);
}
for (const name of packages.keys()) traverse(name);

// These are the currently extracted headless roots. Add future behavior packages here.
for (const name of ['@canvas-one/playback', '@canvas-one/commands']) {
  if (!packages.has(name)) continue;
  const forbidden = /^(react|react-dom|next|dexie|@xyflow\/react)$/;
  const inspect = (owner, seen = new Set()) => {
    if (seen.has(owner)) return;
    seen.add(owner);
    for (const dependency of packages.get(owner).imports) {
      if (forbidden.test(dependency)) failures.push(`${name}: framework dependency ${dependency}`);
      if (packages.has(dependency)) inspect(dependency, seen);
    }
  };
  inspect(name);
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
    `for (const key of ['window','document','navigator','HTMLElement','indexedDB']) Object.defineProperty(globalThis,key,{get(){throw new Error('DOM access: '+key)},configurable:true}); await import(${JSON.stringify(name)});`],
  { cwd: root, encoding: 'utf8' });
  if (probe.status !== 0) failures.push(`${name}: built headless import failed: ${probe.stderr.trim()}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Package boundaries and built headless imports passed (${packages.size} packages).`);
