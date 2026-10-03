/**
 * Connection protocols (D53, specs/revamp/connection-protocols.md).
 *
 * A protocol is a label on a port; the runner ignores it. Every connectable port carries one
 * (`Port.protocol`; null on `event` ports); `defaultProtocol` only seeds new ports.
 */

import type { Port, PortChannel, VisualKind } from './model';

export const PROTOCOLS = {
  call: ['http', 'grpc', 'graphql', 'soap', 'json-rpc', 'thrift', 'sql', 'redis', 'memcached'],
  message: ['amqp', 'kafka', 'mqtt', 'nats', 'stomp', 'sqs', 'sns', 'google-pubsub', 'azure-service-bus'],
  data: ['jdbc', 's3', 'sftp', 'cdc', 'http-bulk'],
} as const;

export type ConnectableChannel = keyof typeof PROTOCOLS;
export type Protocol = (typeof PROTOCOLS)[ConnectableChannel][number];

export const PROTOCOL_LABELS: Readonly<Record<Protocol, string>> = {
  http: 'HTTP / REST',
  grpc: 'gRPC',
  graphql: 'GraphQL',
  soap: 'SOAP',
  'json-rpc': 'JSON-RPC',
  thrift: 'Thrift',
  sql: 'SQL',
  redis: 'Redis',
  memcached: 'Memcached',
  amqp: 'AMQP',
  kafka: 'Kafka',
  mqtt: 'MQTT',
  nats: 'NATS',
  stomp: 'STOMP',
  sqs: 'Amazon SQS',
  sns: 'Amazon SNS',
  'google-pubsub': 'Google Pub/Sub',
  'azure-service-bus': 'Azure Service Bus',
  jdbc: 'JDBC / ODBC',
  s3: 'S3 object API',
  sftp: 'SFTP / FTP',
  cdc: 'Change data capture',
  'http-bulk': 'HTTP bulk transfer',
};

export function isConnectableChannel(channel: PortChannel): channel is ConnectableChannel {
  return channel !== 'event';
}

export function protocolsFor(channel: PortChannel): readonly Protocol[] {
  return isConnectableChannel(channel) ? PROTOCOLS[channel] : [];
}

export function isProtocolOf(channel: PortChannel, value: unknown): value is Protocol {
  return typeof value === 'string' && (protocolsFor(channel) as readonly string[]).includes(value);
}

const CALL_DEFAULTS: Partial<Record<VisualKind, Protocol>> = {
  database: 'sql',
  warehouse: 'sql',
  cache: 'redis',
};

const MESSAGE_DEFAULTS: Partial<Record<VisualKind, Protocol>> = {
  stream: 'kafka',
  pubsub: 'google-pubsub',
};

/** The protocol a new port of this node kind and channel starts with. `event` ports have none. */
export function defaultProtocol(visualKind: VisualKind, channel: PortChannel): Protocol | null {
  if (channel === 'call') return CALL_DEFAULTS[visualKind] ?? 'http';
  if (channel === 'message') return MESSAGE_DEFAULTS[visualKind] ?? 'amqp';
  if (channel === 'data') return 'jdbc';
  return null;
}


/** The longest endpoint path or name (`Port.path`, `ProjectExposure.path`). */
export const PORT_PATH_MAX_LENGTH = 120;

/** A path or name as stored: trimmed, and absent (empty) when blank. */
export function normalizePath(value: string | undefined): string {
  return (value ?? '').trim();
}

export function portPath(port: Pick<Port, 'path'>): string {
  return port.path ?? '';
}

/** How a connectable port reads on a card or a connection: its protocol and path, e.g. `HTTP / REST /orders`. */
export function describeEndpoint(protocol: Protocol, path: string): string {
  return path ? `${PROTOCOL_LABELS[protocol]} ${path}` : PROTOCOL_LABELS[protocol];
}
