/**
 * "What goes in" section for timed scenarios: workloads (RV-05c).
 *
 * commands.md §4 "Editor sections": "timed: workloads with entry, rate and request
 * mix." Screen: scenario_traffic_editor.png.
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Document, KeyDistribution, RequestClass, Scenario, Workload } from '../../domain/studio/model';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Switch } from '../../components/ui/switch';
import { inboundEndpointOptions, endpointLabel } from './pickers';
import type { MintId } from './types';

const DEFAULT_KEY_DISTRIBUTION: KeyDistribution = { kind: 'uniform', catalogSize: 1, hotSubset: 1, hotShare: 0 };

function newRequestClass(mintId: MintId): RequestClass {
  return {
    id: mintId(),
    name: 'Requests',
    weight: 1,
    operation: 'read',
    tags: [],
    keyDistribution: DEFAULT_KEY_DISTRIBUTION,
  };
}

export interface TrafficSectionProps {
  readonly document: Document;
  readonly scenario: Scenario;
  readonly onChange: (patch: (s: Scenario) => Scenario) => void;
  readonly mintId: MintId;
}

export function TrafficSection({ document, scenario, onChange, mintId }: TrafficSectionProps) {
  const entryOptions = React.useMemo(() => inboundEndpointOptions(document), [document]);

  const addWorkload = () => {
    if (entryOptions.length === 0) return;
    const first = entryOptions[0];
    const workload: Workload = {
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
  };

  const updateWorkload = (id: string, patch: (w: Workload) => Workload) => {
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

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-secondary-text">Request mix</span>
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
                <div key={cls.id} className="flex items-center gap-1.5">
                  <Input
                    className="h-7 text-xs"
                    value={cls.name}
                    onChange={(e) =>
                      updateWorkload(workload.id, (w) => ({
                        ...w,
                        classes: w.classes.map((c) => (c.id === cls.id ? { ...c, name: e.target.value } : c)),
                      }))
                    }
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
                      updateWorkload(workload.id, (w) => ({
                        ...w,
                        classes: w.classes.map((c) => (c.id === cls.id ? { ...c, weight: Number.isFinite(value) ? value : c.weight } : c)),
                      }));
                    }}
                    aria-label="Class weight"
                  />
                  <NativeSelect
                    className="h-7 w-24 text-xs"
                    value={cls.operation}
                    onChange={(e) =>
                      updateWorkload(workload.id, (w) => ({
                        ...w,
                        classes: w.classes.map((c) =>
                          c.id === cls.id ? { ...c, operation: e.target.value === 'write' ? 'write' : 'read' } : c,
                        ),
                      }))
                    }
                    aria-label="Class operation"
                  >
                    <NativeSelectOption value="read">read</NativeSelectOption>
                    <NativeSelectOption value="write">write</NativeSelectOption>
                  </NativeSelect>
                  <button
                    type="button"
                    className="text-secondary-text hover:text-risk-text"
                    onClick={() =>
                      updateWorkload(workload.id, (w) => ({ ...w, classes: w.classes.filter((c) => c.id !== cls.id) }))
                    }
                    aria-label="Remove class"
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {scenario.workloads.length === 0 && (
          <p className="text-[11px] text-secondary-text">No traffic yet. Add traffic to send requests in.</p>
        )}
      </div>
    </section>
  );
}
