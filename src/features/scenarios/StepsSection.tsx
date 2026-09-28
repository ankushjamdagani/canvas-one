/**
 * "What goes in" section for logical scenarios: ordered steps = inputs, with initial
 * states (RV-05c).
 *
 * commands.md §4 "Editor sections": "logical: ordered steps = inputs, with initial
 * states." Screen: scenario_steps_editor.png. model-and-runner.md §6: "Array order is
 * semantic" for `inputs`; "Logical mode: atMs is null."
 *
 * Each step needs an entry endpoint and a fixture whose schema matches that port's
 * `schemaId` -- picked from real document fixtures/schemas, never typed as JSON. A step
 * can only be added once at least one inbound port has a matching fixture in the
 * document (brief: "Empty drafts invent nothing" -- no fixture is fabricated here).
 */

import * as React from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { Document, Input } from '../../domain/studio/model';
import type { DraftScenario } from './draftScenario';
import { Button } from '../../components/ui/button';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Checkbox } from '../../components/ui/checkbox';
import { endpointLabel, fixtureOptionsForSchema, inboundEndpointOptions } from './pickers';
import type { MintId } from './types';

export interface StepsSectionProps {
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
  readonly mintId: MintId;
}

function portSchemaId(document: Document, elementId: string, portId: string): string | null {
  return document.elements.find((e) => e.id === elementId)?.ports.find((p) => p.id === portId)?.schemaId ?? null;
}

