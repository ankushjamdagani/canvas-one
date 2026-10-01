import type { Preview } from '@storybook/react-vite';
import * as React from 'react';
import '@fontsource-variable/inter';
import '@xyflow/react/dist/style.css';
import '../src/styles.css';
import { TooltipProvider } from '../src/components/ui/tooltip';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'canvas',
      values: [
        { name: 'canvas', value: '#FFFFFF' },
        { name: 'shell', value: '#FBFAF7' },
        { name: 'panel', value: '#F7F5F1' },
        { name: 'sunken', value: '#F2EFE9' },
      ],
    },
    a11y: {
      test: 'todo',
    },
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={200}>
        <div className="font-sans text-ink antialiased">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

export default preview;