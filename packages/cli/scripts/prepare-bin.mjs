import {chmod} from 'node:fs/promises';

// Workspace links are installed before TypeScript creates the executable.
await chmod(new URL('../dist/main.js', import.meta.url), 0o755);
