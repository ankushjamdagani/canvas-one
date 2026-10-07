import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pause, Play } from "lucide-react";
import { DraftingBoard, DraftingStage } from "@/components/ui/drafting-board";
import { Button } from "@/components/ui/button";

const meta = {
  title: "UI/Drafting board",
  component: DraftingBoard,
  args: { children: null },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DraftingBoard>;
export default meta;
type Story = StoryObj<typeof meta>;

function LanguageSpecimen() {
  const [paused, setPaused] = useState(false);
  return (
    <DraftingBoard paused={paused}>
      <DraftingStage>
        <main
          style={{ position: "absolute", left: 80, top: 80, maxWidth: 720 }}
        >
          <h1 className="font-display text-5xl font-light">
            System Studio <em className="text-primary">drafting language</em>
          </h1>
          <p className="mt-6">
            IBM Plex Mono for interface labels, controls and prose.
          </p>
          <p className="font-mono mt-4">Martian Mono · 1,200 req/s · 42 ms</p>
          <p
            style={{ fontFamily: "var(--font-handwritten)", fontSize: 24 }}
            className="mt-6 text-secondary-text"
          >
            Caveat for handwritten annotations.
          </p>
          <Button className="mt-6" onClick={() => setPaused((value) => !value)}>
            {paused ? <Play /> : <Pause />}
            {paused ? "Resume background" : "Pause background"}
          </Button>
        </main>
      </DraftingStage>
    </DraftingBoard>
  );
}
export const Language: Story = { render: () => <LanguageSpecimen /> };
