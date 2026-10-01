import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { evergreen } from '@/components/studio/tokens';

const meta: Meta = {
  title: 'Design System/Tokens',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

export const ColorsAndSurfaces: StoryObj = {
  name: 'Colors & Surfaces',
  render: () => {
    const surfaceTokens = [
      { name: 'canvas', hex: evergreen.canvas, role: 'Base graph backdrop' },
      { name: 'shell', hex: evergreen.shell, role: 'Outer app background' },
      { name: 'panel', hex: evergreen.panel, role: 'Toolbars, rails, drawers' },
      { name: 'sunken', hex: evergreen.sunken, role: 'Segmented controls, wells' },
      { name: 'desk', hex: evergreen.desk, role: 'Pressed states, active wells' },
      { name: 'note', hex: evergreen.note, role: 'Sticky notes on canvas' },
    ];

    const textTokens = [
      { name: 'ink (foreground)', hex: evergreen.ink, role: 'Primary headings and labels' },
      { name: 'body', hex: evergreen.body, role: 'Body copy and paragraph text' },
      { name: 'secondary', hex: evergreen.secondary, role: 'Supporting captions and hints' },
    ];

    const brandTokens = [
      { name: 'primary', hex: evergreen.primary, role: 'Primary actions and focus markers' },
      { name: 'primaryHover', hex: evergreen.primaryHover, role: 'Hover state for primary' },
      { name: 'primaryPressed', hex: evergreen.primaryPressed, role: 'Pressed state for primary' },
      { name: 'selectedTint', hex: evergreen.selectedTint, role: 'Selected row/item background' },
      { name: 'selectedEdge', hex: evergreen.selectedEdge, role: 'Selected item border highlight' },
    ];

    const signalTokens = [
      { name: 'branch', hex: evergreen.branch, role: 'Branching and async operations' },
      { name: 'branchTint', hex: evergreen.branchTint, role: 'Branch tag background' },
      { name: 'branchEdge', hex: evergreen.branchEdge, role: 'Branch tag border' },
      { name: 'risk', hex: evergreen.risk, role: 'Risk & alerts decorative clay' },
      { name: 'riskText', hex: evergreen.riskText, role: 'Risk accessible text on tint' },
      { name: 'riskTint', hex: evergreen.riskTint, role: 'Risk tag / alert background' },
      { name: 'riskEdge', hex: evergreen.riskEdge, role: 'Risk border highlight' },
      { name: 'destructive', hex: evergreen.destructive, role: 'Destructive action button' },
    ];

    const lineTokens = [
      { name: 'divider', hex: evergreen.divider, role: 'Panel dividers and borders' },
      { name: 'hairlineSoft', hex: evergreen.hairlineSoft, role: 'Canvas grid dots & subtle hairlines' },
      { name: 'controlBorder', hex: evergreen.controlBorder, role: 'Input and control default borders' },
      { name: 'hoverBorder', hex: evergreen.hoverBorder, role: 'Control border hover state' },
      { name: 'controlBorderStrong', hex: evergreen.controlBorderStrong, role: 'High-contrast accessible borders' },
      { name: 'borderPressed', hex: evergreen.borderPressed, role: 'Active border state' },
    ];

    const renderGroup = (title: string, tokens: Array<{ name: string; hex: string; role: string }>) => (
      <div className="space-y-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-secondary-text font-semibold border-b border-border pb-1">
          {title}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tokens.map((t) => (
            <div
              key={t.name}
              className="flex items-center gap-3 p-2.5 rounded-card border border-control-border bg-shell shadow-2xs"
            >
              <div
                className="size-11 rounded-control border border-border shadow-xs shrink-0"
                style={{ backgroundColor: t.hex }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-semibold text-foreground truncate">
                  {t.name}
                </div>
                <div className="font-mono text-[11px] text-secondary-text">{t.hex}</div>
                <div className="text-[11px] text-body truncate mt-0.5">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div className="space-y-8 max-w-5xl">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink font-sans">Evergreen Color Tokens</h2>
          <p className="text-xs text-secondary-text mt-1">
            Exact hexadecimal values and roles defined in specs and tokens.ts.
          </p>
        </div>
        {renderGroup('Surfaces', surfaceTokens)}
        {renderGroup('Typography & Ink', textTokens)}
        {renderGroup('Brand & Selection', brandTokens)}
        {renderGroup('Signals (Risk, Branch, Destructive)', signalTokens)}
        {renderGroup('Lines & Borders', lineTokens)}
      </div>
    );
  },
};

export const Typography: StoryObj = {
  name: 'Typography Scale',
  render: () => {
    const scales = [
      { token: 'text-xs', size: '11.5px', sample: 'Metadata, badges, port indicators, timestamp pills' },
      { token: 'text-sm', size: '12.5px', sample: 'Secondary body text, table row details, tooltip copy' },
      { token: 'text-base / ui', size: '13px', sample: 'Default UI controls, buttons, form inputs, node labels' },
      { token: 'text-lg / subtitle', size: '15px', sample: 'Section subheadings, dialog descriptions, modal titles' },
      { token: 'text-xl / title', size: '18px', sample: 'Inspector panel title, scenario names, primary drawer headers' },
      { token: 'text-2xl / heading', size: '28px', sample: 'Workspace document title, scenario outcome header' },
      { token: 'text-3xl', size: '30px', sample: 'Dashboard top level KPI metrics' },
      { token: 'text-display', size: '46px', sample: 'Landing hero, empty canvas welcoming display' },
    ];

    return (
      <div className="space-y-8 max-w-5xl">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink font-sans">Typography Scale</h2>
          <p className="text-xs text-secondary-text mt-1">
            Designed for high density information architecture with three specialized font families.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-card border border-control-border bg-shell">
            <span className="font-mono text-[10px] uppercase tracking-wider text-secondary-text">UI & Controls</span>
            <h4 className="text-base font-semibold mt-1">IBM Plex Sans</h4>
            <p className="text-xs text-body mt-2 leading-relaxed">
              Used for all buttons, inputs, dialogs, and workspace cards. Crisp geometry and legible at small sizes.
            </p>
          </div>
          <div className="p-4 rounded-card border border-control-border bg-shell">
            <span className="font-mono text-[10px] uppercase tracking-wider text-secondary-text">Data & Code</span>
            <h4 className="text-base font-mono font-semibold mt-1">IBM Plex Mono</h4>
            <p className="text-xs text-body mt-2 leading-relaxed">
              Used for port labels, latency readouts, JSON configs, node IDs, and keyboard shortcuts.
            </p>
          </div>
          <div className="p-4 rounded-card border border-control-border bg-shell">
            <span className="font-mono text-[10px] uppercase tracking-wider text-secondary-text">Editorial & Hero</span>
            <h4 className="text-base font-serif font-semibold mt-1">Newsreader Variable</h4>
            <p className="text-xs text-body mt-2 leading-relaxed">
              Provides warm editorial accents for hero titles and scenario narrative introductions.
            </p>
          </div>
        </div>

        <div className="divide-y divide-border border border-control-border rounded-card bg-background overflow-hidden">
          {scales.map((s) => (
            <div key={s.token} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="w-48 shrink-0">
                <span className="font-mono text-xs font-semibold text-primary">{s.token}</span>
                <span className="ml-2 font-mono text-[11px] text-secondary-text">({s.size})</span>
              </div>
              <div className="flex-1 font-sans text-ink" style={{ fontSize: s.size }}>
                {s.sample}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

export const RadiiAndShadows: StoryObj = {
  name: 'Radii & Elevation',
  render: () => {
    const radii = [
      { name: 'tag', px: '4px', role: 'Status badges, tags, pills' },
      { name: 'control', px: '7px', role: 'Buttons, text fields, selects' },
      { name: 'node', px: '9px', role: 'Canvas nodes and component boxes' },
      { name: 'popover', px: '11px', role: 'Dropdown menus, popover tooltips' },
      { name: 'card', px: '12px', role: 'Inspector cards, dialogs' },
      { name: 'dock', px: '14px', role: 'Floating canvas bottom dock' },
    ];

    const shadows = [
      { name: 'shadow-raised', role: 'Hover on cards, subtle buttons', shadow: evergreen.shadow.raised },
      { name: 'shadow-lifted', role: 'Selected nodes, active cards', shadow: evergreen.shadow.lifted },
      { name: 'shadow-popover', role: 'Dropdown menus and popovers', shadow: evergreen.shadow.popover },
      { name: 'shadow-floating', role: 'Floating canvas dock, dragging preview', shadow: evergreen.shadow.floating },
      { name: 'shadow-frame', role: 'Modal dialog windows', shadow: evergreen.shadow.frame },
      { name: 'shadow-toast', role: 'Floating notifications and toasts', shadow: evergreen.shadow.toast },
    ];

    return (
      <div className="space-y-8 max-w-5xl">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink font-sans">Radii & Elevation</h2>
          <p className="text-xs text-secondary-text mt-1">
            Systematic corner radii and multi-tiered warm shadow elevations.
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-secondary-text font-semibold border-b border-border pb-1">
            Evergreen Radii Scale
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {radii.map((r) => (
              <div
                key={r.name}
                className="flex flex-col items-center p-3 text-center rounded-card border border-control-border bg-shell"
              >
                <div
                  className="size-16 border-2 border-primary bg-accent flex items-center justify-center font-mono text-xs font-semibold text-primary mb-2"
                  style={{ borderRadius: r.px }}
                >
                  {r.px}
                </div>
                <span className="font-mono text-xs font-semibold text-foreground">{r.name}</span>
                <span className="text-[10.5px] text-secondary-text mt-0.5 leading-tight">{r.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-secondary-text font-semibold border-b border-border pb-1">
            Elevation Shadows
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {shadows.map((s) => (
              <div
                key={s.name}
                className="p-5 rounded-card border border-border bg-background flex flex-col justify-between"
                style={{ boxShadow: s.shadow }}
              >
                <div>
                  <h4 className="font-mono text-xs font-semibold text-foreground">{s.name}</h4>
                  <p className="text-xs text-body mt-1">{s.role}</p>
                </div>
                <div className="mt-4 font-mono text-[9.5px] text-secondary-text break-all bg-sunken p-1.5 rounded">
                  {s.shadow}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
};
