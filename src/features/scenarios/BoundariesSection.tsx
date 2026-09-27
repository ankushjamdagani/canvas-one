/**
 * "What happens during the run" section for logical scenarios: replies from outside =
 * boundaries (RV-05c).
 *
 * commands.md §4 "Editor sections": "logical: ... replies from outside = boundaries."
 * model-and-runner.md §6: `Boundary={id,source:Endpoint,schemaId,responses:[...]}`.
 * "Boundary ports must lie on scope crossings" and a boundary answers a call this
 * scenario's scope makes to something outside it, so the source is restricted to
 * outbound *call* ports (the only channel with a `responseSchemaId` to answer against);
 * `schemaId` is set from that port's `responseSchemaId` since `match` evaluates the
 * eventual reply's shape, and `responseFixtureId` is picked from fixtures declared
 * against that same schema. Logical: `delayMs` is always null (model-and-runner.md §6).
 * `match` defaults to `{op:'exists', value:{kind:'literal', value:true}}`, an
 * always-true guard (an `exists` check on a literal is never missing) -- a legitimate,
 * always-matching first response, editable later; this task's brief lists boundaries as
 * a required section but does not specify a match-condition builder, so no richer guard
 * editor is invented here (reported as a lead reading).
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Boundary, BoundaryResponse, Document, Scenario, TransportOutcome } from '../../domain/studio/model';
import { TRANSPORT_OUTCOMES } from '../../domain/studio/model';
import { Button } from '../../components/ui/button';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { endpointLabel, fixtureOptionsForSchema } from './pickers';
import type { MintId } from './types';

export interface BoundariesSectionProps {
  readonly document: Document;
  readonly scenario: Scenario;
  readonly onChange: (patch: (s: Scenario) => Scenario) => void;
  readonly mintId: MintId;
}

const ALWAYS_MATCH = { op: 'exists' as const, value: { kind: 'literal' as const, value: true } };

function callSourceOptions(document: Document) {
  const options: { elementId: string; portId: string; label: string; responseSchemaId: string }[] = [];
  for (const element of document.elements) {
    for (const port of element.ports) {
      if (port.direction === 'out' && port.channel === 'call' && port.responseSchemaId) {
        options.push({
          elementId: element.id,
          portId: port.id,
          label: `${element.label} · ${port.label}`,
          responseSchemaId: port.responseSchemaId,
        });
      }
    }
  }
  return options;
}

export function BoundariesSection({ document, scenario, onChange, mintId }: BoundariesSectionProps) {
  const sources = React.useMemo(() => callSourceOptions(document), [document]);

  const eligible = React.useMemo(
    () => sources.filter((s) => fixtureOptionsForSchema(document, s.responseSchemaId).length > 0),
    [document, sources],
  );

  const addBoundary = () => {
    if (eligible.length === 0) return;
    const first = eligible[0];
    const fixtures = fixtureOptionsForSchema(document, first.responseSchemaId);
    const boundary: Boundary = {
      id: mintId(),
      source: { elementId: first.elementId, portId: first.portId },
      schemaId: first.responseSchemaId,
      responses: [
        {
          id: mintId(),
          match: ALWAYS_MATCH,
          responseFixtureId: fixtures[0].fixtureId,
          payloadBindings: [],
          delayMs: null,
          afterInputId: null,
          outcome: 'succeeded',
        },
      ],
    };
    onChange((s) => ({ ...s, boundaries: [...s.boundaries, boundary] }));
  };

  const updateBoundary = (id: string, patch: (b: Boundary) => Boundary) => {
    onChange((s) => ({ ...s, boundaries: s.boundaries.map((b) => (b.id === id ? patch(b) : b)) }));
  };

  const removeBoundary = (id: string) => {
    onChange((s) => ({ ...s, boundaries: s.boundaries.filter((b) => b.id !== id) }));
  };

  const updateResponse = (boundaryId: string, responseId: string, patch: (r: BoundaryResponse) => BoundaryResponse) => {
    updateBoundary(boundaryId, (b) => ({
      ...b,
      responses: b.responses.map((r) => (r.id === responseId ? patch(r) : r)),
    }));
  };

  return (
    <section data-testid="scenario-section-boundaries" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">
            What happens during the run
          </div>
          <div className="text-[11px] text-secondary-text">Replies from outside this scenario's scope.</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addBoundary} disabled={eligible.length === 0}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add reply
        </Button>
      </div>

      {eligible.length === 0 && (
        <p className="text-[11px] text-secondary-text">
          No outbound call port with a matching response fixture in this document yet.
        </p>
      )}

      <div className="space-y-2">
        {scenario.boundaries.map((boundary) => (
          <div
            key={boundary.id}
            data-testid={`boundary-row-${boundary.id}`}
            className="rounded-control border border-control-border bg-panel p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">{endpointLabel(document, boundary.source)}</span>
              <button
                type="button"
                className="text-secondary-text hover:text-risk-text"
                onClick={() => removeBoundary(boundary.id)}
                aria-label="Remove reply"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>

            {boundary.responses.map((response) => {
              const fixtures = fixtureOptionsForSchema(document, boundary.schemaId);
              return (
                <div key={response.id} className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Reply payload
                    <NativeSelect
                      value={response.responseFixtureId}
                      onChange={(e) =>
                        updateResponse(boundary.id, response.id, (r) => ({ ...r, responseFixtureId: e.target.value }))
                      }
                      aria-label="Reply payload fixture"
                    >
                      {fixtures.map((f) => (
                        <NativeSelectOption key={f.fixtureId} value={f.fixtureId}>
                          {f.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Outcome
                    <NativeSelect
                      value={response.outcome}
                      onChange={(e) =>
                        updateResponse(boundary.id, response.id, (r) => ({
                          ...r,
                          outcome: e.target.value as TransportOutcome,
                        }))
                      }
                      aria-label="Reply outcome"
                    >
                      {TRANSPORT_OUTCOMES.map((o) => (
                        <NativeSelectOption key={o} value={o}>
                          {o}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="col-span-2 space-y-1 text-[11px] text-secondary-text">
                    Deliver after step
                    <NativeSelect
                      value={response.afterInputId ?? ''}
                      onChange={(e) =>
                        updateResponse(boundary.id, response.id, (r) => ({
                          ...r,
                          afterInputId: e.target.value === '' ? null : e.target.value,
                        }))
                      }
                      aria-label="Deliver after step"
                    >
                      <NativeSelectOption value="">Immediately</NativeSelectOption>
                      {scenario.inputs.map((input, idx) => (
                        <NativeSelectOption key={input.id} value={input.id}>
                          After step {idx + 1}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
              );
            })}
          </div>
        ))}

        {scenario.boundaries.length === 0 && (
          <p className="text-[11px] text-secondary-text">No replies configured yet.</p>
        )}
      </div>
    </section>
  );
}
