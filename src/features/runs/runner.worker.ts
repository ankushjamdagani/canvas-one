/**
 * Web Worker entry point for scenario execution.
 *
 * Runs compilation and scenario stepping in an isolated worker thread.
 * Delegates message handling entirely to pure WorkerProtocolHandler.
 */

import { WorkerProtocolHandler, type WorkerMessage } from './protocol';

const handler = new WorkerProtocolHandler((msg) => {
  self.postMessage(msg);
});

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  void handler.handleMessage(event.data);
};
