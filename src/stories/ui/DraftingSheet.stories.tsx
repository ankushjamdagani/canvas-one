import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DraftingEmpty,
  DraftingHeading,
  DraftingMain,
  DraftingSheet,
} from "@/components/ui/drafting-sheet";
import { Button } from "@/components/ui/button";
import { LandingPage } from "@/features/entry/LandingPage";

const meta = {
  title: "UI/Drafting sheet",
  component: DraftingSheet,
  parameters: { layout: "fullscreen" },
  args: {
    page: "Projects",
    children: (
      <DraftingMain>
        <div className="flex flex-col gap-5">
          <DraftingHeading>
            Start a project <em>or pick up a sheet.</em>
          </DraftingHeading>
          <Button>Empty project</Button>
        </div>
        <section className="flex flex-1 flex-col">
          <DraftingEmpty>
            <p className="font-medium text-ink">No saved projects yet</p>
            <p>Start from a template, or open an empty canvas.</p>
          </DraftingEmpty>
        </section>
      </DraftingMain>
    ),
  },
} satisfies Meta<typeof DraftingSheet>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Projects: Story = {};
export const Landing: Story = { render: () => <LandingPage /> };
