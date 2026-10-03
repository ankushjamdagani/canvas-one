/**
 * Node card visuals for System Studio canvas (RV-03s).
 *
 * Screen: specs/revamp/screens/2A_workspace.png.
 * Icon: lucide, by visualKind, one fixed map with a neutral fallback for kinds
 * without one (D13: keep Lucide icons).
 * Caption (D42 catalog.md "Approved resolutions" item 10, extended by items
 * 7/12): before any run, `kind · key setting` phrased as a configured value —
 * the kind word is the behavior's own type word for a resource element (e.g.
 * "processor", "router"), not the visualKind; `unmodeled` elements (including
 * the D42-item-12 diagram-only traffic/client/mobile/device/scheduler
 * placeholders and the item-7 email/monitoring/analytics/secrets sinks) show
 * exactly "Not simulated" with no kind word attached. Never p99/pressure/
 * measured-run values here (Lead default "Metrics"; D15) — after a run of the
 * selected scenario this line switches to that run's measurements, which is
 * the runs lane's responsibility, not this shell's.
 */

import {
  Radio,
  Smartphone,
  MonitorSmartphone,
  Globe,
  Zap,
  ShieldCheck,
  Waypoints,
  Scale,
  Server,
  FunctionSquare,
  Box,
  Cog,
  Clock,
  Database,
  FileJson,
  Layers,
  HardDrive,
  Search,
  Warehouse,
  ListOrdered,
  Waves,
  Rss,
  Mail,
  Gauge,
  BarChart3,
  KeyRound,
  Building2,
  Blocks,
  GitBranch as StateMachineIcon,
  Workflow,
  Monitor,
  Component,
  Link2,
  type LucideIcon,
} from 'lucide-react';
import type { Element, ResourceConfig } from '../../domain/studio/model';

/**
 * One fixed visualKind -> icon map (D13: keep Lucide icons).
 * Kinds not listed fall through to NEUTRAL_FALLBACK_ICON below rather than
 * inventing a mapping.
 */
const VISUAL_KIND_ICONS: Record<string, LucideIcon> = {
  'linked-project': Link2,
  traffic: Radio,
  client: Smartphone,
  mobile: MonitorSmartphone,
  device: MonitorSmartphone,
  dns: Globe,
  cdn: Zap,
  firewall: ShieldCheck,
  gateway: Waypoints,
  balancer: Scale,
  service: Server,
  function: FunctionSquare,
  container: Box,
  worker: Cog,
  scheduler: Clock,
  database: Database,
  nosql: FileJson,
  cache: Layers,
  objectstore: HardDrive,
  search: Search,
  warehouse: Warehouse,
  queue: ListOrdered,
  stream: Waves,
  pubsub: Rss,
  email: Mail,
  monitoring: Gauge,
  analytics: BarChart3,
  secrets: KeyRound,
  thirdparty: Building2,
  custom: Blocks,
  'state-machine': StateMachineIcon,
  'data-pipeline': Workflow,
  host: Monitor,
};

/**
 * CONTRACT GAP: VISUAL_KIND_ICONS above already covers every VISUAL_KINDS entry
 * (29-kind catalog + state-machine/data-pipeline/host, model.ts). This fallback
 * exists only for a future visualKind added to the catalog without an icon
 * decision yet; it renders a neutral generic shape rather than guessing.
 */
const NEUTRAL_FALLBACK_ICON: LucideIcon = Component;

export function getNodeIcon(visualKind: string): LucideIcon {
  return VISUAL_KIND_ICONS[visualKind] ?? NEUTRAL_FALLBACK_ICON;
}

/**
 * Builds the mono caption line, D42 item 10's "kind · key setting" shape.
 */
export function getNodeCaption(element: Element): string {
  const behavior = element.behavior;
  // D52: a linked project is a fixed black box, so its caption doesn't quote editable-looking settings.
  if (element.visualKind === 'linked-project') return 'black box · fixed';
  switch (behavior.kind) {
    case 'unmodeled':
      // D42 items 7 & 12: the whole label is exactly this — no kind word,
      // no config value, whether it's a scenario-boundary external
      // dependency or a diagram-only placeholder.
      return 'Not simulated';
    case 'resource':
      return getResourceCaption(behavior.config);
    case 'machine':
      return `state machine · ${formatCount(behavior.states.length, 'state')}`;
    case 'pipeline':
      return `data pipeline · ${formatCount(behavior.operations.length, 'step')}`;
    case 'decision':
      // CONTRACT GAP: D42 item 10 gives worked examples for resource/
      // unmodeled/machine/pipeline/host but not decision. Narrowest reading:
      // follow the same "kind word · count" shape as machine/pipeline.
      return `decision · ${formatCount(behavior.cases.length, 'case')}`;
    case 'host':
      // catalog.md §2 "host": "host has no fields" — no key setting to show.
      return 'host';
    default:
      return element.visualKind;
  }
}

function getResourceCaption(config: ResourceConfig): string {
  switch (config.type) {
    case 'router':
      // e.g. "router · round-robin"
      return `router · ${config.strategy}`;
    case 'broker':
      // e.g. "broker · competing"
      return `broker · ${config.delivery}`;
    case 'cache':
      // e.g. "cache · 80% hit"
      return `cache · ${formatThousands(config.hitRate)}% hit`;
    case 'storage':
      // e.g. "storage · 500 /s cap"
      return `storage · ${formatThousands(config.capacity)} /s cap`;
    case 'source':
    case 'processor':
      // e.g. "processor · 2 000 /s cap"
      return `${config.type} · ${formatThousands(config.capacity)} /s cap`;
    default:
      return (config as { type: string }).type;
  }
}

function formatCount(n: number, noun: string): string {
  return `${formatThousands(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Formats an integer with a thin space (U+2009) as the thousands separator,
 * matching the screens (e.g. 2000 -> "2 000"). Values under 1000 are
 * unaffected.
 */
export function formatThousands(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped}`;
}
