/**
 * Node card visuals for the studio canvas.
 *
 * Icon: lucide, by visualKind, one fixed map with a neutral fallback for kinds
 * without one.
 * Caption: before any run, `kind · key setting` phrased as a configured value —
 * the kind word is the behavior's own type word for a resource element (e.g.
 * "processor", "router"), not the visualKind; `unmodeled` elements (including
 * the diagram-only traffic/client/mobile/device/scheduler
 * placeholders and the email/monitoring/analytics/secrets sinks) show
 * exactly "Not simulated" with no kind word attached. Never p99/pressure/
 * measured-run values here — after a run of the
 * selected scenario this line switches to that run's measurements, which is
 * the responsibility of the run feature, not this module.
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
 * One fixed visualKind -> icon map.
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
 * VISUAL_KIND_ICONS above already covers every VISUAL_KINDS entry. This fallback
 * exists only for a future visualKind added to the catalog without an icon; it renders a neutral generic shape rather than guessing.
 */
const NEUTRAL_FALLBACK_ICON: LucideIcon = Component;

export function getNodeIcon(visualKind: string): LucideIcon {
  return VISUAL_KIND_ICONS[visualKind] ?? NEUTRAL_FALLBACK_ICON;
}

/**
 * Builds the mono caption line, in the "kind · key setting" shape.
 */
export function getNodeCaption(element: Element): string {
  const behavior = element.behavior;
  // A linked project is a fixed black box, so its caption doesn't quote editable-looking settings.
  if (element.visualKind === 'linked-project') return 'black box · fixed';
  switch (behavior.kind) {
    case 'unmodeled':
      // The whole label is exactly this — no kind word,
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
      // Follows the same "kind word · count" shape as machine/pipeline.
      return `decision · ${formatCount(behavior.cases.length, 'case')}`;
    case 'host':
      // A host has no fields, so there is no key setting to show.
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
 * Formats an integer with a thin space (U+2009) as the thousands separator
 * (e.g. 2000 -> "2 000"). Values under 1000 are
 * unaffected.
 */
export function formatThousands(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped}`;
}
