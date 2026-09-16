import React from 'react';
import type { WorkloadDefinition, RequestClass } from '../domain/execution';
import { defaultWorkload } from '../domain/behaviorDefaults';
import { NumberField } from './NumberField';
import { useEditor } from '../state/editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function OpenWorkloadControls({
  workloads,
  filterNodeId,
  readOnly,
}: {
  workloads: WorkloadDefinition[];
  filterNodeId?: string;
  readOnly: boolean;
}) {
  const editor = useEditor();
  const graph = editor.project.graph;
  const nodes = graph.nodes;
  const duration = graph.settings.duration;

  const displayedWorkloads = filterNodeId
    ? workloads.filter((w) => w.entryNodeId === filterNodeId)
    : workloads;

  const handleAddWorkload = () => {
    if (readOnly || (graph.workloads?.length ?? 0) >= 20) return;
    const entryId = filterNodeId || nodes[0]?.id;
    if (!entryId) return;
    const newWl = defaultWorkload(entryId);
    const targetNode = nodes.find((n) => n.id === entryId);
    if (targetNode?.kind === 'scheduler') {
      newWl.intervalMs = 1000;
    }
    editor.change((g) => {
      (g.workloads ??= []).push(newWl);
    });
  };

  return (
    <div className="open-inspector-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="open-inspector-section-title">
          {filterNodeId ? 'Attached Workloads' : 'All Workloads'} ({displayedWorkloads.length})
        </span>
        {!readOnly && (graph.workloads?.length ?? 0) < 20 && nodes.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleAddWorkload}
          >
            + Add Workload
          </Button>
        )}
      </div>

      {displayedWorkloads.length === 0 ? (
        <p className="open-inspector-help-text">No workloads defined.</p>
      ) : (
        displayedWorkloads.map((wl, idx) => {
          const entryNode = nodes.find((n) => n.id === wl.entryNodeId);
          const entryName = entryNode ? entryNode.name : 'Unknown Node';
          const isPoisson = wl.intervalMs === undefined;

          const arrivalSummary = isPoisson
            ? wl.profile?.kind === 'burst'
              ? `Burst: ${wl.rate} → ${wl.profile.peakRate} req/s`
              : wl.profile?.kind === 'ramp'
                ? `Ramp: ${wl.rate} → ${wl.profile.endRate} req/s`
                : `${wl.rate} req/s steady`
            : `Every ${wl.intervalMs ?? 1000}ms fixed`;

          return (
            <details key={wl.id} className="open-workload-card" open>
              <summary>
                <div className="open-workload-summary-inner">
                  <div className="open-workload-title-row">
                    <span className="open-workload-chevron" aria-hidden="true">▶</span>
                    <span className="open-workload-title">
                      Workload {idx + 1}: {entryName}
                    </span>
                  </div>
                  <div className="open-workload-summary-meta">
                    <Badge
                      variant={wl.enabled ? 'secondary' : 'outline'}
                      className={`open-workload-badge text-[10px] px-1.5 py-0 ${
                        wl.enabled
                          ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {wl.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <span className="open-workload-arrival-text">{arrivalSummary}</span>
                  </div>
                </div>
              </summary>

              <div className="open-workload-fields">
                <div className="open-workload-header">
                  <span className="open-workload-title" style={{ fontSize: '11px', color: '#677773' }}>
                    Parameters & Settings
                  </span>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => editor.removeWorkload(wl.id)}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={wl.enabled}
                    disabled={readOnly}
                    onChange={(e) => editor.updateWorkload(wl.id, { enabled: e.target.checked })}
                  />
                  <span>Enabled</span>
                </label>

                {!filterNodeId && (
                  <label className="field">
                    <span>Entry Node</span>
                    <select
                      value={wl.entryNodeId}
                      disabled={readOnly}
                      onChange={(e) => editor.updateWorkload(wl.id, { entryNodeId: e.target.value })}
                    >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {isPoisson && <NumberField
                label="Target Rate"
                unit="req/s"
                value={wl.rate}
                min={1}
                max={10000}
                onChange={(val) => editor.updateWorkload(wl.id, { rate: val })}
              />}

              <NumberField
                label="Timeout"
                unit="ms"
                value={wl.timeoutMs}
                min={1}
                max={3600000}
                onChange={(val) => editor.updateWorkload(wl.id, { timeoutMs: val })}
              />

              <label className="field">
                <span>Arrival Model</span>
                <select
                  value={isPoisson ? 'poisson' : 'fixed'}
                  disabled={readOnly}
                  onChange={(e) => {
                    if (e.target.value === 'poisson') {
                      editor.change((g) => {
                        const target = g.workloads?.find((w) => w.id === wl.id);
                        if (target) delete target.intervalMs;
                      });
                    } else {
                      editor.updateWorkload(wl.id, { intervalMs: 1000 });
                    }
                  }}
                >
                  <option value="poisson">Poisson Process (Variable interval)</option>
                  <option value="fixed">Fixed Periodic Interval</option>
                </select>
              </label>

              {!isPoisson && (
                <NumberField
                  label="Interval"
                  unit="ms"
                  value={wl.intervalMs ?? 1000}
                  min={1}
                  max={3600000}
                  onChange={(val) => editor.updateWorkload(wl.id, { intervalMs: val })}
                />
              )}

              {isPoisson && <label className="field">
                <span>Traffic Profile</span>
                <select
                  value={wl.profile?.kind ?? 'steady'}
                  disabled={readOnly}
                  onChange={(e) => {
                    const kind = e.target.value as 'steady' | 'burst' | 'ramp';
                    if (kind === 'steady') {
                      editor.updateWorkload(wl.id, { profile: { kind: 'steady' } });
                    } else if (kind === 'ramp') {
                      editor.updateWorkload(wl.id, { profile: { kind: 'ramp', endRate: 200 } });
                    } else if (kind === 'burst') {
                      const start = Math.max(0, Math.min(5, duration - 2));
                      const end = Math.min(duration, start + 5);
                      editor.updateWorkload(wl.id, {
                        profile: { kind: 'burst', peakRate: Math.min(10000, wl.rate * 2), start, end },
                      });
                    }
                  }}
                >
                  <option value="steady">Steady</option>
                  <option value="burst">Burst</option>
                  <option value="ramp">Ramp</option>
                </select>
              </label>}

              {isPoisson && wl.profile?.kind === 'ramp' && (
                <NumberField
                  label="End Rate"
                  unit="req/s"
                  value={wl.profile.endRate}
                  min={1}
                  max={10000}
                  onChange={(val) => {
                    if (wl.profile?.kind === 'ramp') {
                      editor.updateWorkload(wl.id, {
                        profile: { ...wl.profile, endRate: val },
                      });
                    }
                  }}
                />
              )}

              {isPoisson && wl.profile?.kind === 'burst' && (
                <>
                  <NumberField
                    label="Burst Peak Rate"
                    unit="req/s"
                    value={wl.profile.peakRate}
                    min={1}
                    max={10000}
                    onChange={(val) => {
                      if (wl.profile?.kind === 'burst') {
                        editor.updateWorkload(wl.id, {
                          profile: { ...wl.profile, peakRate: val },
                        });
                      }
                    }}
                  />
                  <NumberField
                    label="Burst Start"
                    unit="s"
                    value={wl.profile.start}
                    min={0}
                    max={Math.max(0, wl.profile.end - 0.1)}
                    step={0.1}
                    onChange={(val) => {
                      if (wl.profile?.kind === 'burst') {
                        const start = Math.min(val, wl.profile.end - 0.1);
                        editor.updateWorkload(wl.id, {
                          profile: { ...wl.profile, start: Math.max(0, start) },
                        });
                      }
                    }}
                  />
                  <NumberField
                    label="Burst End"
                    unit="s"
                    value={wl.profile.end}
                    min={wl.profile.start + 0.1}
                    max={duration}
                    step={0.1}
                    onChange={(val) => {
                      if (wl.profile?.kind === 'burst') {
                        const end = Math.min(duration, Math.max(wl.profile.start + 0.1, val));
                        editor.updateWorkload(wl.id, {
                          profile: { ...wl.profile, end },
                        });
                      }
                    }}
                  />
                </>
              )}

              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="open-inspector-section-title" style={{ fontSize: '11px' }}>
                    Request Classes ({wl.classes.length}/20)
                  </span>
                  {!readOnly && wl.classes.length < 20 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        const newClass: RequestClass = {
                          id: crypto.randomUUID(),
                          name: `class-${wl.classes.length + 1}`,
                          weight: 1,
                          operation: 'read',
                          tags: [],
                          keyDistribution: {
                            kind: 'uniform',
                            catalogSize: 1000,
                            hotSubset: 10,
                            hotShare: 80,
                          },
                        };
                        editor.updateWorkload(wl.id, {
                          classes: [...wl.classes, newClass],
                        });
                      }}
                    >
                      + Class
                    </Button>
                  )}
                </div>

                {wl.classes.map((cls, cIdx) => (
                  <div key={cls.id} className="open-class-card">
                    <div className="open-class-header">
                      <span>Class {cIdx + 1}: {cls.name}</span>
                      {!readOnly && wl.classes.length > 1 && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-5 px-1.5 text-xs"
                          onClick={() => {
                            editor.updateWorkload(wl.id, {
                              classes: wl.classes.filter((c) => c.id !== cls.id),
                            });
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>

                    <label className="field">
                      <span>Name</span>
                      <Input
                        type="text"
                        maxLength={80}
                        value={cls.name}
                        disabled={readOnly}
                        className="h-8 text-xs"
                        onChange={(e) => {
                          const updated = wl.classes.map((c) =>
                            c.id === cls.id ? { ...c, name: e.target.value.slice(0, 80) } : c
                          );
                          editor.updateWorkload(wl.id, { classes: updated });
                        }}
                      />
                    </label>

                    <NumberField
                      label="Weight"
                      value={cls.weight}
                      min={0.01}
                      max={10000}
                      step={0.1}
                      onChange={(val) => {
                        const updated = wl.classes.map((c) =>
                          c.id === cls.id ? { ...c, weight: Math.max(0.01, val) } : c
                        );
                        editor.updateWorkload(wl.id, { classes: updated });
                      }}
                    />

                    <label className="field">
                      <span>Operation</span>
                      <select
                        value={cls.operation}
                        disabled={readOnly}
                        onChange={(e) => {
                          const op = e.target.value as 'read' | 'write';
                          const updated = wl.classes.map((c) =>
                            c.id === cls.id ? { ...c, operation: op } : c
                          );
                          editor.updateWorkload(wl.id, { classes: updated });
                        }}
                      >
                        <option value="read">Read</option>
                        <option value="write">Write</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Tags (comma-separated, max 20)</span>
                      <Input
                        type="text"
                        key={`${cls.id}:${JSON.stringify(cls.tags)}`}
                        defaultValue={cls.tags.join(', ')}
                        disabled={readOnly}
                        className="h-8 text-xs"
                        onBlur={(e) => {
                          const tags = e.target.value
                            .split(',')
                            .map((t) => t.trim().slice(0, 80))
                            .filter(Boolean)
                            .slice(0, 20);
                          const updated = wl.classes.map((c) =>
                            c.id === cls.id ? { ...c, tags } : c
                          );
                          editor.updateWorkload(wl.id, { classes: updated });
                        }}
                      />
                    </label>

                    <label className="field">
                      <span>Key Popularity</span>
                      <select
                        value={cls.keyDistribution.kind}
                        disabled={readOnly}
                        onChange={(e) => {
                          const kind = e.target.value as 'uniform' | 'hot';
                          const updated = wl.classes.map((c) =>
                            c.id === cls.id
                              ? {
                                  ...c,
                                  keyDistribution: { ...c.keyDistribution, kind },
                                }
                              : c
                          );
                          editor.updateWorkload(wl.id, { classes: updated });
                        }}
                      >
                        <option value="uniform">Uniform</option>
                        <option value="hot">Hot subset</option>
                      </select>
                    </label>

                    <NumberField
                      label="Key Catalog Size"
                      value={cls.keyDistribution.catalogSize}
                      min={1}
                      max={100000}
                      onChange={(val) => {
                        const updated = wl.classes.map((c) =>
                          c.id === cls.id
                            ? {
                                ...c,
                                keyDistribution: {
                                  ...c.keyDistribution,
                                  catalogSize: val,
                                  hotSubset: Math.min(c.keyDistribution.hotSubset, val),
                                },
                              }
                            : c
                        );
                        editor.updateWorkload(wl.id, { classes: updated });
                      }}
                    />

                    {cls.keyDistribution.kind === 'hot' && (
                      <>
                        <NumberField
                          label="Hot Key Subset"
                          value={cls.keyDistribution.hotSubset}
                          min={1}
                          max={cls.keyDistribution.catalogSize}
                          onChange={(val) => {
                            const updated = wl.classes.map((c) =>
                              c.id === cls.id
                                ? {
                                    ...c,
                                    keyDistribution: {
                                      ...c.keyDistribution,
                                      hotSubset: Math.min(c.keyDistribution.catalogSize, Math.max(1, val)),
                                    },
                                  }
                                : c
                            );
                            editor.updateWorkload(wl.id, { classes: updated });
                          }}
                        />
                        <NumberField
                          label="Hot Key Traffic Share"
                          unit="%"
                          value={cls.keyDistribution.hotShare}
                          min={0}
                          max={100}
                          onChange={(val) => {
                            const updated = wl.classes.map((c) =>
                              c.id === cls.id
                                ? {
                                    ...c,
                                    keyDistribution: { ...c.keyDistribution, hotShare: val },
                                  }
                                : c
                            );
                            editor.updateWorkload(wl.id, { classes: updated });
                          }}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </details>
        );
      })
      )}
    </div>
  );
}
