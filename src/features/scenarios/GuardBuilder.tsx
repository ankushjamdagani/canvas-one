import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Document, Guard, Json, Path, Value } from '../../domain/studio/model';
import { GUARD_OPS, VALUE_KINDS } from '../../domain/studio/model';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { SchemaPathPicker } from './SchemaPathPicker';

type LiteralDraft = {
  readonly kind: 'literal';
  readonly valueType: 'text' | 'number' | 'true' | 'false' | 'null' | null;
  readonly value: string;
};
type ReadDraft = {
  readonly kind: 'read';
  readonly source: 'input' | 'context' | null;
  readonly path: Path | null;
};
type RecordDraft = {
  readonly kind: 'record';
  readonly fields: readonly {
    readonly key: string;
    readonly value: ValueDraft;
  }[];
};
type ListDraft = {
  readonly kind: 'list';
  readonly items: readonly ValueDraft[];
};
type OutcomeDraft = { readonly kind: 'outcome' };
type ValueDraft = LiteralDraft | ReadDraft | RecordDraft | ListDraft | OutcomeDraft | { readonly kind: null };

type GuardDraft =
  | { readonly op: null }
  | {
      readonly op: 'equals' | 'notEquals';
      readonly left: ValueDraft;
      readonly right: ValueDraft;
    }
  | {
      readonly op: 'exists' | 'positiveInteger' | 'nonEmpty';
      readonly value: ValueDraft;
    }
  | { readonly op: 'all' | 'any'; readonly guards: readonly GuardDraft[] }
  | {
      readonly op: 'every';
      readonly value: ValueDraft;
      readonly itemGuard: GuardDraft;
    };

function valueToDraft(value: Value): ValueDraft {
  switch (value.kind) {
    case 'literal': {
      const valueType =
        value.value === null
          ? 'null'
          : typeof value.value === 'boolean'
            ? value.value
              ? 'true'
              : 'false'
            : typeof value.value === 'number'
              ? 'number'
              : 'text';
      return {
        kind: 'literal',
        valueType,
        value: typeof value.value === 'string' || typeof value.value === 'number' ? String(value.value) : '',
      };
    }
    case 'read':
      return { ...value, path: value.path };
    case 'record':
      return {
        kind: 'record',
        fields: value.fields.map((field) => ({
          key: field.key,
          value: valueToDraft(field.value),
        })),
      };
    case 'list':
      return { kind: 'list', items: value.items.map(valueToDraft) };
    case 'outcome':
      return value;
  }
}

function valueFromDraft(value: ValueDraft): Value | null {
  switch (value.kind) {
    case null:
      return null;
    case 'literal': {
      if (value.valueType === null) return null;
      let parsed: Json;
      if (value.valueType === 'null') parsed = null;
      else if (value.valueType === 'true') parsed = true;
      else if (value.valueType === 'false') parsed = false;
      else if (value.valueType === 'number') {
        if (value.value.trim() === '') return null;
        const number = Number(value.value);
        if (!Number.isFinite(number)) return null;
        parsed = number;
      } else parsed = value.value;
      return { kind: 'literal', value: parsed };
    }
    case 'read':
      return value.source !== null && value.path !== null
        ? { kind: 'read', source: value.source, path: value.path }
        : null;
    case 'record': {
      const fields = [];
      for (const field of value.fields) {
        if (field.key.trim() === '') return null;
        const converted = valueFromDraft(field.value);
        if (converted === null) return null;
        fields.push({ key: field.key, value: converted });
      }
      return { kind: 'record', fields };
    }
    case 'list': {
      const items: Value[] = [];
      for (const item of value.items) {
        const converted = valueFromDraft(item);
        if (converted === null) return null;
        items.push(converted);
      }
      return { kind: 'list', items };
    }
    case 'outcome':
      return value;
  }
}

function guardToDraft(guard: Guard): GuardDraft {
  switch (guard.op) {
    case 'equals':
    case 'notEquals':
      return {
        op: guard.op,
        left: valueToDraft(guard.left),
        right: valueToDraft(guard.right),
      };
    case 'exists':
    case 'positiveInteger':
    case 'nonEmpty':
      return { op: guard.op, value: valueToDraft(guard.value) };
    case 'all':
    case 'any':
      return { op: guard.op, guards: guard.guards.map(guardToDraft) };
    case 'every':
      return {
        op: 'every',
        value: valueToDraft(guard.value),
        itemGuard: guardToDraft(guard.itemGuard),
      };
  }
}

