import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
const appRoot = path.resolve(process.argv[2] || 'apps/web');
const serverRoot = path.join(appRoot, '.next/standalone/apps/web');
await mkdir(path.join(serverRoot, '.next'), { recursive: true });
await cp(path.join(appRoot, '.next/static'), path.join(serverRoot, '.next/static'), { recursive: true });
await cp(path.join(appRoot, 'public'), path.join(serverRoot, 'public'), { recursive: true });
