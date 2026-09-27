/**
 * "What should be true" section: assertions (RV-05c).
 *
 * commands.md §4 "Editor sections": "assertions; last-run pass/fail marks per check."
 * model-and-runner.md §6: Assertion subjects (final-state, context, output, count,
 * trace-count, metric), operators (equals/at-most/at-least), and `expected:Json`.
 *
 * `expected` is Json in the contract, but the brief requires "typed controls, never raw
 * JSON": a small kind selector (number / text / true / false) plus the matching typed
 * input produces the Json value, instead of a free-text JSON box.
 *
 * Review round: a new `output`/`context` subject's `path` starts unset (`null`), not a
 * silent `[]`. The path picker always offers "Whole value" as an explicit option
 * (mapping to `[]` only once chosen) plus, when the relevant schema is a record shape,
 * one option per top-level field key (pickers.ts's `pathOptionsForSchema`) -- nothing
 * is preselected, and draft.ts's `draftCompletenessIssues` blocks Apply while `path` is
 * still `null`.
 */

import * as React from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import type {
  AssertionSubject,
  CountSubjectOutcome,
  CountSubjectScope,
  Document,
  Json,
  MetricSubjectKey,
} from '../../domain/studio/model';
import {
  ASSERTION_OPERATORS,
  ASSERTION_SUBJECT_KINDS,
  COUNT_SUBJECT_OUTCOMES,
  COUNT_SUBJECT_SCOPES,
  METRIC_SUBJECT_KEYS,
} from '../../domain/studio/model';
import type { CheckResult } from '../../domain/studio/runner/types';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { allElementOptions, inboundEndpointOptions, outboundEndpointOptions, pathOptionsForSchema } from './pickers';
import type { DraftAssertion, DraftAssertionSubject, DraftScenario } from './draftScenario';
import type { MintId } from './types';

export interface AssertionsSectionProps {
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
  readonly mintId: MintId;
  /** commands.md §4: "last-run pass/fail marks per check." */
  readonly lastRunChecks?: ReadonlyMap<string, CheckResult> | null;
}

type ExpectedKind = 'number' | 'text' | 'true' | 'false';

function expectedKindOf(value: Json): ExpectedKind {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return 'number';
  return 'text';
}

