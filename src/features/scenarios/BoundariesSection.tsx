import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  Boundary,
  BoundaryPayloadBinding,
  BoundaryResponse,
  Document,
  Endpoint,
  Guard,
  Path,
  TransportOutcome,
} from '../../domain/studio/model';
import { TRANSPORT_OUTCOMES } from '../../domain/studio/model';
import { Button } from '../../components/ui/button';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { endpointLabel, fixtureOptionsForSchema } from './pickers';
import type { DraftScenario } from './draftScenario';
import type { MintId } from './types';
import { GuardBuilder } from './GuardBuilder';
import { SchemaPathPicker } from './SchemaPathPicker';
import type { ScenarioIssue } from './types';
import { CompactRow } from './CompactRow';

export interface BoundariesSectionProps {
  readonly issues?: readonly ScenarioIssue[];
  _defaultExpandedId?: string;
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
  readonly mintId: MintId;
  readonly onGuardValidityChange?: (valid: boolean) => void;
}

type CrossingOption = {
  readonly key: string;
  readonly source: Endpoint;
  readonly requestSchemaId: string;
  readonly responseSchemaId: string;
  readonly label: string;
};

function crossingOptions(document: Document, scenario: DraftScenario): readonly CrossingOption[] {
  const scope = new Set(scenario.scopeElementIds);
  const seen = new Set<string>();
  const options: CrossingOption[] = [];
  for (const connection of document.connections) {
    if (!scope.has(connection.source.elementId) || scope.has(connection.target.elementId)) continue;
    const element = document.elements.find((candidate) => candidate.id === connection.source.elementId);
    const port = element?.ports.find((candidate) => candidate.id === connection.source.portId);
    if (!element || !port || port.responseSchemaId === null) continue;
    const key = `${element.id}:${port.id}`;
    if (seen.has(key) || fixtureOptionsForSchema(document, port.responseSchemaId).length === 0) continue;
    seen.add(key);
    options.push({
      key,
      source: connection.source,
      requestSchemaId: port.schemaId,
      responseSchemaId: port.responseSchemaId,
      label: `${element.label} · ${port.label}`,
    });
  }
  return options;
}

function sourceSchemas(document: Document, source: Endpoint) {
  const port = document.elements
    .find((element) => element.id === source.elementId)
    ?.ports.find((candidate) => candidate.id === source.portId);
  return { request: port?.schemaId ?? null };
}

