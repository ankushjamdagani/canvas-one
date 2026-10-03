import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert, AlertTitle, AlertDescription, InlineAlert } from '@/components/ui/alert';
import { AlertCircle, AlertTriangle, Info, ShieldAlert } from 'lucide-react';

const meta: Meta<typeof Alert> = {
  title: 'UI/Alert',
  component: Alert,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'warning', 'destructive', 'info'],
    },
  },
};

export default meta;

export const DefaultAlert: StoryObj<typeof Alert> = {
  name: 'Standard Alert',
  render: () => (
    <div className="space-y-4 max-w-xl">
      <Alert variant="default">
        <Info className="size-4" />
        <AlertTitle>Simulation Quiescence Observed</AlertTitle>
        <AlertDescription>
          All 12,500 queued messages processed in 1.4 seconds with 0 message drops.
        </AlertDescription>
      </Alert>

      <Alert variant="warning">
        <AlertTriangle className="size-4" />
        <AlertTitle>Queue Capacity Warning</AlertTitle>
        <AlertDescription>
          Queue worker saturation reached 89% during the 3x burst window. Consider increasing worker pool size.
        </AlertDescription>
      </Alert>

      <Alert variant="destructive">
        <ShieldAlert className="size-4" />
        <AlertTitle>Database Connection Exhaustion</AlertTitle>
        <AlertDescription>
          Max connections (100) exceeded. 412 requests failed with retry budget depletion.
        </AlertDescription>
      </Alert>

      <Alert variant="info">
        <AlertCircle className="size-4" />
        <AlertTitle>Snapshot Available</AlertTitle>
        <AlertDescription>
          Baseline benchmark recorded for scenario S06 &quot;Checkout under traffic spike&quot;.
        </AlertDescription>
      </Alert>
    </div>
  ),
};

export const InlineAlerts: StoryObj = {
  name: 'Inline Alerts',
  render: () => (
    <div className="space-y-3 max-w-lg">
      <InlineAlert
        tone="risk"
        glyph="⚠"
        title="Router loop detected"
        detail="Requests routed from auth-svc to api-gw cycle back without terminating."
      />
      <InlineAlert
        tone="branch"
        glyph="⑂"
        title="Branch diverging from master"
        detail="3 commits ahead, 1 schema conflict in database-primary node."
      />
      <InlineAlert
        tone="done"
        glyph="✓"
        title="Readiness checks passed"
        detail="All 8 nodes and 11 edges have valid port contracts and deterministic delays."
      />
    </div>
  ),
};
