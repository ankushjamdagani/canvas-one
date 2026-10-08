/**
 * Transport layer connecting RunController to the worker protocol.
 *
 * Provides:
 * - RunTransport interface for message exchange.
 * - InProcessTransport lives in inProcessTransport.ts (tests/node) so the browser bundle
 *   never pulls in the protocol handler and runner.
 * - WorkerTransport: browser Web Worker transport wrapping standard Worker.
 */

import type { HostMessage, WorkerMessage } from './protocol';

export interface RunTransport {
  postMessage(message: WorkerMessage): void;
  onMessage(listener: (message: HostMessage) => void): () => void;
  terminate?(): void;
}


/**
 * Standard browser Web Worker transport.
 */
export class WorkerTransport implements RunTransport {
  private readonly worker: Worker;
  private readonly listeners = new Set<(message: HostMessage) => void>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<HostMessage>) => {
      for (const listener of this.listeners) {
        listener(event.data);
      }
    };
  }

  postMessage(message: WorkerMessage): void {
    this.worker.postMessage(message);
  }

  onMessage(listener: (message: HostMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  terminate(): void {
    this.worker.terminate();
    this.listeners.clear();
  }
}
