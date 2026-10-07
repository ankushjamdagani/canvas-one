import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { Palette, Layers, ShieldCheck } from 'lucide-react';

const meta: Meta = {
  title: 'Design System/Overview',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

export const Introduction: StoryObj = {
  name: 'Introduction',
  render: () => (
    <div className="max-w-5xl space-y-10 py-4 font-sans text-ink">
      {/* Hero Header */}
      <div className="space-y-4 border-b border-border pb-8">
        <div className="flex items-center gap-2.5">
          <Badge variant="accent">SYSTEM STUDIO</Badge>
          <Badge variant="neutral">DESIGN SYSTEM V9</Badge>
          <StatusDot status="live" label="Evergreen Light Palette" />
        </div>
        <h1 className="text-4xl font-display font-bold text-ink sm:text-5xl">
          Evergreen Design System
        </h1>
        <p className="text-base text-body max-w-3xl leading-relaxed">
          The design language of System Studio: an editorial warm-paper canvas engineered for discrete-event simulation, distributed systems diagramming, and high-density performance telemetry.
        </p>
      </div>

      {/* Core Architectural Tenets */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          Architectural Tenets
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-shell border-control-border">
            <CardHeader className="pb-3">
              <div className="size-8 rounded-control bg-accent text-primary flex items-center justify-center mb-2">
                <Palette className="size-4" />
              </div>
              <CardTitle className="text-sm">Warm Paper Palette</CardTitle>
              <CardDescription className="text-xs">
                Warm #FBFAF7 shell and canvas, white controls, #F7F5F1 panels, and #F2EFE9 wells. Static #D3CDC1 editor dots preserve the 26px snap geometry.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-shell border-control-border">
            <CardHeader className="pb-3">
              <div className="size-8 rounded-control bg-selected-tint text-primary flex items-center justify-center mb-2">
                <ShieldCheck className="size-4" />
              </div>
              <CardTitle className="text-sm">WCAG 2.2 AA Contrast</CardTitle>
              <CardDescription className="text-xs">
                All foreground text exceeds 4.5:1 ratio against backgrounds (#16201D ink, #4A544F body, #626D68 secondary).
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-shell border-control-border">
            <CardHeader className="pb-3">
              <div className="size-8 rounded-control bg-branch-tint text-branch flex items-center justify-center mb-2">
                <Layers className="size-4" />
              </div>
              <CardTitle className="text-sm">6 System Layers</CardTitle>
              <CardDescription className="text-xs">
                Dedicated stripe colors for Clients, Gateways, Services, Brokers, Tasks, and Databases.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Component Library Statistics & Index */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          Component System Hierarchy
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-4 rounded-card border border-border bg-background space-y-1">
            <div className="text-2xl font-bold font-mono text-primary">38</div>
            <div className="text-xs font-semibold">Primitive UI Components</div>
            <p className="text-[11px] text-secondary-text">Buttons, inputs, dropdowns, dialogs, sliders, steppers, and badges.</p>
          </div>
          <div className="p-4 rounded-card border border-border bg-background space-y-1">
            <div className="text-2xl font-bold font-mono text-branch">6</div>
            <div className="text-xs font-semibold">System Layer Roles</div>
            <p className="text-[11px] text-secondary-text">Calibrated node kinds with accessible tag computing.</p>
          </div>
          <div className="p-4 rounded-card border border-border bg-background space-y-1">
            <div className="text-2xl font-bold font-mono text-risk-text">6</div>
            <div className="text-xs font-semibold">Elevation Shadows</div>
            <p className="text-[11px] text-secondary-text">From raised cards to floating dock and modal frame shadows.</p>
          </div>
          <div className="p-4 rounded-card border border-border bg-background space-y-1">
            <div className="text-2xl font-bold font-mono text-foreground">4</div>
            <div className="text-xs font-semibold">Font Families</div>
            <p className="text-[11px] text-secondary-text">IBM Plex Mono for UI, Martian Mono for measurements, Newsreader for headings, Caveat for annotations.</p>
          </div>
        </div>
      </div>

      {/* Directory Navigation Quick Links */}
      <div className="rounded-card border border-control-border bg-panel p-6 space-y-4">
        <h3 className="text-sm font-semibold">Exploring the Storybook</h3>
        <p className="text-xs text-body leading-relaxed max-w-2xl">
          Use the left sidebar navigation to inspect design tokens, foundation primitives, composite recipes, and workspace features.
        </p>

        <div className="space-y-3 pt-2">
          <div>
            <span className="text-[11px] font-mono font-semibold text-secondary-text uppercase block mb-1.5">
              Design System & Governance
            </span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent">Design System/Foundation-First Architecture</Badge>
              <Badge variant="neutral">Design System/State Matrix</Badge>
              <Badge variant="neutral">Design System/Elevation & Contrast</Badge>
              <Badge variant="neutral">Design System/Component Health</Badge>
              <Badge variant="neutral">Design System/Tokens</Badge>
              <Badge variant="neutral">Design System/NodeKindColors</Badge>
            </div>
          </div>

          <div>
            <span className="text-[11px] font-mono font-semibold text-secondary-text uppercase block mb-1.5">
              Composite Pattern Recipes
            </span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">Patterns/Modal Dialog Form</Badge>
              <Badge variant="neutral">Patterns/Toolbar & Action Bar</Badge>
              <Badge variant="neutral">Patterns/Settings & Property Rows</Badge>
              <Badge variant="neutral">Patterns/Search & Filter Bar</Badge>
              <Badge variant="neutral">Patterns/Destructive Prompt Dialog</Badge>
            </div>
          </div>

          <div>
            <span className="text-[11px] font-mono font-semibold text-secondary-text uppercase block mb-1.5">
              Key Foundation Primitives & Workspace
            </span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">UI/Button</Badge>
              <Badge variant="neutral">UI/Dialog</Badge>
              <Badge variant="neutral">UI/DropdownMenu</Badge>
              <Badge variant="neutral">UI/Select</Badge>
              <Badge variant="neutral">UI/Tabs</Badge>
              <Badge variant="neutral">Workspace/QuickOptions</Badge>
              <Badge variant="neutral">Workspace/FloatingDock</Badge>
              <Badge variant="neutral">Workspace/NodeCard</Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};
