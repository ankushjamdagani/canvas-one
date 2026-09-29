/**
 * Transport layer connecting RunController to the worker protocol (RV-12c4).
 *
 * Provides:
 * - RunTransport interface for message exchange.
 * - InProcessTransport: pure in-memory transport using WorkerProtocolHandler directly (vitest/node).
 * - WorkerTransport: browser Web Worker transport wrapping standard Worker.
 */

import {
  WorkerProtocolHandler,
  type HostMessage,
  type WorkerMessage,
} from './protocol';

export interface RunTransport {
  postMessage(message: WorkerMessage): void;
  onMessage(listener: (message: HostMessage) => void): () => void;
  terminate?(): void;
}

/**
 * In-process transport for unit tests, headless node environments, and local execution.
 * Delivers messages across asynchronous microtask/macro-task boundaries.
 */
export class InProcessTransport implements RunTransport {
  private readonly handler: WorkerProtocolHandler;
  private readonly listeners = new Set<(message: HostMessage) => void>();

  constructor(handler?: WorkerProtocolHandler) {
    this.handler =
      handler ??
      new WorkerProtocolHandler((msg) => {
        // Asynchronously deliver response to main-thread listeners
        queueMicrotask(() => {
          for (const listener of this.listeners) {
            listener(msg);
          }
        });
      });
  }

  getHandler(): WorkerProtocolHandler {
    return this.handler;
  }

  postMessage(message: WorkerMessage): void {
    // Deliver message to handler asynchronously
    queueMicrotask(() => {
      void this.handler.handleMessage(message);
    });
  }

  onMessage(listener: (message: HostMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  terminate(): void {
    this.handler.reset();
    this.listeners.clear();
  }
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
