import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const ownedGroups = new Set<number>();
// SIGKILL/power loss cannot run exit hooks; the board's lease remains the write authority.
process.once('exit', () => {
  for (const pid of ownedGroups) { try { process.kill(-pid, 'SIGKILL'); } catch { /* Already closed. */ } }
});

export type ManagedProcess = {
  readonly finished: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  write(line: string): void;
  endInput(): void;
  cancel(): Promise<void>;
};
export type ProcessLimits = { readonly maxOutputBytes: number; readonly maxInputBytes: number; readonly cancelGraceMs: number };

/** Node-only process boundary. Command and arguments must come from a trusted adapter, never provider text. */
export function launchManagedProcess(options: {
  readonly command: string; readonly args: readonly string[]; readonly cwd: string;
  readonly onOutput: (text: string) => void; readonly onDiagnostic: (text: string) => void;
  readonly limits: ProcessLimits;
}): ManagedProcess {
  for (const limit of Object.values(options.limits)) if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Process limits must be positive safe integers');
  if (!options.command || options.command.includes('\0') || options.args.some(value => value.includes('\0'))) throw new TypeError('Invalid executable arguments');
  const grouped = process.platform !== 'win32';
  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...options.args], { cwd: options.cwd, shell: false, detached: grouped, stdio: ['pipe', 'pipe', 'pipe'] });
  if (grouped && child.pid) ownedGroups.add(child.pid);
  let closed = false;
  let outputBytes = 0;
  let inputBytes = 0;
  let cancellation: Promise<void> | undefined;
  let callbackFailed = false;
  let processError: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const sendSignal = (signal: NodeJS.Signals) => {
    if (closed || !child.pid) return;
    try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  let resolveFinished!: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
  let rejectFinished!: (error: Error) => void;
  let acknowledgeClose!: () => void;
  const processClosed = new Promise<void>(resolve => { acknowledgeClose = resolve; });
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
  // Consumers receive the error through finished; prevent a startup race from becoming an unhandled rejection.
  void finished.catch(() => {});
  const decoder = new StringDecoder('utf8');
  const diagnosticDecoder = new StringDecoder('utf8');
  const receive = (chunk: Buffer, decode: StringDecoder, notify: (text: string) => void) => {
    outputBytes += chunk.length;
    if (outputBytes > options.limits.maxOutputBytes) { void cancel(); return; }
    try { notify(decode.write(chunk)); } catch { callbackFailed = true; void cancel(); }
  };
  child.stdout.on('data', (chunk: Buffer) => receive(chunk, decoder, options.onOutput));
  child.stderr.on('data', (chunk: Buffer) => receive(chunk, diagnosticDecoder, options.onDiagnostic));
  // EPIPE follows a stopped/exited provider. It must not crash the supervisor.
  child.stdin.on('error', () => { void cancel(); });
  child.once('error', error => { processError = error; });
  child.once('close', (code, signal) => {
    closed = true; if (killTimer) clearTimeout(killTimer);
    // Descendants in this newly-created process group must not outlive its provider attempt.
    if (grouped && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* No remaining group members. */ }
      ownedGroups.delete(child.pid);
    }
    acknowledgeClose();
    try { const tail = decoder.end(); if (tail) options.onOutput(tail); const diagnosticTail = diagnosticDecoder.end(); if (diagnosticTail) options.onDiagnostic(diagnosticTail); }
    catch { callbackFailed = true; }
    if (processError) rejectFinished(processError);
    else if (outputBytes > options.limits.maxOutputBytes) rejectFinished(new Error('Provider output exceeded the configured limit'));
    else if (callbackFailed) rejectFinished(new Error('Provider output could not be delivered'));
    else resolveFinished({ code, signal });
  });
  function cancel(): Promise<void> {
    if (cancellation) return cancellation;
    try {
      if (!closed) {
        sendSignal('SIGTERM');
        killTimer = setTimeout(() => { try { sendSignal('SIGKILL'); } catch { /* A later explicit host cleanup can retry. */ } }, options.limits.cancelGraceMs);
        killTimer.unref();
      }
      cancellation = processClosed;
    } catch (error) {
      // Do not cache a signal failure: a later explicit Stop may retry.
      const failure = Promise.reject(error);
      void failure.catch(() => {});
      return failure;
    }
    // Cancellation acknowledgement is process close, never merely successful signal delivery.
    void cancellation.catch(() => {});
    return cancellation;
  }
  return {
    finished, cancel,
    write(line) {
      if (closed || cancellation || child.stdin.writableEnded) throw new Error('Provider input is closed');
      inputBytes += Buffer.byteLength(line, 'utf8');
      if (inputBytes > options.limits.maxInputBytes) { void cancel(); throw new Error('Provider input exceeded the configured limit'); }
      child.stdin.write(line);
    },
    endInput() { if (!closed && !child.stdin.writableEnded) child.stdin.end(); },
  };
}
