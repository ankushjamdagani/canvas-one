import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/status-dot';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Card> = {
  render: () => (
    <Card className="w-[360px]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Worker Pool Cluster</CardTitle>
          <StatusDot status="live" label="Active" />
        </div>
        <CardDescription>Background job processor with FIFO queue subscription.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex justify-between py-1 border-b border-hairline">
          <span className="text-secondary-text">Concurrency</span>
          <span className="font-mono font-medium">16 workers</span>
        </div>
        <div className="flex justify-between py-1 border-b border-hairline">
          <span className="text-secondary-text">Throughput</span>
          <span className="font-mono font-medium">1,240 req/s</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-secondary-text">Error Budget</span>
          <span className="font-mono font-medium text-primary">99.98%</span>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between border-t border-hairline pt-3">
        <Badge variant="neutral">layer: compute</Badge>
        <Button size="sm" variant="outline">Inspect</Button>
      </CardFooter>
    </Card>
  ),
};
