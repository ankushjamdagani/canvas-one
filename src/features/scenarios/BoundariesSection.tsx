/**
 * "What happens during the run" section for logical scenarios: replies from outside =
 * boundaries (RV-05c).
 *
 * commands.md §4 "Editor sections": "logical: ... replies from outside = boundaries."
 * model-and-runner.md §6: `Boundary={id,source:Endpoint,schemaId,responses:[{...,
 * match:Guard,...}]}`, where `Guard` is a recursive typed tree (equals/notEquals/
 * exists/all/any/positiveInteger/nonEmpty/every over `Value` operands that are
 * themselves recursive: literal/read/record/list/outcome).
 *
 * Review round: this module does not offer "Add reply from outside." A previous round
 * created a new boundary with a fabricated always-true `match` guard, which the review
 * correctly flagged as an invented default -- per commands.md "Empty drafts invent
 * nothing," no field the record requires may be silently filled, and a full match-
 * condition builder covering every Guard/Value variant above is out of this task's
 * scope. GAP: a boundary added by copying an existing scenario (idRemap.ts keeps its
 * `match` untouched) still displays here with its other fields (payload, outcome,
 * "deliver after step") editable -- only *creating* a new one is unavailable. A typed
 * match builder is left for a follow-up task.
 */

import * as React from 'react';
import { Trash2 } from 'lucide-react';
import type { BoundaryResponse, Document, TransportOutcome } from '../../domain/studio/model';
import { TRANSPORT_OUTCOMES } from '../../domain/studio/model';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { endpointLabel, fixtureOptionsForSchema } from './pickers';
import type { DraftScenario } from './draftScenario';

export interface BoundariesSectionProps {
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
}

export function BoundariesSection({ document, scenario, onChange }: BoundariesSectionProps) {
  const updateResponse = (boundaryId: string, responseId: string, patch: (r: BoundaryResponse) => BoundaryResponse) => {
    onChange((s) => ({
      ...s,
      boundaries: s.boundaries.map((b) =>
        b.id === boundaryId ? { ...b, responses: b.responses.map((r) => (r.id === responseId ? patch(r) : r)) } : b,
      ),
    }));
  };

  const removeBoundary = (id: string) => {
    onChange((s) => ({ ...s, boundaries: s.boundaries.filter((b) => b.id !== id) }));
  };

  return (
    <section data-testid="scenario-section-boundaries" className="space-y-2">
      <div>
        <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">
          What happens during the run
        </div>
        <div className="text-[11px] text-secondary-text">Replies from outside this scenario's scope.</div>
      </div>

      <p className="text-[11px] text-secondary-text" data-testid="boundaries-gap-note">
        Adding a new reply isn't available yet -- it needs a match-condition builder this task doesn't include. A
        reply copied from another scenario can still be reviewed and its payload, outcome and timing edited below.
      </p>

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
