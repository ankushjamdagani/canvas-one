/**
 * Transport layer connecting RunController to the worker protocol.
 *
 * Provides:
 * - RunTransport interface for message exchange.
 * - InProcessTransport lives in inProcessTransport.ts (tests/node) so the browser bundle
 *   never pulls in the protocol handler and runner.
 * - WorkerTransport: browser Web Worker transport wrapping standard Worker.
 */

import type { HostMessage, WorkerMessage } from './protocol.js';

export interface RunTransport {
  postMessage(message: WorkerMessage): void;
  onMessage(listener: (message: HostMessage) => void): () => void;
  terminate?(): void;
}


/**
 * Standard browser Web Worker transport.
 */
export class WorkerTransport implements RunTransport {
  private readonly worker: WorkerPort;
  private readonly listeners = new Set<(message: HostMessage) => void>();
  private readonly receive = (event: { readonly data: HostMessage }): void => {
    for (const listener of this.listeners) listener(event.data);
  };

  constructor(worker: WorkerPort) {
    this.worker = worker;
    this.worker.addEventListener('message', this.receive);
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
    this.worker.removeEventListener('message', this.receive);
    this.worker.terminate();
    this.listeners.clear();
  }
}

/** Browser Worker satisfies this structural transport port. */
export interface WorkerPort {
  addEventListener(type: 'message', listener: (event: { readonly data: HostMessage }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: HostMessage }) => void): void;
  postMessage(message: WorkerMessage): void;
  terminate(): void;
}