function guardFromDraft(guard: GuardDraft): Guard | null {
  switch (guard.op) {
    case null:
      return null;
    case 'equals':
    case 'notEquals': {
      const left = valueFromDraft(guard.left);
      const right = valueFromDraft(guard.right);
      return left !== null && right !== null ? { op: guard.op, left, right } : null;
    }
    case 'exists':
    case 'positiveInteger':
    case 'nonEmpty': {
      const value = valueFromDraft(guard.value);
      return value !== null ? { op: guard.op, value } : null;
    }
    case 'all':
    case 'any': {
      if (guard.guards.length === 0) return null;
      const guards: Guard[] = [];
      for (const item of guard.guards) {
        const converted = guardFromDraft(item);
        if (converted === null) return null;
        guards.push(converted);
      }
      return { op: guard.op, guards };
    }
    case 'every': {
      const value = valueFromDraft(guard.value);
      const itemGuard = guardFromDraft(guard.itemGuard);
      return value !== null && itemGuard !== null ? { op: 'every', value, itemGuard } : null;
    }
  }
}

function emptyGuard(op: Guard['op']): GuardDraft {
  if (op === 'equals' || op === 'notEquals') return { op, left: { kind: null }, right: { kind: null } };
  if (op === 'exists' || op === 'positiveInteger' || op === 'nonEmpty') return { op, value: { kind: null } };
  if (op === 'all' || op === 'any') return { op, guards: [] };
  return { op: 'every', value: { kind: null }, itemGuard: { op: null } };
}

export interface GuardBuilderProps {
  readonly document: Document;
  readonly inputSchemaId: string | null;
  readonly guard: Guard | null;
  readonly onValidChange: (guard: Guard | null) => void;
  readonly onValidityChange?: (valid: boolean) => void;
  readonly label?: string;
}

export function GuardBuilder({
  document,
  inputSchemaId,
  guard,
  onValidChange,
  onValidityChange,
  label = 'Match condition',
}: GuardBuilderProps) {
  const [draft, setDraft] = React.useState<GuardDraft>(() => (guard ? guardToDraft(guard) : { op: null }));

  React.useEffect(() => {
    setDraft(guard ? guardToDraft(guard) : { op: null });
  }, [guard]);

  const update = (next: GuardDraft) => {
    setDraft(next);
    const converted = guardFromDraft(next);
    onValidChange(converted);
    onValidityChange?.(converted !== null);
  };

  return (
    <div className="space-y-2 rounded-control border border-control-border bg-sunken p-2">
      <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text ">{label}</div>
      <GuardDraftEditor document={document} inputSchemaId={inputSchemaId} draft={draft} onChange={update} />
    </div>
  );
}

