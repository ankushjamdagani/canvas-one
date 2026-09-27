/**
 * Element/port picker helpers (RV-05c).
 *
 * Brief: "element/port pickers by label" -- every editor control that names a document
 * element or port picks it from real document content, by its own label, never a raw
 * ID typed or shown in the UI.
 */

import type { Document, Element, Endpoint, Id, Path, Port } from '../../domain/studio/model';

export type EndpointOption = {
  readonly elementId: Id;
  readonly portId: Id;
  /** "<Element label> · <Port label>", e.g. "Storefront · in". */
  readonly label: string;
  readonly channel: Port['channel'];
  readonly direction: Port['direction'];
};

export function elementLabel(document: Document, elementId: Id): string | null {
  return document.elements.find((e) => e.id === elementId)?.label ?? null;
}

export function portLabel(document: Document, elementId: Id, portId: Id): string | null {
  const element = document.elements.find((e) => e.id === elementId);
  return element?.ports.find((p) => p.id === portId)?.label ?? null;
}

export function endpointLabel(document: Document, endpoint: Endpoint): string {
  const el = elementLabel(document, endpoint.elementId);
  const port = portLabel(document, endpoint.elementId, endpoint.portId);
  if (el === null || port === null) return 'Deleted element';
  return `${el} · ${port}`;
}

/** All inbound ports across every element, for workload/input entry pickers. */
export function inboundEndpointOptions(document: Document): readonly EndpointOption[] {
  const options: EndpointOption[] = [];
  for (const element of document.elements) {
    for (const port of element.ports) {
      if (port.direction === 'in') {
        options.push({
          elementId: element.id,
          portId: port.id,
          label: `${element.label} · ${port.label}`,
          channel: port.channel,
          direction: port.direction,
        });
      }
    }
  }
  return options;
}

/** All outbound ports across every element, for boundary source pickers. */
export function outboundEndpointOptions(document: Document): readonly EndpointOption[] {
  const options: EndpointOption[] = [];
  for (const element of document.elements) {
    for (const port of element.ports) {
      if (port.direction === 'out') {
        options.push({
          elementId: element.id,
          portId: port.id,
          label: `${element.label} · ${port.label}`,
          channel: port.channel,
          direction: port.direction,
        });
      }
    }
  }
  return options;
}

export type HostOption = {
  readonly elementId: Id;
  readonly label: string;
};

/** model-and-runner.md §4: "host: No fields. Availability comes from the scenario fault schedule." */
export function hostElementOptions(document: Document): readonly HostOption[] {
  return document.elements
    .filter((e): e is Element & { readonly behavior: { readonly kind: 'host' } } => e.behavior.kind === 'host')
    .map((e) => ({ elementId: e.id, label: e.label }));
}

export type FixtureOption = {
  readonly fixtureId: Id;
  readonly label: string;
};

/** Fixtures whose declared schema matches `schemaId`, labelled by the schema's label. */
export function fixtureOptionsForSchema(document: Document, schemaId: Id): readonly FixtureOption[] {
  const schema = document.schemas.find((s) => s.id === schemaId);
  return document.fixtures
    .filter((f) => f.schemaId === schemaId)
    .map((f, i) => ({ fixtureId: f.id, label: `${schema?.label ?? 'Fixture'} #${i + 1}` }));
}

export type ElementOption = {
  readonly elementId: Id;
  readonly label: string;
};

export function allElementOptions(document: Document): readonly ElementOption[] {
  return document.elements.map((e) => ({ elementId: e.id, label: e.label }));
}

export type PathOption = {
  /** Stable string key for a <select>; "" means "Whole value" (path = []). */
  readonly key: string;
  readonly label: string;
  readonly path: Path;
};

/**
 * Path choices for an assertion's `output`/`context` subject: "Whole value" (path =
 * []) plus, when `schemaId` resolves to a record shape, one option per top-level field
 * key. GAP: only top-level record fields are offered -- nested paths and list indices
 * aren't (model-and-runner.md §3 Shapes can nest records/lists arbitrarily up to depth
 * 8; a general path builder is out of this task's scope).
 */
export function pathOptionsForSchema(document: Document, schemaId: Id | null): readonly PathOption[] {
  const wholeValue: PathOption = { key: '', label: 'Whole value', path: [] };
  if (schemaId === null) return [wholeValue];
  const schema = document.schemas.find((s) => s.id === schemaId);
  if (!schema || schema.shape.type !== 'record') return [wholeValue];
  return [
    wholeValue,
    ...schema.shape.fields.map((f) => ({ key: f.key, label: f.key, path: [f.key] })),
  ];
}
