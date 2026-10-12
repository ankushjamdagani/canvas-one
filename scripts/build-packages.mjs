import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const packages = new Map();
for (const entry of await readdir(path.join(root, 'packages'), {withFileTypes: true})) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(await readFile(path.join(root, 'packages', entry.name, 'package.json'), 'utf8'));
  packages.set(manifest.name, manifest);
}
const completed = new Set();
const visiting = new Set();
function build(name) {
  if (completed.has(name)) return;
  if (visiting.has(name)) throw new Error(`Workspace build dependency cycle at ${name}`);
  visiting.add(name);
  const manifest = packages.get(name);
  const dependencies = {...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies};
  for (const dependency of Object.keys(dependencies).sort()) if (packages.has(dependency)) build(dependency);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--workspace', name], {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  visiting.delete(name);
  completed.add(name);
}
for (const name of [...packages.keys()].sort()) build(name);
