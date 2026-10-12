import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'canvas-one-headless-'));
const names = ['commands', 'whiteboard', 'history', 'agents', 'playback', 'storage', 'system-design', 'simulation-system-design'];
function run(command, args, cwd) {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  const dependencies = {};
  for (const name of names) {
    const manifest = JSON.parse(await readFile(path.join(root, 'packages', name, 'package.json'), 'utf8'));
    const [packed] = JSON.parse(run('npm', ['pack', `./packages/${name}`, '--json', '--ignore-scripts', '--pack-destination', directory], root));
    dependencies[manifest.name] = `file:${path.join(directory, packed.filename)}`;
  }
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'canvas-one-headless-consumer', private: true, type: 'module', dependencies}));
  run('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], directory);
  const probe = `
    for (const name of ['react', 'react-dom', 'next', 'dexie', '@xyflow/react']) {
      let found = false; try { import.meta.resolve(name); found = true; } catch {}
      if (found) throw new Error('Framework installed in headless consumer: ' + name);
    }
    for (const name of ['window', 'document', 'navigator', 'indexedDB']) Object.defineProperty(globalThis, name, {get(){throw new Error('DOM global read: ' + name);}});
    for (const name of ${JSON.stringify(Object.keys(dependencies))}) await import(name);
    console.log('Packed headless consumer passed without React, DOM, Dexie, Next.js or React Flow.');
  `;
  await writeFile(path.join(directory, 'probe.mjs'), probe);
  process.stdout.write(run(process.execPath, ['probe.mjs'], directory));
} finally {
  await rm(directory, {recursive: true, force: true});
}
