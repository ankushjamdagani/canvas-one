/**
 * "What happens during the run" section for timed scenarios: faults (RV-05c).
 *
 * commands.md §4 "Editor sections": "timed only: faults." model-and-runner.md §6:
 * `Fault={id,hostId,downAtMs,upAtMs,detectionDelayMs,recoveryDetectionDelayMs,
 * activePolicy:'fail',queuedPolicy:'reject',routeReset:'first-healthy'}` -- the last
 * three are fixed literals (the only legal values), so the editor only exposes host,
 * timing and detection delays. Screen: scenario_traffic_editor.png ("Payment host goes
 * down ... down 5.0s -> up 12.0s ... noticed after 0.5s").
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Document, Fault } from '../../domain/studio/model';
import type { DraftScenario } from './draftScenario';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { hostElementOptions } from './pickers';
import type { MintId } from './types';

export interface FaultsSectionProps {
  readonly document: Document;
  readonly scenario: DraftScenario;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
  readonly mintId: MintId;
}

export function FaultsSection({ document, scenario, onChange, mintId }: FaultsSectionProps) {
  const hosts = React.useMemo(() => hostElementOptions(document), [document]);

  const addFault = () => {
    if (hosts.length === 0) return;
    const fault: Fault = {
      id: mintId(),
      hostId: hosts[0].elementId,
      downAtMs: 0,
      upAtMs: 1000,
      detectionDelayMs: 0,
      recoveryDetectionDelayMs: 0,
      activePolicy: 'fail',
      queuedPolicy: 'reject',
      routeReset: 'first-healthy',
    };
    onChange((s) => ({ ...s, faults: [...s.faults, fault] }));
  };

  const updateFault = (id: string, patch: (f: Fault) => Fault) => {
    onChange((s) => ({ ...s, faults: s.faults.map((f) => (f.id === id ? patch(f) : f)) }));
  };

  const removeFault = (id: string) => {
    onChange((s) => ({ ...s, faults: s.faults.filter((f) => f.id !== id) }));
  };

  return (
    <section data-testid="scenario-section-faults" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">
            What happens during the run
          </div>
          <div className="text-[11px] text-secondary-text">Optional outages.</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addFault} disabled={hosts.length === 0}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add outage
        </Button>
      </div>

      {hosts.length === 0 && <p className="text-[11px] text-secondary-text">No host elements in this document.</p>}

      <div className="space-y-2">
        {scenario.faults.map((fault) => {
          const host = document.elements.find((e) => e.id === fault.hostId);
          return (
            <div
              key={fault.id}
              data-testid={`fault-row-${fault.id}`}
              className="rounded-control border border-control-border bg-panel p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <NativeSelect
                  className="h-7 text-xs font-semibold w-auto"
                  value={fault.hostId}
                  onChange={(e) => updateFault(fault.id, (f) => ({ ...f, hostId: e.target.value }))}
                  aria-label="Host"
                >
                  {hosts.map((h) => (
                    <NativeSelectOption key={h.elementId} value={h.elementId}>
                      {h.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <button
                  type="button"
                  className="text-secondary-text hover:text-risk-text"
                  onClick={() => removeFault(fault.id)}
                  aria-label="Remove outage"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              {!host && <p className="text-[11px] text-risk-text">Host element deleted.</p>}

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Down at (ms)
                  <Input
                    type="number"
                    min={0}
                    value={fault.downAtMs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateFault(fault.id, (f) => ({ ...f, downAtMs: Number.isFinite(v) ? v : f.downAtMs }));
                    }}
                  />
                </label>
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Up at (ms)
                  <Input
                    type="number"
                    min={0}
                    value={fault.upAtMs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateFault(fault.id, (f) => ({ ...f, upAtMs: Number.isFinite(v) ? v : f.upAtMs }));
                    }}
                  />
                </label>
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Detected after (ms)
                  <Input
                    type="number"
                    min={0}
                    max={600000}
                    value={fault.detectionDelayMs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateFault(fault.id, (f) => ({ ...f, detectionDelayMs: Number.isFinite(v) ? v : f.detectionDelayMs }));
                    }}
                  />
                </label>
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Recovery detected after (ms)
                  <Input
                    type="number"
                    min={0}
                    max={600000}
                    value={fault.recoveryDetectionDelayMs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateFault(fault.id, (f) => ({
                        ...f,
                        recoveryDetectionDelayMs: Number.isFinite(v) ? v : f.recoveryDetectionDelayMs,
                      }));
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}

        {scenario.faults.length === 0 && (
          <p className="text-[11px] text-secondary-text">No outages. The run assumes every host stays up.</p>
        )}
      </div>
    </section>
  );
}
