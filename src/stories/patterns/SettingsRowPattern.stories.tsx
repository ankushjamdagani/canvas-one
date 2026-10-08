import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/ui/native-select';
import { Stepper } from '@/components/ui/stepper';
import { Badge } from '@/components/ui/badge';

const meta: Meta = {
  title: 'Patterns/Settings & Property Rows',
  parameters: {
    layout: 'centered',
  },
};

export default meta;

export const InspectorSettingsRecipe: StoryObj = {
  name: 'Properties Inspector Panel',
  render: () => {
    const [threads, setThreads] = React.useState(16);

    return (
      <Card className="w-[420px] bg-panel border-border shadow-raised">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Node Runtime Properties</CardTitle>
            <Badge variant="accent">NODE-04</Badge>
          </div>
          <CardDescription className="text-xs">
            Configure discrete latency distribution and boundary retries.
          </CardDescription>
        </CardHeader>

        <CardContent className="divide-y divide-hairline p-0">
          {/* Row 1: Switch Toggle */}
          <div className="flex items-center justify-between p-4 gap-4">
            <div className="space-y-0.5">
              <label htmlFor="switch-traffic" className="text-xs font-semibold text-ink cursor-pointer">
                Lognormal Heavy Tail
              </label>
              <p className="text-[11px] text-secondary-text">
                Inject realistic asymmetric network latency jitter.
              </p>
            </div>
            <Switch id="switch-traffic" defaultChecked />
          </div>

          {/* Row 2: Select Option */}
          <div className="flex items-center justify-between p-4 gap-4">
            <div className="space-y-0.5">
              <label htmlFor="select-runner" className="text-xs font-semibold text-ink cursor-pointer">
                Execution Model
              </label>
              <p className="text-[11px] text-secondary-text">
                Simulation kernel evaluation mode.
              </p>
            </div>
            <NativeSelect id="select-runner" defaultValue="studio-runner-5" className="w-36 text-xs">
              <option value="studio-runner-5">Runner / 5</option>
              <option value="studio-runner-4">Runner / 4</option>
              <option value="studio-runner-2">Runner / 2</option>
            </NativeSelect>
          </div>

          {/* Row 3: Numeric Stepper */}
          <div className="flex items-center justify-between p-4 gap-4">
            <div className="space-y-0.5">
              <label className="text-xs font-semibold text-ink">
                Max Concurrent Threads
              </label>
              <p className="text-[11px] text-secondary-text">
                Worker pool processing capacity.
              </p>
            </div>
            <Stepper
              value={threads}
              min={1}
              max={128}
              step={4}
              onChange={setThreads}
            />
          </div>

          {/* Row 4: Switch Toggle */}
          <div className="flex items-center justify-between p-4 gap-4">
            <div className="space-y-0.5">
              <label htmlFor="switch-redelivery" className="text-xs font-semibold text-ink cursor-pointer">
                Broker Redelivery
              </label>
              <p className="text-[11px] text-secondary-text">
                Requeue unacknowledged packets upon worker crash.
              </p>
            </div>
            <Switch id="switch-redelivery" />
          </div>
        </CardContent>
      </Card>
    );
  },
};
