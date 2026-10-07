import type { Meta, StoryObj } from "@storybook/react-vite";
import { DraftingSheet } from "@/components/ui/drafting-sheet";
import { Button } from "@/components/ui/button";
import { LandingPage } from "@/features/entry/LandingPage";

const meta = {
  title: "UI/Drafting sheet",
  component: DraftingSheet,
  parameters: { layout: "fullscreen" },
  args: {
    page: "Projects",
    children: (
      <main className="projects-main">
        <div className="projects-intro">
          <h1 className="projects-heading">
            Start a project <em>or pick up a sheet.</em>
          </h1>
          <Button>Empty project</Button>
        </div>
        <section className="projects-list">
          <div className="projects-empty">
            <p className="font-medium text-ink">No saved projects yet</p>
            <p>Start from a template, or open an empty canvas.</p>
          </div>
        </section>
      </main>
    ),
  },
} satisfies Meta<typeof DraftingSheet>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Projects: Story = {};
export const Landing: Story = { render: () => <LandingPage /> };
