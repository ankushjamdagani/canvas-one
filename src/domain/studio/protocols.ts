/**
 * Connection protocols (D53, specs/revamp/connection-protocols.md).
 *
 * A protocol is a label on a port; the runner ignores it. A port with no `protocol` has its node's
 * default for the channel, and the field is only written when it differs from that default.
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

/** The protocol a port has when it carries none. `event` ports have no protocol. */
export function defaultProtocol(visualKind: VisualKind, channel: PortChannel): Protocol | null {
  if (channel === 'call') return CALL_DEFAULTS[visualKind] ?? 'http';
  if (channel === 'message') return MESSAGE_DEFAULTS[visualKind] ?? 'amqp';
  if (channel === 'data') return 'jdbc';
  return null;
}

export function portProtocol(element: { readonly visualKind: VisualKind }, port: Port): Protocol | null {
  return port.protocol ?? defaultProtocol(element.visualKind, port.channel);
}
