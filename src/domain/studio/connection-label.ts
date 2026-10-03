/**
 * What a connection reads as on the canvas, in exports and in history: its channel and the
 * protocol and path of the port it enters, e.g. `call · HTTP / REST /orders`. Derived, never stored.
 */

import type { Connection, Document } from './model';
import { describeEndpoint, portPath } from './protocols';

export function describeConnection(document: Pick<Document, 'elements'>, connection: Connection): string {
  const target = document.elements.find((e) => e.id === connection.target.elementId);
  const port = target?.ports.find((p) => p.id === connection.target.portId);
  const protocol = target && port ? port.protocol : null;
  return protocol === null ? connection.kind : `${connection.kind} · ${describeEndpoint(protocol, port ? portPath(port) : '')}`;
}