export function reorderInputs(inputs: readonly Input[], sourceId: string, targetId: string): readonly Input[] {
  if (sourceId === targetId) return inputs;
  const sourceIndex = inputs.findIndex((input) => input.id === sourceId);
  const targetIndex = inputs.findIndex((input) => input.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return inputs;
  const reordered = [...inputs];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}

export function StepsSection({ document, scenario, onChange, mintId }: StepsSectionProps) {
  const [draggedStepId, setDraggedStepId] = React.useState<string | null>(null);
  const entryOptions = React.useMemo(() => inboundEndpointOptions(document), [document]);

  const entriesWithFixtures = React.useMemo(
    () =>
      entryOptions.filter((opt) => {
        const schemaId = portSchemaId(document, opt.elementId, opt.portId);
        return schemaId !== null && fixtureOptionsForSchema(document, schemaId).length > 0;
      }),
    [document, entryOptions],
  );

  const addStep = () => {
    if (entriesWithFixtures.length === 0) return;
    const first = entriesWithFixtures[0];
    const schemaId = portSchemaId(document, first.elementId, first.portId);
    if (!schemaId) return;
    const fixtures = fixtureOptionsForSchema(document, schemaId);
    const previous = scenario.inputs[scenario.inputs.length - 1] ?? null;
    const input: Input = {
      id: mintId(),
      entry: { elementId: first.elementId, portId: first.portId },
      fixtureId: fixtures[0].fixtureId,
      journeyId: previous ? previous.journeyId : mintId(),
      atMs: null,
      payloadBindings: [],
      resource: null,
    };
    onChange((s) => ({ ...s, inputs: [...s.inputs, input] }));
  };

  const updateStep = (id: string, patch: (i: Input) => Input) => {
    onChange((s) => ({
      ...s,
      inputs: s.inputs.map((i) => (i.id === id ? patch(i) : i)),
    }));
  };

  const removeStep = (id: string) => {
    onChange((s) => ({ ...s, inputs: s.inputs.filter((i) => i.id !== id) }));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= scenario.inputs.length) return;
    onChange((s) => {
      const inputs = [...s.inputs];
      const [moved] = inputs.splice(index, 1);
      inputs.splice(target, 0, moved);
      return { ...s, inputs };
    });
  };

  const moveStepBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    onChange((s) => {
      const inputs = reorderInputs(s.inputs, sourceId, targetId);
      return inputs === s.inputs ? s : { ...s, inputs };
    });
  };

  return (
    <section data-testid="scenario-section-steps" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">Steps, in order</div>
          <div className="text-[11px] text-secondary-text">Each step waits until the previous one settles.</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addStep} disabled={entriesWithFixtures.length === 0}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add step
        </Button>
      </div>

      {entriesWithFixtures.length === 0 && (
        <p className="text-[11px] text-secondary-text">No inbound port has a matching fixture in this document yet.</p>
      )}

      <div className="space-y-2">
        {scenario.inputs.map((input, index) => {
          const schemaId = portSchemaId(document, input.entry.elementId, input.entry.portId);
          const fixtures = schemaId ? fixtureOptionsForSchema(document, schemaId) : [];
          const previous = index > 0 ? scenario.inputs[index - 1] : null;
          const sameJourney = previous !== null && previous.journeyId === input.journeyId;

          return (
            <div
              key={input.id}
              data-testid={`step-row-${input.id}`}
              className={`rounded-control border bg-panel p-3 space-y-2 ${
                draggedStepId === input.id ? 'border-primary opacity-70' : 'border-control-border'
              }`}
              onDragOver={(event) => {
                if (draggedStepId !== null && draggedStepId !== input.id) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedStepId !== null) moveStepBefore(draggedStepId, input.id);
                setDraggedStepId(null);
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    draggable
                    className="cursor-grab text-secondary-text active:cursor-grabbing"
                    aria-label={`Drag step ${index + 1}; use arrow keys to reorder`}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', input.id);
                      setDraggedStepId(input.id);
                    }}
                    onDragEnd={() => setDraggedStepId(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && index > 0) {
                        event.preventDefault();
                        moveStep(index, -1);
                      } else if (event.key === 'ArrowDown' && index < scenario.inputs.length - 1) {
                        event.preventDefault();
                        moveStep(index, 1);
                      }
                    }}
                  >
                    <GripVertical className="size-3.5" aria-hidden="true" />
                  </button>
                  <span className="truncate text-xs font-semibold text-foreground">
                    {index + 1}. {endpointLabel(document, input.entry)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="text-secondary-text hover:text-foreground disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                    aria-label="Move step up"
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="text-secondary-text hover:text-foreground disabled:opacity-30"
                    disabled={index === scenario.inputs.length - 1}
                    onClick={() => moveStep(index, 1)}
                    aria-label="Move step down"
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="text-secondary-text hover:text-risk-text"
                    onClick={() => removeStep(input.id)}
                    aria-label="Remove step"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Entry point
                  <NativeSelect
                    value={`${input.entry.elementId}:${input.entry.portId}`}
                    onChange={(e) => {
                      const [elementId, portId] = e.target.value.split(':');
                      const newSchemaId = portSchemaId(document, elementId, portId);
                      const newFixtures = newSchemaId ? fixtureOptionsForSchema(document, newSchemaId) : [];
                      updateStep(input.id, (i) => ({
                        ...i,
                        entry: { elementId, portId },
                        fixtureId: newFixtures[0]?.fixtureId ?? i.fixtureId,
                      }));
                    }}
                    aria-label="Step entry point"
                  >
                    {entriesWithFixtures.map((opt) => (
                      <NativeSelectOption key={`${opt.elementId}:${opt.portId}`} value={`${opt.elementId}:${opt.portId}`}>
                        {opt.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>

                <label className="space-y-1 text-[11px] text-secondary-text">
                  Payload
                  <NativeSelect
                    value={input.fixtureId}
                    onChange={(e) =>
                      updateStep(input.id, (i) => ({
                        ...i,
                        fixtureId: e.target.value,
                      }))
                    }
                    aria-label="Step payload fixture"
                  >
                    {fixtures.map((f) => (
                      <NativeSelectOption key={f.fixtureId} value={f.fixtureId}>
                        {f.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              </div>

              {previous && (
                <label className="flex items-center gap-1.5 text-[11px] text-secondary-text">
                  <Checkbox
                    checked={sameJourney}
                    onCheckedChange={(checked) =>
                      updateStep(input.id, (i) => ({
                        ...i,
                        journeyId: checked === true ? previous.journeyId : mintId(),
                      }))
                    }
                  />
                  Same journey as previous step
                </label>
              )}
            </div>
          );
        })}

        {scenario.inputs.length === 0 && <p className="text-[11px] text-secondary-text">No steps yet. Add a step to send something in.</p>}
      </div>

      <StartingStateSection document={document} scenario={scenario} onChange={onChange} />
    </section>
  );
}

type StartingStateSectionProps = Omit<StepsSectionProps, 'mintId'>;

function StartingStateSection({ document, scenario, onChange }: StartingStateSectionProps) {
  const machineElements = React.useMemo(() => document.elements.filter((e) => e.behavior.kind === 'machine'), [document]);

  const addOverride = () => {
    const available = machineElements.find((e) => !scenario.initialContexts.some((ic) => ic.elementId === e.id));
    if (!available || available.behavior.kind !== 'machine') return;
    const fixtures = fixtureOptionsForSchema(document, available.behavior.contextSchemaId);
    if (fixtures.length === 0) return;
    onChange((s) => ({
      ...s,
      initialContexts: [...s.initialContexts, { elementId: available.id, fixtureId: fixtures[0].fixtureId }],
    }));
  };

  const removeOverride = (elementId: string) => {
    onChange((s) => ({
      ...s,
      initialContexts: s.initialContexts.filter((ic) => ic.elementId !== elementId),
    }));
  };

  const updateOverride = (elementId: string, fixtureId: string) => {
    onChange((s) => ({
      ...s,
      initialContexts: s.initialContexts.map((ic) => (ic.elementId === elementId ? { ...ic, fixtureId } : ic)),
    }));
  };

  if (machineElements.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">Starting state</div>
        <button type="button" className="text-[11px] text-primary hover:text-primary-hover" onClick={addOverride}>
          + Add override
        </button>
      </div>
      {scenario.initialContexts.length === 0 && <p className="text-[11px] text-secondary-text">Uses each machine's own initial state.</p>}
      {scenario.initialContexts.map((ic) => {
        const element = document.elements.find((e) => e.id === ic.elementId);
        const fixtures =
          element && element.behavior.kind === 'machine' ? fixtureOptionsForSchema(document, element.behavior.contextSchemaId) : [];
        return (
          <div key={ic.elementId} className="flex items-center gap-1.5 text-[11px]">
            <span className="text-foreground font-medium min-w-0 truncate">{element?.label ?? 'Deleted element'}</span>
            <NativeSelect
              className="h-7 text-xs"
              value={ic.fixtureId}
              onChange={(e) => updateOverride(ic.elementId, e.target.value)}
              aria-label={`Starting state for ${element?.label ?? ic.elementId}`}
            >
              {fixtures.map((f) => (
                <NativeSelectOption key={f.fixtureId} value={f.fixtureId}>
                  {f.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <button
              type="button"
              className="text-secondary-text hover:text-risk-text"
              onClick={() => removeOverride(ic.elementId)}
              aria-label="Remove starting state override"
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