export function BoundariesSection({
  document,
  issues = [],
  scenario,
  onChange,
  mintId,
  onGuardValidityChange,
  _defaultExpandedId,
}: BoundariesSectionProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(_defaultExpandedId ?? null);
  const options = React.useMemo(() => crossingOptions(document, scenario), [document, scenario]);
  const [adding, setAdding] = React.useState(false);
  const [invalidGuardIds, setInvalidGuardIds] = React.useState<ReadonlySet<string>>(() => new Set());

  React.useEffect(() => {
    const liveResponseIds = new Set(
      scenario.boundaries.flatMap((boundary) => boundary.responses.map((response) => response.id)),
    );
    setInvalidGuardIds((current) => {
      const next = new Set([...current].filter((id) => liveResponseIds.has(id)));
      if (next.size === current.size) return current;
      onGuardValidityChange?.(next.size === 0);
      return next;
    });
  }, [onGuardValidityChange, scenario.boundaries]);

  const setGuardValidity = (responseId: string, valid: boolean) => {
    const next = new Set(invalidGuardIds);
    if (valid) next.delete(responseId);
    else next.add(responseId);
    if (next.size === invalidGuardIds.size && [...next].every((id) => invalidGuardIds.has(id))) return;
    setInvalidGuardIds(next);
    onGuardValidityChange?.(next.size === 0);
  };
  const updateResponse = (
    boundaryId: string,
    responseId: string,
    patch: (response: BoundaryResponse) => BoundaryResponse,
  ) => {
    setExpandedId(responseId);
    onChange((draft) => ({
      ...draft,
      boundaries: draft.boundaries.map((boundary) =>
        boundary.id === boundaryId
          ? {
              ...boundary,
              responses: boundary.responses.map((response) =>
                response.id === responseId ? patch(response) : response,
              ),
            }
          : boundary,
      ),
    }));
  };
  const removeResponse = (boundaryId: string, responseId: string) =>
    onChange((draft) => ({
      ...draft,
      boundaries: draft.boundaries.flatMap((boundary) => {
        if (boundary.id !== boundaryId) return [boundary];
        const responses = boundary.responses.filter((response) => response.id !== responseId);
        return responses.length === 0 ? [] : [{ ...boundary, responses }];
      }),
    }));
  const addResponse = (option: CrossingOption, response: BoundaryResponse) => {
    onChange((draft) => {
      const existing = draft.boundaries.find(
        (boundary) =>
          boundary.source.elementId === option.source.elementId && boundary.source.portId === option.source.portId,
      );
      return {
        ...draft,
        boundaries: existing
          ? draft.boundaries.map((boundary) =>
              boundary.id === existing.id ? { ...boundary, responses: [...boundary.responses, response] } : boundary,
            )
          : [
              ...draft.boundaries,
              {
                id: mintId(),
                source: option.source,
                schemaId: option.responseSchemaId,
                responses: [response],
              },
            ],
      };
    });
    setAdding(false);
  };
  return (
    <section data-testid="scenario-section-boundaries" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text ">
            What happens during the run
          </div>
          <div className="text-[11px] text-secondary-text">Replies from outside this scenario's scope.</div>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={options.length === 0} onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add reply
        </Button>
      </div>
      {options.length === 0 && (
        <p className="text-[11px] text-secondary-text">
          No scoped call crosses to an outside element with a response fixture.
        </p>
      )}
      {adding && (
        <NewResponseForm
          document={document}
          scenario={scenario}
          options={options}
          mintId={mintId}
          onAdd={addResponse}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="space-y-2">
        {scenario.boundaries.map((boundary) => {
          const schemas = sourceSchemas(document, boundary.source);
          return (
            <div
              key={boundary.id}
              data-testid={`boundary-row-${boundary.id}`}
              className="space-y-2"
            >
              <div className="text-xs font-semibold text-foreground px-2">{endpointLabel(document, boundary.source)}</div>
              {boundary.responses.map((response, responseIndex) => (
                <CompactRow
                  key={response.id}
                  isExpanded={expandedId === response.id}
                  onToggle={() => setExpandedId(expandedId === response.id ? null : response.id)}
                  issues={issues.filter(i => i.path?.[0] === 'boundaries' && i.path?.[1] === scenario.boundaries.findIndex(b => b.id === boundary.id) && i.path?.[2] === 'responses' && i.path?.[3] === responseIndex)}
                  summary={
                    <span className="flex items-center gap-2">
                      <span className="text-secondary-text">Reply {responseIndex + 1} · {response.outcome}</span>
                    </span>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-secondary-text">Reply {responseIndex + 1}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove reply"
                        onClick={() => removeResponse(boundary.id, response.id)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    <GuardBuilder
                      document={document}
                      inputSchemaId={schemas.request}
                      guard={response.match}
                      onValidChange={(match) => {
                        if (match)
                          updateResponse(boundary.id, response.id, (current) => ({
                            ...current,
                            match,
                          }));
                      }}
                      onValidityChange={(valid) => setGuardValidity(response.id, valid)}
                    />
                    <ResponseFields
                      document={document}
                      scenario={scenario}
                      boundary={boundary}
                      response={response}
                      requestSchemaId={schemas.request}
                      onChange={(patch) => updateResponse(boundary.id, response.id, patch)}
                    />
                  </div>
                </CompactRow>
              ))}
            </div>
          );
        })}
        {scenario.boundaries.length === 0 && !adding && (
          <p className="text-[11px] text-secondary-text">No replies configured yet.</p>
        )}
      </div>
    </section>
  );
}

function NewResponseForm({
  document,
  scenario,
  options,
  mintId,
  onAdd,
  onCancel,
}: {
  _defaultExpandedId?: string;
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly options: readonly CrossingOption[];
  readonly mintId: MintId;
  readonly onAdd: (option: CrossingOption, response: BoundaryResponse) => void;
  readonly onCancel: () => void;
}) {
  const [sourceKey, setSourceKey] = React.useState('');
  const [fixtureId, setFixtureId] = React.useState('');
  const [outcome, setOutcome] = React.useState<TransportOutcome | null>(null);
  const [delivery, setDelivery] = React.useState<string | null>(null);
  const [match, setMatch] = React.useState<Guard | null>(null);
  const option = options.find((candidate) => candidate.key === sourceKey) ?? null;
  const fixtures = option ? fixtureOptionsForSchema(document, option.responseSchemaId) : [];
  const canAdd = option !== null && fixtureId !== '' && outcome !== null && delivery !== null && match !== null;
  return (
    <div className="space-y-2 rounded-control border border-control-border bg-sunken p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-secondary-text">
          Outside call
          <NativeSelect
            value={sourceKey}
            aria-label="Reply source"
            onChange={(event) => {
              setSourceKey(event.target.value);
              setFixtureId('');
              setMatch(null);
            }}
          >
            <NativeSelectOption value="" disabled>
              Choose…
            </NativeSelectOption>
            {options.map((candidate) => (
              <NativeSelectOption key={candidate.key} value={candidate.key}>
                {candidate.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-[11px] text-secondary-text">
          Reply payload
          <NativeSelect
            value={fixtureId}
            aria-label="Reply payload fixture"
            disabled={!option}
            onChange={(event) => setFixtureId(event.target.value)}
          >
            <NativeSelectOption value="" disabled>
              Choose…
            </NativeSelectOption>
            {fixtures.map((fixture) => (
              <NativeSelectOption key={fixture.fixtureId} value={fixture.fixtureId}>
                {fixture.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-[11px] text-secondary-text">
          Outcome
          <NativeSelect
            value={outcome ?? ''}
            aria-label="Reply outcome"
            onChange={(event) => setOutcome(event.target.value as TransportOutcome)}
          >
            <NativeSelectOption value="" disabled>
              Choose…
            </NativeSelectOption>
            {TRANSPORT_OUTCOMES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-[11px] text-secondary-text">
          Delivery
          <NativeSelect
            value={delivery ?? '__unset__'}
            aria-label="Reply delivery"
            onChange={(event) => setDelivery(event.target.value)}
          >
            <NativeSelectOption value="__unset__" disabled>
              Choose…
            </NativeSelectOption>
            <NativeSelectOption value="">Immediately</NativeSelectOption>
            {scenario.inputs.map((input, index) => (
              <NativeSelectOption key={input.id} value={input.id}>
                After step {index + 1}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {option && (
        <GuardBuilder
          key={option.key}
          document={document}
          inputSchemaId={option.requestSchemaId}
          guard={null}
          onValidChange={setMatch}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canAdd}
          onClick={() => {
            if (option && match && outcome && delivery !== null)
              onAdd(option, {
                id: mintId(),
                match,
                responseFixtureId: fixtureId,
                payloadBindings: [],
                delayMs: null,
                afterInputId: delivery === '' ? null : delivery,
                outcome,
              });
          }}
        >
          Add reply
        </Button>
      </div>
    </div>
  );
}

function ResponseFields({
  document,
  scenario,
  boundary,
  response,
  requestSchemaId,
  onChange,
}: {
  _defaultExpandedId?: string;
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly boundary: Boundary;
  readonly response: BoundaryResponse;
  readonly requestSchemaId: string | null;
  readonly onChange: (patch: (response: BoundaryResponse) => BoundaryResponse) => void;
}) {
  const [addingBinding, setAddingBinding] = React.useState(false);
  const fixtures = fixtureOptionsForSchema(document, boundary.schemaId);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-secondary-text">
          Reply payload
          <NativeSelect
            value={response.responseFixtureId}
            aria-label="Reply payload fixture"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                responseFixtureId: event.target.value,
              }))
            }
          >
            {fixtures.map((fixture) => (
              <NativeSelectOption key={fixture.fixtureId} value={fixture.fixtureId}>
                {fixture.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-[11px] text-secondary-text">
          Outcome
          <NativeSelect
            value={response.outcome}
            aria-label="Reply outcome"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                outcome: event.target.value as TransportOutcome,
              }))
            }
          >
            {TRANSPORT_OUTCOMES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="col-span-2 space-y-1 text-[11px] text-secondary-text">
          Answers
          <NativeSelect
            value={response.repeat ? 'every' : 'once'}
            aria-label="Answers"
            data-testid="boundary-response-repeat"
            onChange={(event) =>
              onChange((current) => {
                const { repeat: _omit, ...rest } = current;
                return event.target.value === 'every' ? { ...rest, repeat: true } : rest;
              })
            }
          >
            <NativeSelectOption value="once">One matching request</NativeSelectOption>
            <NativeSelectOption value="every">Every matching request</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="col-span-2 space-y-1 text-[11px] text-secondary-text">
          Deliver after step
          <NativeSelect
            value={response.afterInputId ?? ''}
            aria-label="Deliver after step"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                afterInputId: event.target.value === '' ? null : event.target.value,
              }))
            }
          >
            <NativeSelectOption value="">Immediately</NativeSelectOption>
            {scenario.inputs.map((input, index) => (
              <NativeSelectOption key={input.id} value={input.id}>
                After step {index + 1}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-medium tracking-wider text-secondary-text ">
          Payload bindings
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAddingBinding(true)}>
          <Plus className="size-3" />
          Add binding
        </Button>
      </div>
      {response.payloadBindings.map((binding, index) => (
        <BindingEditor
          key={index}
          document={document}
          requestSchemaId={requestSchemaId}
          responseSchemaId={boundary.schemaId}
          binding={binding}
          onChange={(next) =>
            onChange((current) => ({
              ...current,
              payloadBindings: current.payloadBindings.map((candidate, itemIndex) =>
                itemIndex === index ? next : candidate,
              ),
            }))
          }
          onRemove={() =>
            onChange((current) => ({
              ...current,
              payloadBindings: current.payloadBindings.filter((_, itemIndex) => itemIndex !== index),
            }))
          }
        />
      ))}
      {addingBinding && (
        <NewBindingForm
          document={document}
          requestSchemaId={requestSchemaId}
          responseSchemaId={boundary.schemaId}
          onAdd={(binding) => {
            onChange((current) => ({
              ...current,
              payloadBindings: [...current.payloadBindings, binding],
            }));
            setAddingBinding(false);
          }}
          onCancel={() => setAddingBinding(false)}
        />
      )}
    </div>
  );
}

function BindingEditor({
  document,
  requestSchemaId,
  responseSchemaId,
  binding,
  onChange,
  onRemove,
}: {
  _defaultExpandedId?: string;
  readonly document: Document;
  readonly requestSchemaId: string | null;
  readonly responseSchemaId: string;
  readonly binding: BoundaryPayloadBinding;
  readonly onChange: (binding: BoundaryPayloadBinding) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
      <SchemaPathPicker
        document={document}
        schemaId={requestSchemaId}
        path={binding.requestPath}
        onChange={(requestPath) => onChange({ ...binding, requestPath })}
        label="From request"
      />
      <SchemaPathPicker
        document={document}
        schemaId={responseSchemaId}
        path={binding.targetPath}
        onChange={(targetPath) => onChange({ ...binding, targetPath })}
        label="Into response"
      />
      <Button type="button" size="icon" variant="ghost" aria-label="Remove payload binding" onClick={onRemove}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

function NewBindingForm({
  document,
  requestSchemaId,
  responseSchemaId,
  onAdd,
  onCancel,
}: {
  _defaultExpandedId?: string;
  readonly document: Document;
  readonly requestSchemaId: string | null;
  readonly responseSchemaId: string;
  readonly onAdd: (binding: BoundaryPayloadBinding) => void;
  readonly onCancel: () => void;
}) {
  const [requestPath, setRequestPath] = React.useState<Path | null>(null);
  const [targetPath, setTargetPath] = React.useState<Path | null>(null);
  return (
    <div className="space-y-2 rounded-control border border-control-border p-2">
      <div className="grid grid-cols-2 gap-2">
        <SchemaPathPicker
          document={document}
          schemaId={requestSchemaId}
          path={requestPath}
          onChange={setRequestPath}
          label="From request"
        />
        <SchemaPathPicker
          document={document}
          schemaId={responseSchemaId}
          path={targetPath}
          onChange={setTargetPath}
          label="Into response"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={requestPath === null || targetPath === null}
          onClick={() => {
            if (requestPath !== null && targetPath !== null) onAdd({ requestPath, targetPath });
          }}
        >
          Add binding
        </Button>
      </div>
    </div>
  );
}
