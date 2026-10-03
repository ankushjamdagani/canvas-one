/**
 * Deterministic ID generator and a small sample Document, for the preview harness and
 * unit tests (RV-05c). Not wired into any persistence path.
 *
 * model-and-runner.md §1: "Id is a lowercase canonical UUID." The brief bans
 * `crypto.randomUUID` in production code; a fixed, deterministic counter-based
 * generator is used here (and nowhere near persistence) so preview/test output is
 * reproducible.
 */

import type { Document, Element, Id, PayloadSchema } from '../../domain/studio/model';

function pad(n: number, len: number): string {
  return n.toString(16).padStart(len, '0');
}

/** Builds a `() => Id` that mints valid, deterministic, collision-free canonical UUIDs. */
export function makeCounterMintId(namespace: number): () => Id {
  let counter = 0;
  return () => {
    counter += 1;
    return `${pad(namespace, 8)}-0000-4000-8000-${pad(counter, 12)}`;
  };
}

/**
 * A small, valid two-element document (a client calling a processor, plus a host)
 * with matching request/response schemas and fixtures -- enough surface for every
 * picker in the scenario editor (inbound/outbound call ports, a host element, and
 * fixtures for both schemas).
 */
export function buildMockDocument(): Document {
  const mintId = makeCounterMintId(0xdeadbeef);

  const requestSchema: PayloadSchema = {
    id: mintId(),
    label: 'Checkout request',
    shape: { type: 'string', nullable: false },
  };
  const responseSchema: PayloadSchema = {
    id: mintId(),
    label: 'Checkout response',
    shape: { type: 'string', nullable: false },
  };

  const checkoutInPort = {
    id: mintId(),
    label: 'in',
    direction: 'in' as const,
    channel: 'call' as const,
    protocol: 'http' as const,
    schemaId: requestSchema.id,
    responseSchemaId: responseSchema.id,
  };

  const storefrontOutPort = {
    id: mintId(),
    label: 'checkout call',
    direction: 'out' as const,
    channel: 'call' as const,
    protocol: 'http' as const,
    schemaId: requestSchema.id,
    responseSchemaId: responseSchema.id,
  };

  const storefront: Element = {
    id: mintId(),
    label: 'Storefront',
    description: '',
    visualKind: 'client',
    ports: [storefrontOutPort],
    behavior: { kind: 'unmodeled', version: 1, reason: 'Not simulated: client entry point' },
  };

  const checkoutService: Element = {
    id: mintId(),
    label: 'Checkout service',
    description: '',
    visualKind: 'service',
    ports: [checkoutInPort],
    behavior: {
      kind: 'resource',
      version: 1,
      entryPortId: checkoutInPort.id,
      config: {
        type: 'processor',
        capacity: 100,
        concurrency: 4,
        queueLimit: 50,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    },
  };

  const paymentHost: Element = {
    id: mintId(),
    label: 'Payment host',
    description: '',
    visualKind: 'host',
    ports: [],
    behavior: { kind: 'host', version: 1 },
  };

  const requestFixture = { id: mintId(), schemaId: requestSchema.id, value: 'checkout-request' };
  const responseFixture = { id: mintId(), schemaId: responseSchema.id, value: 'checkout-response' };

  return {
    schema: 'studio-model/1',
    id: mintId(),
    title: 'Preview document',
    elements: [storefront, checkoutService, paymentHost],
    connections: [],
    relations: [],
    schemas: [requestSchema, responseSchema],
    fixtures: [requestFixture, responseFixture],
    refinements: [],
    scenarios: [],
    views: [],
  };
}
