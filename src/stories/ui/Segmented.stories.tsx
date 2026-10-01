import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';

const meta: Meta<typeof Segmented> = {
  title: 'UI/Segmented',
  component: Segmented,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Segmented> = {
  render: () => {
    const [selected, setSelected] = React.useState('canvas');
    return (
      <Segmented
        options={[
          { id: 'canvas', label: 'Canvas' },
          { id: 'table', label: 'Table' },
          { id: 'topology', label: 'Topology' },
        ]}
        value={selected}
        onChange={setSelected}
      />
    );
  },
};

export const StringOptions: StoryObj<typeof Segmented> = {
  render: () => {
    const [period, setPeriod] = React.useState('1m');
    return (
      <Segmented
        options={['10s', '1m', '5m', '1h']}
        value={period}
        onChange={setPeriod}
      />
    );
  },
};

export const DisabledOption: StoryObj<typeof Segmented> = {
  render: () => {
    const [view, setView] = React.useState('live');
    return (
      <Segmented
        options={[
          { id: 'live', label: 'Live' },
          { id: 'compare', label: 'Compare (Diff)' },
          { id: 'replay', label: 'Replay (Pro)', disabled: true },
        ]}
        value={view}
        onChange={setView}
      />
    );
  },
};
