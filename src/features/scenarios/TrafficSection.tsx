/**
 * "What goes in" section for timed scenarios: workloads (RV-05c).
 *
 * commands.md §4 "Editor sections": "timed: workloads with entry, rate and request
 * mix." Screen: scenario_traffic_editor.png.
 *
 * Review round: a new request class's `keyDistribution` starts fully unset (no
 * uniform/catalogSize-1 default) -- model-and-runner.md §6 Workloads: `keyDistribution`
 * is a required, always-present object on every `RequestClass` regardless of `kind`
 * (`src/domain/studio/validate.ts`'s `validateRequestClass` checks all four fields
 * unconditionally). Apply is blocked (draft.ts's `draftCompletenessIssues`) until the
 * user has explicitly chosen `kind` and typed `catalogSize`/`hotSubset`/`hotShare`.
 * `tags` starts as a real, valid empty list (not a placeholder) and is shown as an
 * editable list.
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Document, Workload } from '../../domain/studio/model';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Switch } from '../../components/ui/switch';
import { inboundEndpointOptions, endpointLabel } from './pickers';
import { UNSET_KEY_DISTRIBUTION, type DraftRequestClass, type DraftScenario, type DraftWorkload } from './draftScenario';
import type { ScenarioIssue } from './types';
import { summarizeWorkloadMix } from './summaries';
import { CompactRow } from './CompactRow';
import type { MintId } from './types';

function newRequestClass(mintId: MintId): DraftRequestClass {
  return {
    id: mintId(),
    name: 'Requests',
    weight: 1,
    operation: 'read',
    tags: [],
    keyDistribution: UNSET_KEY_DISTRIBUTION,
  };
}

export interface TrafficSectionProps {
  readonly issues?: readonly ScenarioIssue[];
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
  readonly mintId: MintId;
}

export function TrafficSection({ document, scenario, onChange, mintId, issues = [] }: TrafficSectionProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const entryOptions = React.useMemo(() => inboundEndpointOptions(document), [document]);

  const addWorkload = () => {
    if (entryOptions.length === 0) return;
    const first = entryOptions[0];
    const workload: DraftWorkload = {
      id: mintId(),
      entry: { elementId: first.elementId, portId: first.portId },
      enabled: true,
      rate: 1,
      profile: { kind: 'steady' },
      timeoutMs: 30000,
      intervalMs: null,
      classes: [],
    };
    onChange((s) => ({ ...s, workloads: [...s.workloads, workload] }));
    setExpandedId(workload.id);
  };

  const updateWorkload = (id: string, patch: (w: DraftWorkload) => DraftWorkload) => {
    onChange((s) => ({ ...s, workloads: s.workloads.map((w) => (w.id === id ? patch(w) : w)) }));
  };

  const removeWorkload = (id: string) => {
    onChange((s) => ({ ...s, workloads: s.workloads.filter((w) => w.id !== id) }));
  };

  return (
    <section data-testid="scenario-section-traffic" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">
            What goes in
          </div>
          <div className="text-[11px] text-secondary-text">Traffic sent into an entry point.</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addWorkload} disabled={entryOptions.length === 0}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add traffic
        </Button>
      </div>

      {entryOptions.length === 0 && (
        <p className="text-[11px] text-secondary-text">No inbound ports in this document yet.</p>
      )}

      <div className="space-y-2">
        {scenario.workloads.map((workload) => (
          <div
            key={workload.id}
            data-testid={`workload-row-${workload.id}`}
            className="rounded-control border border-control-border bg-panel p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                {endpointLabel(document, workload.entry)}
              </span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={workload.enabled}
                  onCheckedChange={(checked) => updateWorkload(workload.id, (w) => ({ ...w, enabled: checked }))}
                  aria-label={`Enable ${endpointLabel(document, workload.entry)} traffic`}
                />
                <button
                  type="button"
                  className="text-secondary-text hover:text-risk-text"
                  onClick={() => removeWorkload(workload.id)}
                  aria-label="Remove traffic"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] text-secondary-text">
                Enters at
                <NativeSelect
                  value={`${workload.entry.elementId}:${workload.entry.portId}`}
                  onChange={(e) => {
                    const [elementId, portId] = e.target.value.split(':');
                    updateWorkload(workload.id, (w) => ({ ...w, entry: { elementId, portId } }));
                  }}
                  aria-label="Entry point"
                >
                  {entryOptions.map((opt) => (
                    <NativeSelectOption key={`${opt.elementId}:${opt.portId}`} value={`${opt.elementId}:${opt.portId}`}>
                      {opt.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>

              <label className="space-y-1 text-[11px] text-secondary-text">
                Rate (req/s)
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={workload.rate}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    updateWorkload(workload.id, (w) => ({ ...w, rate: Number.isFinite(value) ? value : w.rate }));
                  }}
                  aria-label="Rate"
                />
              </label>
            </div>

            <CompactRow
              isExpanded={expandedId === workload.id}
              onToggle={() => setExpandedId(expandedId === workload.id ? null : workload.id)}
              issues={issues.filter(i => i.path?.[0] === 'workloads' && i.path?.[1] === scenario.workloads.findIndex(w => w.id === workload.id))}
              summary={
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-secondary-text">Request mix</span>
                  <span className="text-secondary-text">{summarizeWorkloadMix(workload.classes)}</span>
                </span>
              }
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Timeout (ms)
                    <Input
                      type="number"
                      min={0}
                      value={workload.timeoutMs}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        updateWorkload(workload.id, (w) => ({ ...w, timeoutMs: Number.isFinite(v) ? v : w.timeoutMs }));
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Interval (ms)
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={workload.intervalMs ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v = raw === '' ? null : Number(raw);
                        updateWorkload(workload.id, (w) => ({
                          ...w,
                          intervalMs: v,
                        }));
                      }}
                    />
                  </label>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-secondary-text">Classes</span>
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:text-primary-hover"
                      onClick={() => updateWorkload(workload.id, (w) => ({ ...w, classes: [...w.classes, newRequestClass(mintId)] }))}
                    >
                      + Add class
                    </button>
                  </div>
                  {workload.classes.length === 0 && (
                    <p className="text-[11px] text-secondary-text">One request class, undifferentiated traffic.</p>
                  )}
                  {workload.classes.map((cls) => (
                    <RequestClassRow
                      key={cls.id}
                      cls={cls}
                      onChange={(patch) =>
                        updateWorkload(workload.id, (w) => ({
                          ...w,
                          classes: w.classes.map((c) => (c.id === cls.id ? patch(c) : c)),
                        }))
                      }
                      onRemove={() =>
                        updateWorkload(workload.id, (w) => ({ ...w, classes: w.classes.filter((c) => c.id !== cls.id) }))
                      }
                    />
                  ))}
                </div>
              </div>
            </CompactRow>
          </div>
        ))}

        {scenario.workloads.length === 0 && (
          <p className="text-[11px] text-secondary-text">No traffic yet. Add traffic to send requests in.</p>
        )}
      </div>
    </section>
  );
}

function RequestClassRow({
  cls,
  onChange,
  onRemove,
}: {
  readonly cls: DraftRequestClass;
  readonly onChange: (patch: (c: DraftRequestClass) => DraftRequestClass) => void;
  readonly onRemove: () => void;
}) {
  const [newTag, setNewTag] = React.useState('');
  const kd = cls.keyDistribution;

  return (
    <div className="rounded-control border border-control-border/60 bg-background p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 text-xs"
          value={cls.name}
          onChange={(e) => onChange((c) => ({ ...c, name: e.target.value }))}
          aria-label="Class name"
        />
        <Input
          className="h-7 w-20 text-xs"
          type="number"
          min={0}
          step="any"
          value={cls.weight}
          onChange={(e) => {
            const value = Number(e.target.value);
            onChange((c) => ({ ...c, weight: Number.isFinite(value) ? value : c.weight }));
          }}
          aria-label="Class weight"
        />
        <NativeSelect
          className="h-7 w-24 text-xs"
          value={cls.operation}
          onChange={(e) => onChange((c) => ({ ...c, operation: e.target.value === 'write' ? 'write' : 'read' }))}
          aria-label="Class operation"
        >
          <NativeSelectOption value="read">read</NativeSelectOption>
          <NativeSelectOption value="write">write</NativeSelectOption>
        </NativeSelect>
        <button type="button" className="text-secondary-text hover:text-risk-text" onClick={onRemove} aria-label="Remove class">
          <Trash2 className="size-3" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5 items-end">
        <label className="space-y-0.5 text-[10px] text-secondary-text">
          Key distribution
          <NativeSelect
            className="h-7 text-xs"
            value={kd.kind ?? ''}
            onChange={(e) => {
              const kind = e.target.value === 'hot' ? 'hot' : e.target.value === 'uniform' ? 'uniform' : null;
              onChange((c) => ({ ...c, keyDistribution: { ...c.keyDistribution, kind } }));
            }}
            aria-label="Key distribution kind"
          >
            <NativeSelectOption value="">Choose…</NativeSelectOption>
            <NativeSelectOption value="uniform">Uniform</NativeSelectOption>
            <NativeSelectOption value="hot">Hot subset</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="space-y-0.5 text-[10px] text-secondary-text">
          Catalog size
          <Input
            className="h-7 text-xs"
            type="number"
            min={1}
            placeholder="—"
            value={kd.catalogSize ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const value = raw === '' ? null : Number(raw);
              onChange((c) => ({
                ...c,
                keyDistribution: { ...c.keyDistribution, catalogSize: value === null || Number.isFinite(value) ? value : c.keyDistribution.catalogSize },
              }));
            }}
            aria-label="Catalog size"
          />
        </label>
        <label className="space-y-0.5 text-[10px] text-secondary-text">
          Hot subset
          <Input
            className="h-7 text-xs"
            type="number"
            min={1}
            placeholder="—"
            value={kd.hotSubset ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const value = raw === '' ? null : Number(raw);
              onChange((c) => ({
                ...c,
                keyDistribution: { ...c.keyDistribution, hotSubset: value === null || Number.isFinite(value) ? value : c.keyDistribution.hotSubset },
              }));
            }}
            aria-label="Hot subset"
          />
        </label>
        <label className="space-y-0.5 text-[10px] text-secondary-text">
          Hot share (%)
          <Input
            className="h-7 text-xs"
            type="number"
            min={0}
            max={100}
            placeholder="—"
            value={kd.hotShare ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              const value = raw === '' ? null : Number(raw);
              onChange((c) => ({
                ...c,
                keyDistribution: { ...c.keyDistribution, hotShare: value === null || Number.isFinite(value) ? value : c.keyDistribution.hotShare },
              }));
            }}
            aria-label="Hot share"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {cls.tags.map((tag, i) => (
          <span key={`${tag}-${i}`} className="inline-flex items-center gap-1 rounded-tag bg-sunken px-1.5 py-0.5 text-[10px] text-body">
            {tag}
            <button
              type="button"
              onClick={() => onChange((c) => ({ ...c, tags: c.tags.filter((_, j) => j !== i) }))}
              aria-label={`Remove tag ${tag}`}
            >
              <Trash2 className="size-2.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Input
          className="h-6 w-24 text-[10px]"
          placeholder="Add tag"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newTag.trim() !== '') {
              e.preventDefault();
              onChange((c) => ({ ...c, tags: [...c.tags, newTag.trim()] }));
              setNewTag('');
            }
          }}
          aria-label="Add tag"
        />
      </div>
    </div>
  );
}
