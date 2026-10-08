/**
 * Inspector panel: header (name + kind tag(s)), CONFIGURATION section, MEASURED · LAST RUN
 * section and an Apply/Cancel footer.
 * It never renders TIGHTEST LINK, HEADROOM, bottleneck/pressure labels, p99 or a queue-depth
 * sparkline; only measured ElementMetric rows (measured.ts) are shown.
 *
 * `variant='dock'` is the desktop 320px right dock; `variant='sheet'`
 * is the < 768px bottom sheet with identical content and the same navigation guard.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { computeTagColors } from '../../components/studio/tokens';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import type { MeasuredSection } from './measured';
import type { DraftHandle, FieldSpec } from './types';

export interface InspectorPanelProps {
  readonly draft: DraftHandle;
  /** null for target kinds without a measured section (e.g. connections). */
  readonly measured: MeasuredSection | null;
  readonly onChangeField: (fieldId: string, raw: string) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
  readonly saving: boolean;
  /** Set once, right after a failed Apply, so the panel can focus that field. */
  readonly focusFieldId: string | null;
  /** `hosted`: inside PanelHost, which supplies the title bar, close button and docking. */
  readonly variant: 'dock' | 'sheet' | 'hosted';
}

export function InspectorPanel({
  draft,
  measured,
  onChangeField,
  onApply,
  onCancel,
  onClose,
  saving,
  focusFieldId,
  variant,
}: InspectorPanelProps) {
  const fieldRefs = React.useRef(new Map<string, HTMLElement>());

  React.useEffect(() => {
    if (!focusFieldId) return;
    const el = fieldRefs.current.get(focusFieldId);
    el?.focus();
  }, [focusFieldId]);

  const registerRef = React.useCallback(
    (fieldId: string) => (el: HTMLElement | null) => {
      if (el) fieldRefs.current.set(fieldId, el);
      else fieldRefs.current.delete(fieldId);
    },
    [],
  );

  const applyDisabled = saving || draft.status === 'invalid' || draft.status === 'stale' || !draft.dirty;
  const generalIssue = draft.issues.__general;

  const containerClass =
    variant === 'dock'
      ? 'flex flex-col h-full w-[320px] shrink-0 border-l border-control-border bg-panel'
      : variant === 'hosted'
        ? 'flex flex-col w-full h-full min-h-0 bg-panel'
        : 'flex flex-col w-full h-full bg-panel';
  const hosted = variant === 'hosted';

  return (
    <div
      data-testid="inspector-panel"
      data-variant={variant}
      role="complementary"
      aria-label="Inspector"
      className={containerClass}
    >
      {/* Header */}
      <div className={cn('flex items-start justify-between gap-2 px-4 pt-4 pb-3 border-b border-divider', hosted && 'bg-background')}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink truncate" data-testid="inspector-title">
            {draft.multi ? draft.label : draft.label || 'Untitled'}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {!draft.multi && draft.kindTag ? (
              <span
                data-testid="inspector-kind-tag"
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded-tag border text-[10px] font-mono font-medium tracking-wide',
                  draft.notSimulated || !draft.stripeColor
                    ? 'border-control-border text-secondary-text bg-sunken'
                    : '',
                )}
                style={(!draft.notSimulated && draft.stripeColor) ? {
                  backgroundColor: computeTagColors(draft.stripeColor).backgroundColor,
                  borderColor: computeTagColors(draft.stripeColor).borderColor,
                  color: 'var(--foreground)',
                } : undefined}
              >
                {draft.kindTag}
              </span>
            ) : null}
          </div>
        </div>
        {hosted ? null : <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="inspector-close"
          aria-label="Close inspector"
          onClick={onClose}
          // The shadcn Button (ghost/icon) is used instead of a bare <button> because it is
          // the component every other icon-only control in the shell renders through; a bare
          // <button> left the lucide <X> invisible (no guaranteed foreground colour / svg
          // sizing). size="icon" gives a 32px hit area (44px on touch, via pointer-coarse).
          className="shrink-0"
        >
          <X aria-hidden="true" />
        </Button>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {draft.multi ? (
          <div className="px-4 py-6 text-xs text-secondary-text" data-testid="inspector-multi-selection">
            {draft.count} selected. Multi-selection editing isn't available yet.
          </div>
        ) : draft.missing ? (
          <div className="px-4 py-6 text-xs text-risk-text" data-testid="inspector-missing">
            This item was deleted elsewhere. Discard to close, or keep your text and try again.
          </div>
        ) : (
          <>
            {/* CONFIGURATION */}
            <section className="px-4 py-3" aria-label="Configuration">
              <h3 className="text-micro font-mono font-medium text-secondary-text mb-2.5">
                Configuration
              </h3>
              <div className="flex flex-col gap-3">
                {draft.fields.map((field, index) => (
                  <React.Fragment key={field.id}>
                    {field.group && field.group !== draft.fields[index - 1]?.group ? (
                      <h4
                        data-testid="inspector-field-group"
                        className="mt-2 border-t border-divider pt-3 text-[11px] font-mono font-medium text-secondary-text"
                      >
                        {field.group}
                      </h4>
                    ) : null}
                    <FieldRow
                      field={field}
                      value={draft.values[field.id] ?? ''}
                      error={draft.issues[field.id] ?? null}
                      onChange={(raw) => onChangeField(field.id, raw)}
                      registerRef={registerRef(field.id)}
                    />
                  </React.Fragment>
                ))}
              </div>
              {generalIssue ? (
                <p role="alert" className="mt-3 text-xs text-risk-text" data-testid="inspector-general-issue">
                  {generalIssue}
                </p>
              ) : null}
              {draft.status === 'stale' ? <StaleNotice /> : null}
            </section>

            {/* MEASURED · LAST RUN (elements only) */}
            {measured ? (
            <section className="px-4 py-3 border-t border-divider" aria-label="Measured, last run" data-testid="inspector-measured">
              <h3 className="text-micro font-mono font-medium text-secondary-text mb-2.5">
                Measured · Last run
              </h3>
              {measured.emptyMessage ? (
                <p className="text-xs text-secondary-text" data-testid="inspector-measured-empty">
                  {measured.emptyMessage}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {measured.rows.map((row) => (
                    <div
                      key={row.key}
                      data-testid={`inspector-metric-${row.key}`}
                      className="rounded-control border border-control-border bg-sunken px-2.5 py-2"
                    >
                      <div className="text-[10px] font-mono tracking-wide text-secondary-text">
                        {row.label}
                      </div>
                      <div
                        className={cn(
                          'text-sm font-semibold mt-0.5',
                          row.available ? 'text-ink' : 'text-secondary-text',
                        )}
                      >
                        {row.valueText}
                      </div>
                      {!row.available && row.reason ? (
                        <div className="text-[10px] text-secondary-text mt-0.5">{row.reason}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
            ) : null}
          </>
        )}
      </div>

      {/* Footer */}
      {!draft.multi ? (
        <div className={cn('flex items-center gap-2 px-4 py-3 border-t border-control-border', hosted && 'bg-background')}>
          <Button
            type="button"
            data-testid="inspector-apply"
            onClick={onApply}
            disabled={applyDisabled}
            className="flex-1"
          >
            {saving ? 'Applying…' : 'Apply'}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="inspector-cancel"
            onClick={onCancel}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StaleNotice() {
  return (
    <p role="alert" className="mt-3 text-xs text-risk-text" data-testid="inspector-stale-notice">
      This changed elsewhere. Reload to discard your edits, or keep editing and try again.
    </p>
  );
}

function FieldRow({
  field,
  value,
  error,
  onChange,
  registerRef,
}: {
  readonly field: FieldSpec;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (raw: string) => void;
  readonly registerRef: (el: HTMLElement | null) => void;
}) {
  const inputId = `inspector-field-${field.id}`;
  const errorId = `${inputId}-error`;

  if (field.kind === 'readonly') {
    return (
      <div data-testid={inputId}>
        <div className="text-[11px] text-secondary-text mb-0.5">{field.label}</div>
        <div className="text-xs text-body">{value}</div>
        {field.note ? <div className="text-[10px] text-secondary-text mt-0.5">{field.note}</div> : null}
      </div>
    );
  }

  const labelNode = (
    <label htmlFor={inputId} className="flex items-baseline justify-between text-[11px] text-secondary-text mb-1">
      <span>{field.label}</span>
      {field.unit ? <span className="text-secondary-text">{field.unit}</span> : null}
    </label>
  );

  const commonProps = {
    id: inputId,
    'data-testid': inputId,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(e.target.value),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    ref: registerRef as never,
  };

  return (
    <div>
      {labelNode}
      {field.kind === 'textarea' ? (
        <Textarea {...commonProps} rows={3} className={cn(error && 'border-risk-text')} />
      ) : field.kind === 'select' ? (
        <NativeSelect {...commonProps} className={cn(error && 'border-risk-text')}>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          {...commonProps}
          type="text"
          inputMode={field.kind === 'number' ? 'decimal' : 'text'}
          className={cn(error && 'border-risk-text')}
        />
      )}
      {error ? (
        <p id={errorId} data-testid={`${inputId}-error`} role="alert" className="mt-1 text-[11px] text-risk-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