function GuardDraftEditor({
  document,
  inputSchemaId,
  draft,
  onChange,
}: {
  readonly document: Document;
  readonly inputSchemaId: string | null;
  readonly draft: GuardDraft;
  readonly onChange: (draft: GuardDraft) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-[11px] text-secondary-text">
        Condition
        <NativeSelect
          value={draft.op ?? ''}
          aria-label="Guard operator"
          aria-invalid={draft.op === null}
          onChange={(event) => onChange(emptyGuard(event.target.value as Guard['op']))}
        >
          {draft.op === null && (
            <NativeSelectOption value="" disabled>
              Choose…
            </NativeSelectOption>
          )}
          {GUARD_OPS.map((op) => (
            <NativeSelectOption key={op} value={op}>
              {op}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {(draft.op === 'equals' || draft.op === 'notEquals') && (
        <div className="grid grid-cols-2 gap-2">
          <ValueDraftEditor
            label="Left value"
            document={document}
            inputSchemaId={inputSchemaId}
            draft={draft.left}
            onChange={(left) => onChange({ ...draft, left })}
          />
          <ValueDraftEditor
            label="Right value"
            document={document}
            inputSchemaId={inputSchemaId}
            draft={draft.right}
            onChange={(right) => onChange({ ...draft, right })}
          />
        </div>
      )}
      {(draft.op === 'exists' || draft.op === 'positiveInteger' || draft.op === 'nonEmpty') && (
        <ValueDraftEditor
          label="Value"
          document={document}
          inputSchemaId={inputSchemaId}
          draft={draft.value}
          onChange={(value) => onChange({ ...draft, value })}
        />
      )}
      {(draft.op === 'all' || draft.op === 'any') && (
        <div className="space-y-2">
          {draft.guards.map((guard, index) => (
            <div key={index} className="space-y-1 border-l border-control-border pl-2">
              <GuardDraftEditor
                document={document}
                inputSchemaId={inputSchemaId}
                draft={guard}
                onChange={(next) =>
                  onChange({
                    ...draft,
                    guards: draft.guards.map((item, itemIndex) => (itemIndex === index ? next : item)),
                  })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...draft,
                    guards: draft.guards.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Trash2 className="size-3" aria-hidden="true" />
                Remove condition
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...draft, guards: [...draft.guards, { op: null }] })}
          >
            <Plus className="size-3" aria-hidden="true" />
            Add condition
          </Button>
        </div>
      )}
      {draft.op === 'every' && (
        <div className="space-y-2">
          <ValueDraftEditor
            label="List value"
            document={document}
            inputSchemaId={inputSchemaId}
            draft={draft.value}
            onChange={(value) => onChange({ ...draft, value })}
          />
          <div className="border-l border-control-border pl-2">
            <GuardDraftEditor
              document={document}
              inputSchemaId={inputSchemaId}
              draft={draft.itemGuard}
              onChange={(itemGuard) => onChange({ ...draft, itemGuard })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ValueDraftEditor({
  label,
  document,
  inputSchemaId,
  draft,
  onChange,
}: {
  readonly label: string;
  readonly document: Document;
  readonly inputSchemaId: string | null;
  readonly draft: ValueDraft;
  readonly onChange: (draft: ValueDraft) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1 text-[11px] text-secondary-text">
        {label}
        <NativeSelect
          value={draft.kind ?? ''}
          aria-label={`${label} kind`}
          aria-invalid={draft.kind === null}
          onChange={(event) => {
            const kind = event.target.value as Value['kind'];
            if (kind === 'literal') onChange({ kind, valueType: null, value: '' });
            else if (kind === 'read') onChange({ kind, source: null, path: null });
            else if (kind === 'record') onChange({ kind, fields: [] });
            else if (kind === 'list') onChange({ kind, items: [] });
            else onChange({ kind: 'outcome' });
          }}
        >
          {draft.kind === null && (
            <NativeSelectOption value="" disabled>
              Choose…
            </NativeSelectOption>
          )}
          {VALUE_KINDS.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {kind}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {draft.kind === 'literal' && (
        <div className="grid grid-cols-2 gap-1.5">
          <NativeSelect
            value={draft.valueType ?? ''}
            aria-label={`${label} literal type`}
            onChange={(event) =>
              onChange({
                ...draft,
                valueType: event.target.value as LiteralDraft['valueType'],
              })
            }
          >
            {draft.valueType === null && (
              <NativeSelectOption value="" disabled>
                Choose type…
              </NativeSelectOption>
            )}
            <NativeSelectOption value="text">Text</NativeSelectOption>
            <NativeSelectOption value="number">Number</NativeSelectOption>
            <NativeSelectOption value="true">True</NativeSelectOption>
            <NativeSelectOption value="false">False</NativeSelectOption>
            <NativeSelectOption value="null">Null</NativeSelectOption>
          </NativeSelect>
          {(draft.valueType === 'text' || draft.valueType === 'number') && (
            <Input
              type={draft.valueType === 'number' ? 'number' : 'text'}
              value={draft.value}
              aria-label={`${label} literal value`}
              onChange={(event) => onChange({ ...draft, value: event.target.value })}
            />
          )}
        </div>
      )}
      {draft.kind === 'read' && (
        <div className="space-y-1.5">
          <NativeSelect
            value={draft.source ?? ''}
            aria-label={`${label} read source`}
            onChange={(event) =>
              onChange({
                ...draft,
                source: event.target.value as ReadDraft['source'],
                path: null,
              })
            }
          >
            {draft.source === null && (
              <NativeSelectOption value="" disabled>
                Choose source…
              </NativeSelectOption>
            )}
            <NativeSelectOption value="input">Request input</NativeSelectOption>
            <NativeSelectOption value="context">Context</NativeSelectOption>
          </NativeSelect>
          {draft.source !== null && (
            <SchemaPathPicker
              document={document}
              schemaId={draft.source === 'input' ? inputSchemaId : null}
              path={draft.path}
              onChange={(path) => onChange({ ...draft, path })}
              label="Read path"
              ariaLabel={`${label} read path`}
            />
          )}
        </div>
      )}
      {draft.kind === 'record' && (
        <div className="space-y-1.5">
          {draft.fields.map((field, index) => (
            <div key={index} className="grid grid-cols-[1fr_2fr_auto] gap-1">
              <Input
                value={field.key}
                aria-label={`${label} field ${index + 1} key`}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    fields: draft.fields.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, key: event.target.value } : item,
                    ),
                  })
                }
              />
              <ValueDraftEditor
                label={`Field ${index + 1}`}
                document={document}
                inputSchemaId={inputSchemaId}
                draft={field.value}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    fields: draft.fields.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)),
                  })
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove field ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    fields: draft.fields.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...draft,
                fields: [...draft.fields, { key: '', value: { kind: null } }],
              })
            }
          >
            <Plus className="size-3" />
            Add field
          </Button>
        </div>
      )}
      {draft.kind === 'list' && (
        <div className="space-y-1.5">
          {draft.items.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_auto] gap-1">
              <ValueDraftEditor
                label={`Item ${index + 1}`}
                document={document}
                inputSchemaId={inputSchemaId}
                draft={item}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    items: draft.items.map((candidate, itemIndex) => (itemIndex === index ? value : candidate)),
                  })
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove item ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    items: draft.items.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...draft, items: [...draft.items, { kind: null }] })}
          >
            <Plus className="size-3" />
            Add item
          </Button>
        </div>
      )}
    </div>
  );
}
