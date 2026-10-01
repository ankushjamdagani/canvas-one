import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Plus, Trash2, Settings, ArrowRight } from 'lucide-react';

const meta: Meta = {
  title: 'Design System/State Matrix',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

export const InteractiveStatesMatrix: StoryObj = {
  name: 'Interactive Primitives State Matrix',
  render: () => (
    <div className="max-w-6xl space-y-10 py-4 font-sans text-ink">
      {/* Header */}
      <div className="space-y-2 border-b border-border pb-6">
        <div className="flex items-center gap-2">
          <Badge variant="accent">INTERACTION AUDIT</Badge>
          <Badge variant="neutral">SIDE-BY-SIDE STATES</Badge>
        </div>
        <h1 className="text-3xl font-serif font-bold text-ink">Component State Matrix</h1>
        <p className="text-sm text-body">
          Simultaneous side-by-side inspection of all interactive states (Default, Focus Ring, Disabled, Active) across foundation components to ensure visual harmony, focus visibility, and accessibility.
        </p>
      </div>

      {/* Button State Matrix */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          1. Buttons & Action Variants
        </h2>
        <div className="overflow-x-auto rounded-card border border-border bg-shell p-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-secondary-text font-mono text-[11px]">
                <th className="pb-3 pr-4">Variant</th>
                <th className="pb-3 px-4">Default</th>
                <th className="pb-3 px-4">With Icon</th>
                <th className="pb-3 px-4">Focus Ring (Keyboard)</th>
                <th className="pb-3 px-4">Disabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold">default (primary)</td>
                <td className="py-3 px-4"><Button variant="default">Confirm Action</Button></td>
                <td className="py-3 px-4"><Button variant="default"><Plus className="size-3.5 mr-1.5" />Add Item</Button></td>
                <td className="py-3 px-4"><Button variant="default" className="ring-2 ring-primary ring-offset-2 ring-offset-canvas">Focused</Button></td>
                <td className="py-3 px-4"><Button variant="default" disabled>Disabled</Button></td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold">secondary</td>
                <td className="py-3 px-4"><Button variant="secondary">Cancel</Button></td>
                <td className="py-3 px-4"><Button variant="secondary"><Settings className="size-3.5 mr-1.5" />Options</Button></td>
                <td className="py-3 px-4"><Button variant="secondary" className="ring-2 ring-primary ring-offset-2 ring-offset-canvas">Focused</Button></td>
                <td className="py-3 px-4"><Button variant="secondary" disabled>Disabled</Button></td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold">ghost</td>
                <td className="py-3 px-4"><Button variant="ghost">Clear</Button></td>
                <td className="py-3 px-4"><Button variant="ghost"><ArrowRight className="size-3.5 mr-1.5" />Details</Button></td>
                <td className="py-3 px-4"><Button variant="ghost" className="ring-2 ring-primary ring-offset-2 ring-offset-canvas">Focused</Button></td>
                <td className="py-3 px-4"><Button variant="ghost" disabled>Disabled</Button></td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold">destructive</td>
                <td className="py-3 px-4"><Button variant="destructive">Delete Node</Button></td>
                <td className="py-3 px-4"><Button variant="destructive"><Trash2 className="size-3.5 mr-1.5" />Delete</Button></td>
                <td className="py-3 px-4"><Button variant="destructive" className="ring-2 ring-destructive ring-offset-2 ring-offset-canvas">Focused</Button></td>
                <td className="py-3 px-4"><Button variant="destructive" disabled>Disabled</Button></td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold">outline</td>
                <td className="py-3 px-4"><Button variant="outline">Inspect</Button></td>
                <td className="py-3 px-4"><Button variant="outline"><Settings className="size-3.5 mr-1.5" />Configure</Button></td>
                <td className="py-3 px-4"><Button variant="outline" className="ring-2 ring-primary ring-offset-2 ring-offset-canvas">Focused</Button></td>
                <td className="py-3 px-4"><Button variant="outline" disabled>Disabled</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Input & Form State Matrix */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          2. Form Inputs & Text Fields
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-card border border-border bg-shell p-4 space-y-2">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold">Default / Empty</span>
            <Input placeholder="Enter model name..." />
          </div>

          <div className="rounded-card border border-border bg-shell p-4 space-y-2">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold">Filled State</span>
            <Input defaultValue="PaymentGatewayService" />
          </div>

          <div className="rounded-card border border-border bg-shell p-4 space-y-2">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold">Focused (Ring-2)</span>
            <Input defaultValue="checkout-cluster" className="ring-2 ring-primary ring-offset-1 border-primary" />
          </div>

          <div className="rounded-card border border-border bg-shell p-4 space-y-2">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold">Disabled</span>
            <Input defaultValue="system-managed-id" disabled />
          </div>
        </div>
      </div>

      {/* Toggles, Checkboxes & Switches */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          3. Selection & Boolean Controls
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-card border border-border bg-shell p-4 space-y-3">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold block">Checkbox States</span>
            <div className="space-y-2.5">
              <label className="flex items-center gap-2.5 text-xs text-ink cursor-pointer">
                <Checkbox id="c1" />
                <span>Unchecked default</span>
              </label>
              <label className="flex items-center gap-2.5 text-xs text-ink cursor-pointer">
                <Checkbox id="c2" defaultChecked />
                <span>Checked active</span>
              </label>
              <label className="flex items-center gap-2.5 text-xs text-body opacity-50 cursor-not-allowed">
                <Checkbox id="c3" disabled defaultChecked />
                <span>Checked disabled</span>
              </label>
            </div>
          </div>

          <div className="rounded-card border border-border bg-shell p-4 space-y-3">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold block">Switch States</span>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span>Enable Realism Engine</span>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>Verbose Log Telemetry</span>
                <Switch />
              </div>
              <div className="flex items-center justify-between text-xs text-body opacity-50">
                <span>Immutable Snapshot</span>
                <Switch disabled defaultChecked />
              </div>
            </div>
          </div>

          <div className="rounded-card border border-border bg-shell p-4 space-y-3">
            <span className="text-[11px] font-mono text-secondary-text uppercase font-semibold block">Segmented Controls</span>
            <div className="space-y-3">
              <Segmented value="Design" options={['Design', 'Simulate', 'Inspect']} onChange={() => {}} />
              <Segmented value="P99" options={['P50', 'P95', 'P99']} onChange={() => {}} />
            </div>
          </div>
        </div>
      </div>

      {/* Sliders & Continuous Controls */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          4. Continuous Sliders
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-card border border-border bg-shell p-5 space-y-3">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Traffic Rate (req/sec)</span>
              <span className="font-mono text-primary font-bold">2,500 RPS</span>
            </div>
            <Slider defaultValue={[50]} max={100} step={1} />
          </div>

          <div className="rounded-card border border-border bg-shell p-5 space-y-3 opacity-60">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Service Latency Threshold (Disabled)</span>
              <span className="font-mono text-secondary-text">150 ms</span>
            </div>
            <Slider defaultValue={[30]} max={100} step={1} disabled />
          </div>
        </div>
      </div>
    </div>
  ),
};
