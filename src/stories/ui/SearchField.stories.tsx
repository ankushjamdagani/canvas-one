import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { SearchField } from '@/components/ui/search-field';

const meta: Meta<typeof SearchField> = {
  title: 'UI/SearchField',
  component: SearchField,
  tags: ['autodocs'],
  args: {
    placeholder: 'Search the component library...',
    shortcut: 'P',
    disabled: false,
  },
};

export default meta;

export const Default: StoryObj<typeof SearchField> = {
  render: (args) => {
    const [query, setQuery] = React.useState('');
    return (
      <div className="max-w-sm">
        <SearchField
          {...args}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
        />
        {query && (
          <p className="mt-2 text-xs text-secondary-text">Searching for: &quot;{query}&quot;</p>
        )}
      </div>
    );
  },
};

export const Disabled: StoryObj<typeof SearchField> = {
  render: () => (
    <div className="max-w-sm">
      <SearchField disabled placeholder="Search unavailable while running" />
    </div>
  ),
};
