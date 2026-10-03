import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { CheckCircle2, XCircle, Sparkles } from 'lucide-react';

const meta: Meta = {
  title: 'Design System/Foundation-First Architecture',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

export const ArchitectureGuide: StoryObj = {
  name: 'Architecture & Workflow Guide',
  render: () => (
    <div className="max-w-5xl space-y-10 py-4 font-sans text-ink">
      {/* Header */}
      <div className="space-y-4 border-b border-border pb-8">
        <div className="flex items-center gap-2.5">
          <Badge variant="accent">SYSTEM STUDIO</Badge>
          <Badge variant="neutral">WORKFLOW RULE</Badge>
          <StatusDot status="live" label="Single Source of Truth" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-serif font-bold text-ink">
          The Foundation-First Architecture
        </h1>
        <p className="text-base text-body max-w-3xl leading-relaxed">
          Foundation components (<code className="font-mono text-xs bg-sunken px-1.5 py-0.5 rounded">src/components/ui/</code>) and design tokens (<code className="font-mono text-xs bg-sunken px-1.5 py-0.5 rounded">src/styles.css</code>) form the core of the System Studio UI. Every visual refinement or styling change must be evaluated at the foundation level first.
        </p>
      </div>

      {/* Core Principle Callout */}
      <div className="rounded-card border-2 border-primary/30 bg-selected-tint/30 p-6 space-y-3">
        <div className="flex items-center gap-2 text-primary font-semibold text-sm">
          <Sparkles className="size-4" />
          <span>Core Invariant: Foundation Over Feature Overrides</span>
        </div>
        <p className="text-sm text-body leading-relaxed">
          Before applying bespoke Tailwind classes, inline styles, or ad-hoc wrappers inside feature components (<code className="font-mono text-xs bg-shell px-1 py-0.5 rounded border border-border">src/features/*</code>), determine whether the change represents a systemic visual trait (surface, radius, border, shadow, hover, focus). If so, <strong>update the shared foundation primitive or design token</strong> so every consuming view across the application is updated simultaneously.
        </p>
      </div>

      {/* 5-Step Foundation Decision Flow */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          The 5-Step Foundation-First Decision Flow
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Card className="bg-shell border-control-border">
            <CardHeader className="p-4 space-y-2">
              <div className="size-7 rounded-control bg-accent text-primary flex items-center justify-center font-mono font-bold text-xs">
                1
              </div>
              <CardTitle className="text-xs font-bold">Identify Need</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Designer or user asks for a UI refinement (e.g. modal background, corner radius, button state).
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-shell border-control-border">
            <CardHeader className="p-4 space-y-2">
              <div className="size-7 rounded-control bg-selected-tint text-primary flex items-center justify-center font-mono font-bold text-xs">
                2
              </div>
              <CardTitle className="text-xs font-bold">Check Foundation</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Does this trait belong to a shared primitive in <code className="font-mono text-[10px]">components/ui/</code> or token in <code className="font-mono text-[10px]">styles.css</code>?
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-shell border-control-border">
            <CardHeader className="p-4 space-y-2">
              <div className="size-7 rounded-control bg-branch-tint text-branch flex items-center justify-center font-mono font-bold text-xs">
                3
              </div>
              <CardTitle className="text-xs font-bold">Update Core</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Update the primitive component or register the token in <code className="font-mono text-[10px]">@theme inline</code>.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-shell border-control-border">
            <CardHeader className="p-4 space-y-2">
              <div className="size-7 rounded-control bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center font-mono font-bold text-xs">
                4
              </div>
              <CardTitle className="text-xs font-bold">Verify Storybook</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Inspect in Storybook across all variants and states to guarantee zero regressions.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-shell border-control-border">
            <CardHeader className="p-4 space-y-2">
              <div className="size-7 rounded-control bg-primary text-white flex items-center justify-center font-mono font-bold text-xs">
                5
              </div>
              <CardTitle className="text-xs font-bold">Consume Cleanly</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Feature consumes the foundation primitive with zero bespoke override classes.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Case Study Comparison */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          Real-World Case Study: Modal Dialog Harmonization
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Anti-Pattern */}
          <div className="rounded-card border border-risk-edge bg-risk-tint/30 p-5 space-y-3">
            <div className="flex items-center gap-2 text-risk-text font-bold text-xs uppercase tracking-wide">
              <XCircle className="size-4" />
              <span>Anti-Pattern (Feature Override)</span>
            </div>
            <p className="text-xs text-body leading-relaxed">
              When QuickOptions needed a crisp white dialog with 11px popover corners, overriding it locally in <code className="font-mono text-[11px] bg-background px-1 py-0.5 rounded">QuickOptions.tsx</code> left all other dialogs (NewScenario, DeleteScenario, ReplacePart, PublishReview, NavigationGuard) inconsistent with muted beige panels and 8px radii.
            </p>
            <div className="rounded-md bg-risk-tint/60 border border-risk-edge/50 p-2.5 font-mono text-[11px] text-risk-text">
              <code>{`<DialogContent className="bg-white rounded-[11px] shadow-2xl max-w-xl ...">`}</code>
            </div>
            <p className="text-[11px] text-risk-text">
              Outcome: 7 inconsistent dialogs, fractured codebase, high maintenance debt.
            </p>
          </div>

          {/* Recommended Practice */}
          <div className="rounded-card border border-primary/40 bg-selected-tint/30 p-5 space-y-3">
            <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wide">
              <CheckCircle2 className="size-4" />
              <span>Foundation-First (Harmonized)</span>
            </div>
            <p className="text-xs text-body leading-relaxed">
              Updating the base primitive <code className="font-mono text-[11px] bg-background px-1 py-0.5 rounded">src/components/ui/dialog.tsx</code> with <code className="font-mono text-[11px]">bg-background</code>, <code className="font-mono text-[11px]">rounded-popover</code> (11px), and <code className="font-mono text-[11px]">shadow-floating</code> instantly harmonized every dialog across the entire application with zero redundant classes.
            </p>
            <div className="rounded-md bg-selected-tint/60 border border-primary/30 p-2.5 font-mono text-[11px] text-primary">
              <code>{`// In src/components/ui/dialog.tsx\nclassName="rounded-popover border border-border bg-background shadow-floating ..."`}</code>
            </div>
            <p className="text-[11px] text-primary font-medium">
              Outcome: 100% modal consistency, zero feature overrides, single point of change.
            </p>
          </div>
        </div>
      </div>

      {/* Rules of Engagement */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-wider text-secondary-text font-semibold">
          Rules of Engagement for Engineers and AI Agents
        </h2>
        <div className="space-y-2">
          <div className="flex items-start gap-3 p-3.5 rounded-card border border-border bg-shell">
            <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-semibold text-ink">Never bypass foundation components with raw HTML elements</span>
              <p className="text-body text-[11px]">
                Always use <code className="font-mono">Button</code>, <code className="font-mono">Input</code>, <code className="font-mono">NativeSelect</code>, <code className="font-mono">Checkbox</code>, etc. instead of unstyled native <code className="font-mono">&lt;button&gt;</code> or <code className="font-mono">&lt;input&gt;</code>. Foundation components encapsulate focus rings, accessibility attributes, and keyboard navigation.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-card border border-border bg-shell">
            <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-semibold text-ink">Tailwind v4: Always register direct color utilities in @theme inline</span>
              <p className="text-body text-[11px]">
                In Tailwind CSS v4, CSS variables declared only in <code className="font-mono">:root</code> do NOT generate utility classes (<code className="font-mono">border-*</code>, <code className="font-mono">bg-*</code>, <code className="font-mono">text-*</code>). Any token must be declared in <code className="font-mono">src/styles.css</code> under <code className="font-mono">@theme inline</code>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-card border border-border bg-shell">
            <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-semibold text-ink">Add variants to CVA instead of ad-hoc class strings</span>
              <p className="text-body text-[11px]">
                If a button or badge needs a new visual flavor (e.g. Soft Evergreen Tint or Soft Clay Tint), add it as an official variant in the component's <code className="font-mono">buttonVariants</code> or <code className="font-mono">badgeVariants</code> configuration.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-card border border-border bg-shell">
            <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-semibold text-ink">Verify every change with Storybook</span>
              <p className="text-body text-[11px]">
                Run <code className="font-mono">npm run build-storybook</code> or view the component story in Storybook before concluding any UI task.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};
