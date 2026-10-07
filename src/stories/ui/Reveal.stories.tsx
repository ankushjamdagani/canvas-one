import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { m } from 'motion/react';
import { MotionProvider } from '@/lib/motion/MotionProvider';
import { Reveal, RevealScope } from '@/components/ui/reveal';
import { Button } from '@/components/ui/button';

function Demo() {
  const [n, setN] = React.useState(0);
  return (
    <MotionProvider>
      <Button onClick={() => setN((v) => v + 1)}>Replay</Button>
      <m.div
        key={n}
        initial="hidden"
        animate="enter"
        variants={{ hidden: {}, enter: {}, exit: {} }}
        className="mt-6 flex flex-col gap-3"
      >
        <RevealScope contentCount={2}>
          <Reveal kind="chrome" className="text-micro text-secondary-text">Chrome rises after content</Reveal>
          <Reveal kind="content" index={0} className="font-display text-4xl">Content line one</Reveal>
          <Reveal kind="content" index={1} className="font-display text-4xl italic">Content line two</Reveal>
        </RevealScope>
      </m.div>
    </MotionProvider>
  );
}

const meta = { title: 'UI/Reveal', component: Demo, parameters: { layout: 'padded' } } satisfies Meta<typeof Demo>;
export default meta;
export const Playground: StoryObj<typeof meta> = {};