function defaultSubject(): DraftAssertionSubject {
  return { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' };
}

export function AssertionsSection({ document, scenario, onChange, mintId, lastRunChecks }: AssertionsSectionProps) {
  const elements = React.useMemo(() => allElementOptions(document), [document]);
  const outputPorts = React.useMemo(
    () => [...inboundEndpointOptions(document), ...outboundEndpointOptions(document)],
    [document],
  );

  const addAssertion = () => {
    const assertion: DraftAssertion = {
      id: mintId(),
      label: 'New check',
      subject: defaultSubject(),
      operator: 'equals',
      expected: 0,
    };
    onChange((s) => ({ ...s, assertions: [...s.assertions, assertion] }));
  };

  const updateAssertion = (id: string, patch: (a: DraftAssertion) => DraftAssertion) => {
    onChange((s) => ({ ...s, assertions: s.assertions.map((a) => (a.id === id ? patch(a) : a)) }));
  };

  const removeAssertion = (id: string) => {
    onChange((s) => ({ ...s, assertions: s.assertions.filter((a) => a.id !== id) }));
  };

  return (
    <section data-testid="scenario-section-assertions" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">
            What should be true
          </div>
          <div className="text-[11px] text-secondary-text">The run passes only if every check passes.</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addAssertion}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add check
        </Button>
      </div>

      <div className="space-y-2">
        {scenario.assertions.map((assertion) => {
          const check = lastRunChecks?.get(assertion.id) ?? null;
          const expectedKind = expectedKindOf(assertion.expected);

          return (
            <div
              key={assertion.id}
              data-testid={`assertion-row-${assertion.id}`}
              className="rounded-control border border-control-border bg-panel p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <Input
                  className="h-7 text-xs font-semibold"
                  value={assertion.label}
                  onChange={(e) => updateAssertion(assertion.id, (a) => ({ ...a, label: e.target.value }))}
                  aria-label="Check label"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  {check && (
                    <span
                      data-testid={`assertion-check-mark-${assertion.id}`}
                      className={check.status === 'passed' ? 'text-primary' : 'text-risk-text'}
                      title={check.status}
                    >
                      {check.status === 'passed' ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <X className="size-3.5" aria-hidden="true" />
                      )}
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-secondary-text hover:text-risk-text"
                    onClick={() => removeAssertion(assertion.id)}
                    aria-label="Remove check"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <SubjectEditor
                document={document}
                elements={elements}
                outputPorts={outputPorts}
                subject={assertion.subject}
                onChange={(subject) => updateAssertion(assertion.id, (a) => ({ ...a, subject }))}
              />

              <div className="grid grid-cols-3 gap-2 items-end">
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Operator
                  <NativeSelect
                    value={assertion.operator}
                    onChange={(e) =>
                      updateAssertion(assertion.id, (a) => ({
                        ...a,
                        operator: e.target.value as DraftAssertion['operator'],
                      }))
                    }
                    aria-label="Operator"
                  >
                    {ASSERTION_OPERATORS.map((op) => (
                      <NativeSelectOption key={op} value={op}>
                        {op}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>

                <label className="space-y-1 text-[11px] text-secondary-text">
                  Expected type
                  <NativeSelect
                    value={expectedKind}
                    onChange={(e) => {
                      const kind = e.target.value as ExpectedKind;
                      const expected: Json = kind === 'number' ? 0 : kind === 'true' ? true : kind === 'false' ? false : '';
                      updateAssertion(assertion.id, (a) => ({ ...a, expected }));
                    }}
                    aria-label="Expected value type"
                  >
                    <NativeSelectOption value="number">Number</NativeSelectOption>
                    <NativeSelectOption value="text">Text</NativeSelectOption>
                    <NativeSelectOption value="true">True</NativeSelectOption>
                    <NativeSelectOption value="false">False</NativeSelectOption>
                  </NativeSelect>
                </label>

                {(expectedKind === 'number' || expectedKind === 'text') && (
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Expected value
                    <Input
                      type={expectedKind === 'number' ? 'number' : 'text'}
                      value={typeof assertion.expected === 'string' || typeof assertion.expected === 'number' ? assertion.expected : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const expected: Json = expectedKind === 'number' ? (raw === '' ? 0 : Number(raw)) : raw;
                        updateAssertion(assertion.id, (a) => ({ ...a, expected }));
                      }}
                      aria-label="Expected value"
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}

        {scenario.assertions.length === 0 && (
          <p className="text-[11px] text-secondary-text">
            No checks. commands.md: a scenario with no checks is "Completed · no checks" and never passes.
          </p>
        )}
      </div>
    </section>
  );
}

const UNSET_PATH_VALUE = '__unset__';

function SubjectEditor({
  document,
  elements,
  outputPorts,
  subject,
  onChange,
}: {
  readonly document: Document;
  readonly elements: readonly { readonly elementId: string; readonly label: string }[];
  readonly outputPorts: readonly { readonly elementId: string; readonly portId: string; readonly label: string }[];
  readonly subject: DraftAssertionSubject;
  readonly onChange: (subject: DraftAssertionSubject) => void;
}) {
  const firstElementId = elements[0]?.elementId ?? '';

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-[11px] text-secondary-text">
        Checks
        <NativeSelect
          value={subject.kind}
          onChange={(e) => {
            const kind = e.target.value as AssertionSubject['kind'];
            switch (kind) {
              case 'final-state':
                onChange({ kind, elementId: firstElementId });
                break;
              case 'context':
                onChange({ kind, elementId: firstElementId, path: null });
                break;
              case 'output':
                onChange({
                  kind,
                  port: outputPorts[0]
                    ? { elementId: outputPorts[0].elementId, portId: outputPorts[0].portId }
                    : { elementId: firstElementId, portId: '' },
                  path: null,
                });
                break;
              case 'count':
                onChange({ kind, scope: 'root', elementId: null, outcome: 'succeeded' });
                break;
              case 'trace-count':
                onChange({ kind, elementId: firstElementId, code: '' });
                break;
              case 'metric':
                onChange({ kind, elementId: firstElementId, key: 'throughput' });
                break;
            }
          }}
          aria-label="Assertion subject kind"
        >
          {ASSERTION_SUBJECT_KINDS.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {k}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>

      {(subject.kind === 'final-state' || subject.kind === 'context' || subject.kind === 'trace-count' || subject.kind === 'metric') && (
        <label className="space-y-1 text-[11px] text-secondary-text">
          Element
          <NativeSelect
            value={subject.elementId ?? ''}
            onChange={(e) => onChange({ ...subject, elementId: e.target.value })}
            aria-label="Assertion element"
          >
            {elements.map((el) => (
              <NativeSelectOption key={el.elementId} value={el.elementId}>
                {el.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}

      {subject.kind === 'count' && (
        <>
          <label className="space-y-1 text-[11px] text-secondary-text">
            Scope
            <NativeSelect
              value={subject.scope}
              onChange={(e) => onChange({ ...subject, scope: e.target.value as CountSubjectScope })}
              aria-label="Count scope"
            >
              {COUNT_SUBJECT_SCOPES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {s}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-[11px] text-secondary-text">
            Outcome
            <NativeSelect
              value={subject.outcome}
              onChange={(e) => onChange({ ...subject, outcome: e.target.value as CountSubjectOutcome })}
              aria-label="Count outcome"
            >
              {COUNT_SUBJECT_OUTCOMES.map((o) => (
                <NativeSelectOption key={o} value={o}>
                  {o}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {subject.scope === 'element' && (
            <label className="space-y-1 text-[11px] text-secondary-text col-span-2">
              Element
              <NativeSelect
                value={subject.elementId ?? ''}
                onChange={(e) => onChange({ ...subject, elementId: e.target.value })}
                aria-label="Count element"
              >
                {elements.map((el) => (
                  <NativeSelectOption key={el.elementId} value={el.elementId}>
                    {el.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
        </>
      )}

      {subject.kind === 'metric' && (
        <label className="space-y-1 text-[11px] text-secondary-text">
          Metric
          <NativeSelect
            value={subject.key}
            onChange={(e) => onChange({ ...subject, key: e.target.value as MetricSubjectKey })}
            aria-label="Metric key"
          >
            {METRIC_SUBJECT_KEYS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {k}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}

      {subject.kind === 'output' && (
        <>
          <label className="space-y-1 text-[11px] text-secondary-text col-span-2">
            Port
            <NativeSelect
              value={`${subject.port.elementId}:${subject.port.portId}`}
              onChange={(e) => {
                const [elementId, portId] = e.target.value.split(':');
                onChange({ ...subject, port: { elementId, portId }, path: null });
              }}
              aria-label="Output port"
            >
              {outputPorts.map((p) => (
                <NativeSelectOption key={`${p.elementId}:${p.portId}`} value={`${p.elementId}:${p.portId}`}>
                  {p.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <PathPicker
            className="col-span-2"
            options={pathOptionsForSchema(
              document,
              document.elements.find((e) => e.id === subject.port.elementId)?.ports.find((p) => p.id === subject.port.portId)
                ?.schemaId ?? null,
            )}
            path={subject.path}
            onChange={(path) => onChange({ ...subject, path })}
          />
        </>
      )}

      {subject.kind === 'context' && (
        <PathPicker
          className="col-span-2"
          options={pathOptionsForSchema(document, contextSchemaId(document, subject.elementId))}
          path={subject.path}
          onChange={(path) => onChange({ ...subject, path })}
        />
      )}

      {subject.kind === 'trace-count' && (
        <label className="space-y-1 text-[11px] text-secondary-text">
          Trace code
          <Input
            value={subject.code}
            onChange={(e) => onChange({ ...subject, code: e.target.value })}
            aria-label="Trace code"
          />
        </label>
      )}
    </div>
  );
}

function contextSchemaId(document: Document, elementId: string): string | null {
  const element = document.elements.find((e) => e.id === elementId);
  return element && element.behavior.kind === 'machine' ? element.behavior.contextSchemaId : null;
}

function PathPicker({
  options,
  path,
  onChange,
  className,
}: {
  readonly options: ReturnType<typeof pathOptionsForSchema>;
  readonly path: readonly (string | number)[] | null;
  readonly onChange: (path: readonly (string | number)[]) => void;
  readonly className?: string;
}) {
  const selectedKey = path === null ? UNSET_PATH_VALUE : path.length === 0 ? '' : String(path[0]);

  return (
    <label className={`space-y-1 text-[11px] text-secondary-text ${className ?? ''}`}>
      Which part of the value
      <NativeSelect
        value={selectedKey}
        onChange={(e) => {
          if (e.target.value === UNSET_PATH_VALUE) return;
          const option = options.find((o) => o.key === e.target.value);
          if (option) onChange(option.path);
        }}
        aria-label="Which part of the value"
        aria-invalid={path === null}
      >
        {path === null && (
          <NativeSelectOption value={UNSET_PATH_VALUE} disabled>
            Choose…
          </NativeSelectOption>
        )}
        {options.map((o) => (
          <NativeSelectOption key={o.key} value={o.key}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
