import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const env = { ...process.env };
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value || !['--port', '-p', '--hostname', '-H'].includes(flag)) throw new Error(`Unsupported start option: ${flag}`);
  env[['--port', '-p'].includes(flag) ? 'PORT' : 'HOSTNAME'] = value;
}
env.HOSTNAME ||= '0.0.0.0';
const child = spawn(process.execPath, ['.next/standalone/server.js'], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
