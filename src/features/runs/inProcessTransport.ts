import {
  WorkerProtocolHandler,
  type HostMessage,
  type WorkerMessage,
} from './protocol';
import type { RunTransport } from './transport';

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
