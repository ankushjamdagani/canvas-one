import * as React from 'react';
import type { Document, Path, Shape } from '../../domain/studio/model';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';

type TemplateSegment = string | { readonly list: true };

type PathTemplate = {
  readonly key: string;
  readonly label: string;
  readonly segments: readonly TemplateSegment[];
};

const UNSET = '__unset__';

function templateKey(segments: readonly TemplateSegment[]): string {
  return JSON.stringify(segments.map((segment) => (typeof segment === 'string' ? segment : null)));
}

function templateLabel(segments: readonly TemplateSegment[]): string {
  if (segments.length === 0) return 'Whole value';
  return segments
    .map((segment, index) => {
      if (typeof segment !== 'string') return '[index]';
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}

export function schemaPathTemplates(shape: Shape, prefix: readonly TemplateSegment[] = []): PathTemplate[] {
  const templates: PathTemplate[] = [
    {
      key: templateKey(prefix),
      label: templateLabel(prefix),
      segments: prefix,
    },
  ];
  if (shape.type === 'record') {
    for (const field of shape.fields) {
      templates.push(...schemaPathTemplates(field.shape, [...prefix, field.key]));
    }
  } else if (shape.type === 'list') {
    templates.push(...schemaPathTemplates(shape.items, [...prefix, { list: true }]));
  }
  return templates;
}

function matchesTemplate(path: Path, template: PathTemplate): boolean {
  return (
    path.length === template.segments.length &&
    path.every((segment, index) => {
      const expected = template.segments[index];
      return typeof expected === 'string' ? segment === expected : typeof segment === 'number';
    })
  );
}

function materialize(
  template: PathTemplate,
  current: Path | null,
  pending: Readonly<Record<number, number>>,
): Path | null {
  const result: Array<string | number> = [];
  for (let index = 0; index < template.segments.length; index += 1) {
    const segment = template.segments[index];
    if (typeof segment === 'string') {
      result.push(segment);
      continue;
    }
    const chosen = pending[index] ?? current?.[index];
    if (typeof chosen !== 'number') return null;
    result.push(chosen);
  }
  return result;
}

export interface SchemaPathPickerProps {
  readonly document: Document;
  readonly schemaId: string | null;
  readonly path: Path | null;
  readonly onChange: (path: Path) => void;
  readonly label: string;
  readonly className?: string;
  readonly ariaLabel?: string;
}

export function SchemaPathPicker({
  document,
  schemaId,
  path,
  onChange,
  label,
  className,
  ariaLabel = label,
}: SchemaPathPickerProps) {
  const templates = React.useMemo(() => {
    const schema = document.schemas.find((candidate) => candidate.id === schemaId);
    return schema ? schemaPathTemplates(schema.shape) : [{ key: templateKey([]), label: 'Whole value', segments: [] }];
  }, [document, schemaId]);
  const matching = path === null ? null : (templates.find((template) => matchesTemplate(path, template)) ?? null);
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const [pendingIndices, setPendingIndices] = React.useState<Readonly<Record<number, number>>>({});
  const selectedKey = pendingKey ?? (path === null ? UNSET : (matching?.key ?? UNSET));
  const selected = templates.find((template) => template.key === selectedKey) ?? null;

  React.useEffect(() => {
    setPendingKey(null);
    setPendingIndices({});
  }, [path, schemaId]);

  return (
    <div className={`space-y-1 text-[11px] text-secondary-text ${className ?? ''}`}>
      <label className="space-y-1">
        {label}
        <NativeSelect
          value={selectedKey}
          aria-label={ariaLabel}
          aria-invalid={path === null || selected === null}
          onChange={(event) => {
            if (event.target.value === UNSET) return;
            const template = templates.find((candidate) => candidate.key === event.target.value);
            if (!template) return;
            const hasListIndex = template.segments.some((segment) => typeof segment !== 'string');
            if (hasListIndex) {
              setPendingKey(template.key);
              setPendingIndices({});
            } else {
              onChange(template.segments as Path);
            }
          }}
        >
          {(path === null || selected === null) && (
            <NativeSelectOption value={UNSET} disabled>
              Choose…
            </NativeSelectOption>
          )}
          {templates.map((template) => (
            <NativeSelectOption key={template.key} value={template.key}>
              {template.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {selected?.segments.map((segment, index) =>
        typeof segment === 'string' ? null : (
          <label key={index} className="block space-y-1">
            List index for {selected.label}
            <Input
              type="number"
              min={0}
              step={1}
              value={pendingIndices[index] ?? (typeof path?.[index] === 'number' ? path[index] : '')}
              aria-label={`${ariaLabel} list index ${index + 1}`}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isSafeInteger(value) || value < 0) return;
                const indices = { ...pendingIndices, [index]: value };
                setPendingIndices(indices);
                const next = materialize(selected, path, indices);
                if (next !== null) onChange(next);
              }}
            />
          </label>
        ),
      )}
    </div>
  );
}
