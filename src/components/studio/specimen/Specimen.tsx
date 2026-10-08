import * as React from "react";
import {
  Settings,
  Plus,
  Sparkles,
  SlidersHorizontal,
  MousePointer,
  Hand,
  Library,
  StickyNote,
  Maximize2,
  Copy,
  Download,
  Trash2,
} from "lucide-react";
import { evergreen, nodeKindColor } from "@/components/studio/tokens";
import { Alert, AlertTitle, AlertDescription, InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuHeader,
  DropdownMenuFooter,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { DropdownMenuPanel } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { KeyHint } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from "@/components/ui/toast";
import { Progress } from "@/components/ui/progress";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { StatusDot } from "@/components/ui/status-dot";
import { SearchField } from "@/components/ui/search-field";
import { Stepper } from "@/components/ui/stepper";
import { Segmented } from "@/components/ui/segmented";
import { Meter } from "@/components/ui/meter";
import { EmptyState } from "@/components/ui/empty-state";
import { LibraryRow } from "@/components/ui/library-row";
import { AvatarStack } from "@/components/ui/avatar-stack";

const buttonVariantsList = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "tint",
  "ghost",
  "link",
] as const;

const buttonSizesList = ["default", "sm", "lg", "icon"] as const;

const badgeVariantsList = [
  "neutral",
  "success",
  "accent",
  "branch",
  "risk",
  "warning",
  "solid",
  "count",
  "default",
  "secondary",
  "destructive",
  "outline",
  "amber",
] as const;

export function Specimen() {
  const colorEntries = Object.entries(evergreen).filter(
    ([, val]) => typeof val === "string"
  ) as [string, string][];

  const radiusEntries = Object.entries(evergreen.radii) as [string, number][];

  const [segValue, setSegValue] = React.useState("grid");
  const [searchValue, setSearchValue] = React.useState("");
  const [stepperVal, setStepperVal] = React.useState(5);
  const [sliderVal, setSliderVal] = React.useState([62]);

  return (
    <div className="min-h-screen bg-shell text-foreground p-8 max-w-6xl mx-auto space-y-16 font-sans">
      <header className="space-y-3 border-b border-border pb-8">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold tracking-wider text-accent-foreground uppercase bg-accent px-2 py-0.5 rounded-tag border border-border">
            System Studio
          </span>
          <span className="font-mono text-xs text-muted-foreground">Evergreen v2.0</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-normal tracking-normal text-foreground">
          System Studio Design System
        </h1>
        <p className="text-sm text-secondary-text max-w-3xl leading-relaxed">
          Visual foundations, core components, and interaction states for the System Studio canvas and simulator.
          Conforming to <code className="font-mono text-xs bg-panel px-1.5 py-0.5 rounded border border-border">System Studio Design System.dc.html</code>.
        </p>
      </header>

      {/* ──────────────────────────────────────────────────────────
          01 PALETTE
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-colours" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">01</span>
          <h2 id="heading-colours" className="text-2xl font-display font-normal text-foreground">
            Colour Tokens
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Surfaces, accents, borders, and functional node colors.
          </span>
        </div>

        {/* Surface & Canvas */}
        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Surface &amp; Canvas
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { name: "Drafting Paper", token: "--canvas", hex: evergreen.canvas },
              { name: "Drafting Dots", token: "--grid", hex: evergreen.grid },
              { name: "Paper Shell", token: "--shell", hex: "#FBFAF7" },
              { name: "Studio Panel", token: "--panel", hex: "#F7F5F1" },
              { name: "Sunken Stone", token: "--sunken", hex: "#F2EFE9" },
              { name: "Desk Gray", token: "--desk", hex: "#E9E7E2" },
            ].map((s) => (
              <div key={s.token} className="rounded-md border border-border bg-panel p-2.5 space-y-2 shadow-2xs">
                <div className="h-10 rounded border border-hairline" style={{ backgroundColor: s.hex }} />
                <div>
                  <div className="text-xs font-semibold">{s.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{s.hex}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Accent & Action */}
        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Accent &amp; Action
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { name: "Action Green", token: "--primary", hex: "#0B5C54" },
              { name: "Green Hover", token: "--primary-hover", hex: "#0A4E47" },
              { name: "Green Pressed", token: "--primary-pressed", hex: "#083F3A" },
              { name: "Green Tint", token: "--accent", hex: "#EAEFEC" },
              { name: "Clay / Risk", token: "--risk", hex: "#B4674A" },
              { name: "Purple / Branch", token: "--branch", hex: "#7D5A9B" },
            ].map((s) => (
              <div key={s.token} className="rounded-md border border-border bg-panel p-2.5 space-y-2 shadow-2xs">
                <div className="h-10 rounded border border-hairline" style={{ backgroundColor: s.hex }} />
                <div>
                  <div className="text-xs font-semibold">{s.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{s.hex}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Text & Foreground */}
        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Text &amp; Foreground
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { name: "Deep Ink", token: "--foreground", hex: "#16201D" },
              { name: "Body Ink", token: "--body", hex: "#4A544F" },
              { name: "Secondary", token: "--secondary-text", hex: "#626D68" },
              { name: "Meta Muted", token: "--text-micro", hex: "#8A938F" },
              { name: "Disabled", token: "--text-disabled", hex: "#C0C6C1" },
            ].map((s) => (
              <div key={s.token} className="rounded-md border border-border bg-panel p-2.5 space-y-2 shadow-2xs">
                <div className="h-10 rounded border border-hairline" style={{ backgroundColor: s.hex }} />
                <div>
                  <div className="text-xs font-semibold">{s.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{s.hex}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Borders & Dividers */}
        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Borders &amp; Dividers
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { name: "Hairline", token: "--border", hex: "#E7E3DB" },
              { name: "Control Border", token: "--control-border", hex: "#DCD7CD" },
              { name: "Hover Border", token: "--hover-border", hex: "#C6C0B4" },
              { name: "Strong Input", token: "--input", hex: "#948D80" },
              { name: "Pressed Border", token: "--border-pressed", hex: "#B8B1A3" },
            ].map((s) => (
              <div key={s.token} className="rounded-md border border-border bg-panel p-2.5 space-y-2 shadow-2xs">
                <div className="h-10 rounded border border-hairline" style={{ backgroundColor: s.hex }} />
                <div>
                  <div className="text-xs font-semibold">{s.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{s.hex}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Node Kinds (D35 Decision) */}
        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Node Kinds · D35 Decision Stripes
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {Object.entries(nodeKindColor).map(([layer, hex]) => (
              <div key={layer} className="rounded-md border border-border bg-panel p-2.5 space-y-2 shadow-2xs">
                <div className="h-10 rounded border border-hairline flex flex-col justify-between p-1.5" style={{ backgroundColor: hex }}>
                  <div className="h-1 w-full bg-white/40 rounded-full" />
                </div>
                <div>
                  <div className="text-xs font-semibold capitalize">{layer}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{hex}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Full exported tokens list for reference */}
        <div className="space-y-2 pt-2">
          <div className="text-xs font-mono text-muted-foreground">
            All {colorEntries.length} exported token roles
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2 p-3 bg-panel border border-border rounded-md">
            {colorEntries.map(([name, hex]) => (
              <div key={name} className="flex items-center gap-2">
                <span className="size-3 rounded-xs border border-hairline shrink-0" style={{ backgroundColor: hex }} />
                <span className="font-mono text-[10px] truncate">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          02 TYPOGRAPHY
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-typography" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">02</span>
          <h2 id="heading-typography" className="text-2xl font-display font-normal text-foreground">
            Typography
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Newsreader headings, IBM Plex Mono interface text, Martian Mono measurements, and Caveat annotations.
          </span>
        </div>

        <div className="border border-border rounded-lg bg-panel p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-baseline pb-6 border-b border-hairline">
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Display · 46px</span>
              <div className="font-display text-4xl sm:text-5xl font-normal tracking-normal text-foreground leading-none">
                System Studio
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Heading · 28px</span>
              <div className="font-display text-2xl font-normal tracking-normal text-foreground">
                Discrete-event simulator
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-hairline">
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Title · 18px / 600</span>
              <div className="text-lg font-semibold text-foreground">
                Order Processing Topology
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Subtitle · 15px / 400</span>
              <div className="text-sm font-normal text-secondary-text">
                Architecture and simulation metrics
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">UI Body · 13px / 400</span>
              <div className="text-xs font-normal text-body leading-relaxed">
                Evergreen paper foundation with light-only surfaces and high-contrast text.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label · 11.5px / 600</span>
              <div className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Connection Status
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Micro / Meta · 10px Mono</span>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                P99 LATENCY · 142MS
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Mono Code · 12px</span>
              <div className="font-mono text-xs text-foreground bg-shell p-2 rounded border border-hairline">
                simulate(reqs=1000, rps=620)
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          03 GEOMETRY & ELEVATION
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-radii" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">03</span>
          <h2 id="heading-radii" className="text-2xl font-display font-normal text-foreground">
            Radii
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Consistent geometry scale and 6 elevation depth tiers.
          </span>
        </div>

        {/* Radii scale */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {radiusEntries.map(([name, val]) => (
            <div key={name} className="flex flex-col gap-2 border border-border p-3 rounded-md bg-panel shadow-2xs">
              <div
                className="h-14 w-full border border-primary bg-background flex items-center justify-center font-mono text-xs font-semibold text-primary"
                style={{ borderRadius: `${val}px` }}
              >
                {val}px
              </div>
              <div className="flex justify-between items-baseline text-xs">
                <span className="font-medium text-foreground capitalize">{name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{val}px</span>
              </div>
            </div>
          ))}
        </div>

        {/* Elevation tiers */}
        <div className="space-y-3 pt-2">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Elevation · 6 Depth Tiers
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { name: "Raised", shadow: "shadow-raised", desc: "Cards / Rows" },
              { name: "Lifted", shadow: "shadow-lifted", desc: "Node Hover" },
              { name: "Popover", shadow: "shadow-popover", desc: "Menus / Dropdowns" },
              { name: "Floating", shadow: "shadow-floating", desc: "Dock / Dialogs" },
              { name: "Frame", shadow: "shadow-frame", desc: "Modals" },
              { name: "Toast", shadow: "shadow-toast", desc: "Notifications" },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`rounded-card border border-border bg-background p-4 flex flex-col justify-between h-28 ${tier.shadow}`}
              >
                <div className="text-xs font-semibold text-foreground">{tier.name}</div>
                <div className="text-[11px] text-secondary-text">{tier.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          04 INTERACTION & MOTION
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-interaction" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">04</span>
          <h2 id="heading-interaction" className="text-2xl font-display font-normal text-foreground">
            Interaction &amp; Motion
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Accessible focus rings and restrained, snappy motion.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Focus Rings · 2px Accessible Outlines
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-background rounded-control border border-primary shadow-ring text-center text-xs font-medium">
                Focus Ring
              </div>
              <div className="p-3 bg-primary text-primary-foreground rounded-control shadow-ring-strong text-center text-xs font-medium">
                Strong Ring
              </div>
              <div className="p-3 bg-background rounded-control border border-selected-edge shadow-ring-soft text-center text-xs font-medium text-primary">
                Soft Ring
              </div>
              <div className="p-3 bg-destructive text-destructive-foreground rounded-control shadow-ring-danger text-center text-xs font-medium">
                Danger Ring
              </div>
              <div className="p-3 bg-background rounded-control border border-risk-edge shadow-ring-danger-soft text-center text-xs font-medium text-risk-text">
                Danger Soft
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Motion · Restrained 0.8s Spin
            </h3>
            <div className="flex items-center gap-6 h-full pb-2">
              <div className="flex items-center gap-2.5">
                <span className="size-3.5 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
                <span className="text-xs text-foreground font-medium">11px Spinner</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="size-4 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
                <span className="text-xs text-foreground font-medium">16px Spinner</span>
              </div>
              <div className="text-xs text-secondary-text">
                Snaps instantly. Never bounces.
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          05 CORE ACTIONS
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-buttons" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">05</span>
          <h2 id="heading-buttons" className="text-2xl font-display font-normal text-foreground">
            Buttons
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Button Tone × State matrix, IconButtons, KeyHints, StatusDots, and Badges.
          </span>
        </div>

        {/* Sizes & Test Requirements */}
        <div className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Variants x Sizes
            </h3>
            <div className="space-y-3">
              {buttonVariantsList.map((variant) => (
                <div key={variant} className="flex flex-wrap items-center gap-3">
                  <span className="w-24 text-xs font-mono font-medium text-muted-foreground">
                    {variant}
                  </span>
                  {buttonSizesList.map((size) => (
                    <Button
                      key={`${variant}-${size}`}
                      type="button"
                      variant={variant}
                      size={size}
                      aria-label={size === "icon" ? `${variant} icon button` : undefined}
                    >
                      {size === "icon" ? (
                        <Settings className="size-4" />
                      ) : (
                        `${variant} (${size})`
                      )}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-medium text-muted-foreground">Disabled States</h3>
            <div className="flex flex-wrap items-center gap-3">
              {buttonVariantsList.map((variant) => (
                <Button
                  key={`disabled-${variant}`}
                  type="button"
                  variant={variant}
                  disabled
                >
                  {variant} disabled
                </Button>
              ))}
              <Button
                type="button"
                size="icon"
                disabled
                aria-label="Disabled icon button"
              >
                <Settings className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-medium text-muted-foreground">Long-Label Case</h3>
            <div className="max-w-md">
              <Button type="button" variant="default" className="w-full">
                Deploy scenario to production cluster with automated failover, telemetry verification, and snapshot checkpoints
              </Button>
            </div>
          </div>
        </div>

        {/* Tone x State Matrix */}
        <div className="border border-border rounded-lg bg-panel p-5 space-y-4 overflow-x-auto">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Button Tone × State Matrix
          </h3>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-mono text-[10px] uppercase">
                <th className="py-2 pr-4">Tone</th>
                <th className="py-2 px-3">Rest</th>
                <th className="py-2 px-3">Hover</th>
                <th className="py-2 px-3">Focused</th>
                <th className="py-2 px-3">Working</th>
                <th className="py-2 px-3">Disabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              <tr>
                <td className="py-2.5 pr-4 font-mono font-medium">Primary</td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="default" size="sm">Action</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="default" size="sm" className="bg-primary-hover">Action</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="default" size="sm" className="shadow-ring-strong">Action</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="default" size="sm" loading>Running</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="default" size="sm" disabled>Action</Button>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono font-medium">Secondary</td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="secondary" size="sm">Inspect</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="secondary" size="sm" className="bg-secondary-hover border-border-pressed">Inspect</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="secondary" size="sm" className="border-primary shadow-ring">Inspect</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="secondary" size="sm" loading>Saving</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="secondary" size="sm" disabled>Inspect</Button>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono font-medium">Tint</td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="tint" size="sm">Add Step</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="tint" size="sm" className="bg-tint-hover border-tint-hover-edge">Add Step</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="tint" size="sm" className="border-primary shadow-ring">Add Step</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="tint" size="sm" loading>Loading</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="tint" size="sm" disabled>Add Step</Button>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono font-medium">Ghost</td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="ghost" size="sm">Dismiss</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="ghost" size="sm" className="bg-sunken text-foreground">Dismiss</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="ghost" size="sm" className="border-primary shadow-ring">Dismiss</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="ghost" size="sm" loading>Dismiss</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="ghost" size="sm" disabled>Dismiss</Button>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-mono font-medium">Destructive</td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="destructive" size="sm">Delete</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="destructive" size="sm" className="bg-destructive-hover">Delete</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="destructive" size="sm" className="shadow-ring-danger">Delete</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="destructive" size="sm" loading>Deleting</Button>
                </td>
                <td className="py-2.5 px-3">
                  <Button type="button" variant="destructive" size="sm" disabled>Delete</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* StatusDot, KeyHint, Tags, CountBadge */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              StatusDot &amp; KeyHint
            </h3>
            <div className="flex flex-wrap items-center gap-5">
              <StatusDot status="live" halo label="Live / Running" />
              <StatusDot status="degraded" halo label="Degraded" />
              <StatusDot status="idle" label="Idle" />
              <StatusDot status="branch" label="Branch" />
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <KeyHint>⌘K</KeyHint>
              <KeyHint>⇧P</KeyHint>
              <KeyHint>Esc</KeyHint>
              <KeyHint>⌥⌫</KeyHint>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 id="heading-badges" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Badges
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {badgeVariantsList.map((v) => (
                <Badge key={v} variant={v}>
                  {v}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <span className="text-xs text-muted-foreground">CountBadge:</span>
              <span className="font-mono text-[9px] rounded-full bg-sunken px-2 py-0.5 text-body">12</span>
              <span className="font-mono text-[9px] rounded-full bg-primary px-2 py-0.5 text-primary-foreground font-semibold">4</span>
              <span className="font-mono text-[9px] rounded-full bg-clay px-2 py-0.5 text-primary-foreground font-semibold">!</span>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          06 FORMS & INPUTS
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-inputs" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">06</span>
          <h2 id="heading-inputs" className="text-2xl font-display font-normal text-foreground">
            Inputs &amp; Textareas
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Text inputs across 6 states, search, select, toggle, checkbox, radio, slider.
          </span>
        </div>

        {/* 6 States Matrix for TextInput */}
        <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            TextInput · 6 Interaction States
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="input-rest">Input (Rest)</Label>
              <Input id="input-rest" type="text" />
              <span className="text-[10px] text-muted-foreground">Rest on paper shell</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="input-hover">Input (Hover)</Label>
              <Input id="input-hover" type="text" className="bg-background border-hover-border" />
              <span className="text-[10px] text-muted-foreground">White fill on hover</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="input-focus">Input (Focus)</Label>
              <Input id="input-focus" type="text" className="border-primary bg-background shadow-ring" />
              <span className="text-[10px] text-muted-foreground">Green focus ring</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="input-filled">Input (Filled)</Label>
              <Input id="input-filled" type="text" defaultValue="System Studio Service" />
              <span className="text-[10px] text-muted-foreground">White fill with value</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="input-invalid">Input (Invalid)</Label>
              <Input
                id="input-invalid"
                type="text"
                defaultValue="invalid:service:id"
                aria-invalid="true"
                aria-describedby="input-invalid-error"
              />
              <span id="input-invalid-error" className="text-[10px] text-risk-text font-medium">
                Invalid service identifier
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="input-disabled">Input (Disabled)</Label>
              <Input
                id="input-disabled"
                type="text"
                defaultValue="Immutable checkpoint payload"
                disabled
              />
              <span className="text-[10px] text-muted-foreground">Sunken stone read-only</span>
            </div>
          </div>
        </div>

        {/* SearchField, Stepper, Select */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-border rounded-lg bg-panel p-5 space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              SearchField
            </h3>
            <SearchField
              value={searchValue}
              onChange={setSearchValue}
              onClear={() => setSearchValue("")}
              shortcut="⌘K"
            />
            <SearchField
              value="Ingestion"
              onChange={() => {}}
              onClear={() => {}}
              shortcut="P"
            />
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Stepper
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs">Replicas:</span>
                <Stepper value={stepperVal} min={1} max={20} onChange={setStepperVal} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Disabled:</span>
                <Stepper value={3} disabled />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Select &amp; Native Select
            </h3>
            <div className="space-y-3">
              <div>
                <Label htmlFor="specimen-select-trigger" className="text-xs">Radix Select</Label>
                <Select defaultValue="postgres">
                  <SelectTrigger id="specimen-select-trigger" aria-label="Database Engine" className="mt-1">
                    <SelectValue placeholder="Select an engine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postgres">PostgreSQL (Relational)</SelectItem>
                    <SelectItem value="redis">Redis (In-Memory Cache)</SelectItem>
                    <SelectItem value="kafka">Apache Kafka (Event Stream)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="specimen-native-select" className="text-xs">Native Select</Label>
                <NativeSelect id="specimen-native-select" defaultValue="node20" aria-label="Runtime Target" className="mt-1">
                  <NativeSelectOption value="node20">Node.js 20 LTS</NativeSelectOption>
                  <NativeSelectOption value="python312">Python 3.12</NativeSelectOption>
                  <NativeSelectOption value="go122">Go 1.22</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
          </div>
        </div>

        {/* Selection Controls: Checkbox, Radio, Switch, Slider */}
        <div className="border border-border rounded-lg bg-panel p-6 space-y-6">
          <h3 id="heading-selection-controls" className="text-lg font-semibold tracking-normal text-foreground">
            Selection Controls
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {/* Checkbox */}
            <div className="space-y-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Checkbox</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="checkbox-off" />
                  <Label htmlFor="checkbox-off">Automated failover (Off)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="checkbox-on" defaultChecked />
                  <Label htmlFor="checkbox-on">Telemetry collection (On)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="checkbox-mixed" checked="indeterminate" />
                  <Label htmlFor="checkbox-mixed">Retry policy (Mixed)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="checkbox-disabled-off" disabled />
                  <Label htmlFor="checkbox-disabled-off">Replication (Disabled)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="checkbox-disabled-on" defaultChecked disabled />
                  <Label htmlFor="checkbox-disabled-on">Kernel persistence (Disabled On)</Label>
                </div>
              </div>
            </div>

            {/* Radio */}
            <div className="space-y-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Radio Group</h4>
              <RadioGroup defaultValue="radio-on">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="radio-off" id="radio-off" />
                  <Label htmlFor="radio-off">Round-robin (Off)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="radio-on" id="radio-on" />
                  <Label htmlFor="radio-on">Least-conn (On)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="radio-disabled" id="radio-disabled" disabled />
                  <Label htmlFor="radio-disabled">Adaptive (Disabled)</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Switch */}
            <div className="space-y-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Toggle / Switch</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <Switch id="switch-off" aria-label="Debug logging (Off)" />
                  <Label htmlFor="switch-off">Debug logging (Off)</Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch id="switch-on" defaultChecked aria-label="Metrics export (On)" />
                  <Label htmlFor="switch-on">Metrics export (On)</Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch id="switch-disabled" disabled aria-label="Audit trace (Disabled)" />
                  <Label htmlFor="switch-disabled">Audit trace (Disabled)</Label>
                </div>
              </div>
            </div>

            {/* Slider */}
            <div className="space-y-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Slider</h4>
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <Label htmlFor="specimen-slider">Traffic Capacity</Label>
                    <span className="font-mono text-secondary-text">{sliderVal[0]}%</span>
                  </div>
                  <Slider
                    id="specimen-slider"
                    aria-label="Traffic Capacity"
                    value={sliderVal}
                    onValueChange={setSliderVal}
                    max={100}
                    step={1}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Disabled:</span>
                    <span className="font-mono">30%</span>
                  </div>
                  <Slider defaultValue={[30]} disabled />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Textareas */}
        <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Textarea States
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="textarea-rest">Textarea (Rest)</Label>
              <Textarea id="textarea-rest" defaultValue="Primary raft consensus cluster with 3 replicas." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="textarea-placeholder">Textarea (Placeholder)</Label>
              <Textarea id="textarea-placeholder" placeholder="Describe architectural constraints..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="textarea-disabled">Textarea (Disabled)</Label>
              <Textarea id="textarea-disabled" defaultValue="Archived execution log." disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="textarea-invalid">Textarea (Invalid)</Label>
              <Textarea id="textarea-invalid" defaultValue="queue_capacity: -100" aria-invalid="true" />
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          07 NAVIGATION
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-tabs" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">07</span>
          <h2 id="heading-tabs" className="text-2xl font-display font-normal text-foreground">
            Tabs
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Tabs, Segmented control, RailItem, Breadcrumbs, DropdownMenu.
          </span>
        </div>

        {/* Underline Tabs */}
        <div className="space-y-4">
          <Tabs defaultValue="tab-overview" className="w-full">
            <TabsList>
              <TabsTrigger value="tab-overview">Overview</TabsTrigger>
              <TabsTrigger value="tab-performance">Performance</TabsTrigger>
              <TabsTrigger value="tab-settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="tab-overview" className="p-4 border border-border rounded-md mt-2 bg-panel text-xs text-secondary-text">
              Overview content for the selected architecture scenario.
            </TabsContent>
            <TabsContent value="tab-performance" className="p-4 border border-border rounded-md mt-2 bg-panel text-xs text-secondary-text">
              Performance metrics: throughput, 95th percentile latency, queue depth.
            </TabsContent>
            <TabsContent value="tab-settings" className="p-4 border border-border rounded-md mt-2 bg-panel text-xs text-secondary-text">
              Settings: concurrency limits, circuit breaker timeouts, retry budgets.
            </TabsContent>
          </Tabs>
        </div>

        {/* Segmented Control & RailItem */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Segmented Control
            </h3>
            <div className="flex items-center gap-4">
              <Segmented
                value={segValue}
                onChange={setSegValue}
                options={[
                  { id: "grid", label: "Grid View" },
                  { id: "list", label: "List View" },
                  { id: "split", label: "Split View" },
                ]}
              />
            </div>
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Rail Items · Outer Spine on Active
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-12 py-2 rounded-md flex flex-col items-center gap-1 bg-accent relative text-accent-foreground">
                <span className="absolute -left-1 top-2.5 bottom-2.5 w-0.5 bg-primary rounded-full" />
                <Library className="size-4" />
                <span className="font-mono text-[9.5px]">PARTS</span>
              </div>
              <div className="w-12 py-2 rounded-md flex flex-col items-center gap-1 hover:bg-sunken text-secondary-text">
                <Sparkles className="size-4" />
                <span className="font-mono text-[9.5px]">AI</span>
              </div>
              <div className="w-12 py-2 rounded-md flex flex-col items-center gap-1 hover:bg-sunken text-secondary-text">
                <SlidersHorizontal className="size-4" />
                <span className="font-mono text-[9.5px]">RUNS</span>
              </div>
            </div>
          </div>
        </div>

        {/* Breadcrumb & DropdownMenu */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Breadcrumb
            </h3>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#projects">Projects</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href="#system-studio">System Studio</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Checkout Architecture</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Dropdown Menu · Standardized Structure
            </h3>
            <div className="flex flex-wrap items-start gap-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button">Open Menu</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  <DropdownMenuHeader>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] font-semibold text-secondary-text">
                      Project Actions
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground">v2.0</span>
                  </DropdownMenuHeader>
                  <DropdownMenuItem>
                    <Plus className="size-3.5 text-secondary-text" aria-hidden="true" />
                    <span>New Subsystem</span>
                    <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy className="size-3.5 text-secondary-text" aria-hidden="true" />
                    <span>Duplicate Node</span>
                    <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Download className="size-3.5 text-secondary-text" aria-hidden="true" />
                      <span>Export Model</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem>Export as JSON</DropdownMenuItem>
                      <DropdownMenuItem>Export as SVG</DropdownMenuItem>
                      <DropdownMenuItem>Export as Mermaid</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />
                    <span>Delete Scenario</span>
                    <DropdownMenuShortcut className="text-destructive font-mono text-[10px]">⌦</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuFooter>
                    <span className="text-secondary-text text-[11px]">System Studio</span>
                    <span className="font-mono text-[10px] text-primary">⌘K</span>
                  </DropdownMenuFooter>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Declarative DropdownMenuPanel Preview */}
              <DropdownMenuPanel
                heading="NODE CONTEXT MENU"
                width={250}
                items={[
                  { icon: <Plus className="size-3.5" />, label: "Add probe", shortcut: "P" },
                  { icon: <Copy className="size-3.5" />, label: "Save to library", selected: true },
                  { divider: true },
                  { icon: <Trash2 className="size-3.5" />, label: "Delete node", danger: true, shortcut: "⌦" },
                ]}
                footer={
                  <div className="flex items-center justify-between w-full text-[11px] text-secondary-text">
                    <span>1 node selected</span>
                    <span className="font-mono text-[9.5px]">ESC</span>
                  </div>
                }
              />
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          08 FEEDBACK
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-alerts" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">08</span>
          <h2 id="heading-alerts" className="text-2xl font-display font-normal text-foreground">
            Alerts
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            InlineAlert, Toast, Tooltip, Meter, EmptyState, Spinner.
          </span>
        </div>

        {/* InlineAlert 3 Tones */}
        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            InlineAlert · 3 Coloured Spine Tones
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InlineAlert
              tone="risk"
              glyph="⚠"
              title="Tail latency exceeded SLA"
              detail="p99 reached 1,240ms under 5k concurrent users."
            />
            <InlineAlert
              tone="branch"
              glyph="⌥"
              title="Simulation divergent"
              detail="Branch checkout-v2 diverged from baseline."
            />
            <InlineAlert
              tone="done"
              glyph="✓"
              title="Checkpoint verified"
              detail="All invariants and assertions satisfied."
            />
          </div>
        </div>

        {/* Standard Alerts for legacy test coverage */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Alert variant="default">
            <AlertTitle>Default Alert</AlertTitle>
            <AlertDescription>
              Architecture simulation checkpoint created successfully. All invariants satisfied.
            </AlertDescription>
          </Alert>

          <Alert variant="destructive">
            <AlertTitle>Destructive Alert</AlertTitle>
            <AlertDescription>
              Critical bottleneck detected: downstream message queue exceeded capacity limit.
            </AlertDescription>
          </Alert>
        </div>

        {/* Toast, Tooltip, Overlays */}
        <div className="border border-border rounded-lg bg-panel p-6 space-y-6">
          <h3 id="heading-overlays" className="text-lg font-semibold tracking-normal text-foreground">
            Overlays
          </h3>

          <div className="flex flex-wrap items-center gap-4">
            {/* Dialog */}
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button">Open Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Checkpoint</DialogTitle>
                  <DialogDescription>
                    This will create an immutable checkpoint snapshot of the current architecture model.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="button">Save Checkpoint</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button">Open Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Branch Configuration</h4>
                  <p className="text-xs text-muted-foreground">
                    Select target branch to compare simulation metrics against the baseline.
                  </p>
                </div>
              </PopoverContent>
            </Popover>

            {/* Tooltip */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button">Hover for Tooltip</Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Simulate workload over 10,000 requests</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* HoverCard */}
            <HoverCard>
              <HoverCardTrigger asChild>
                <Button type="button" variant="link" className="p-0 h-auto text-xs">
                  @architecture-team
                </Button>
              </HoverCardTrigger>
              <HoverCardContent>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold">Core Architecture Team</h4>
                  <p className="text-xs text-secondary-text">
                    Owners of cluster topology and resilience checkpoints.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>

          {/* Toast Notification Preview */}
          <div className="pt-2">
            <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
              Canvas Toast · Ink Fill &amp; Green Action
            </h4>
            <ToastProvider>
              <div className="max-w-md">
                <Toast open={true}>
                  <div className="grid gap-0.5">
                    <ToastTitle>Simulation Completed</ToastTitle>
                    <ToastDescription>
                      10,000 requests processed with 0 errors.
                    </ToastDescription>
                  </div>
                  <ToastAction altText="View details">View runs</ToastAction>
                  <ToastClose />
                </Toast>
              </div>
              <ToastViewport className="static relative z-auto flex max-w-md flex-col p-0 top-auto sm:static sm:bottom-auto sm:right-auto sm:top-auto" />
            </ToastProvider>
          </div>
        </div>

        {/* Meters & EmptyState */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Meter Components
            </h3>
            <div className="space-y-4">
              <Meter label="THROUGHPUT" percent={68} readout="680 req/s" tone="green" />
              <Meter label="QUEUE DEPTH" percent={92} readout="920 / 1000" tone="clay" />
              <Meter label="CPU CORE" percent={34} readout="34%" tone="green" />
            </div>
          </div>

          <div className="border border-border rounded-lg bg-panel p-5 space-y-4">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              EmptyState
            </h3>
            <EmptyState
              glyph="⊞"
              title="No simulated runs yet"
              detail="Connect components and run the discrete-event simulator to generate performance traces."
            >
              <Button type="button" size="sm">Start Simulation</Button>
            </EmptyState>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          09 SURFACES & PANELS
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-surfaces" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">09</span>
          <h2 id="heading-surfaces" className="text-2xl font-display font-normal text-foreground">
            Surfaces &amp; Panels
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Inspector panel preview, LibraryRow in 6 states, AvatarStack.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LibraryRow 6 States */}
          <div className="border border-border rounded-lg bg-panel p-5 space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              LibraryRow · 6 Interaction States
            </h3>
            <div className="space-y-2">
              <LibraryRow state="rest" title="Redis Cache Cluster" meta="DATA · IN-MEMORY LRU" />
              <LibraryRow state="hover" title="PostgreSQL Replica" meta="DATA · RELATIONAL" />
              <LibraryRow state="selected" title="Event Broker (Kafka)" meta="MESSAGING · PARTITIONED" />
              <LibraryRow state="dragging" title="API Gateway" meta="EDGE · RATE-LIMITED" />
              <LibraryRow state="disabled" title="Legacy Auth Service" meta="COMPUTE · DEPRECATED" />
              <LibraryRow state="loading" />
            </div>
          </div>

          {/* AvatarStack & Inspector Header */}
          <div className="space-y-6">
            <div className="border border-border rounded-lg bg-panel p-5 space-y-3">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                AvatarStack · Collaborator Overlay
              </h3>
              <div className="space-y-4">
                <AvatarStack people={["AJ", "CL", "SS"]} overflow={4} label="7 architects active" />
                <AvatarStack people={["MK", "TR"]} label="2 editors reviewing" />
              </div>
            </div>

            <div className="border border-border rounded-lg bg-panel p-5 space-y-3">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Card &amp; ScrollArea Preview
              </h3>
              <Card>
                <CardHeader>
                  <CardTitle>Subsystem Node</CardTitle>
                  <CardDescription>Order ingestion and dispatch service</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-20 w-full rounded border p-2">
                    <div className="space-y-1 font-mono text-xs">
                      <p>[0.000s] Simulation started (seed: 42)</p>
                      <p>[0.012s] Load balancer initialized</p>
                      <p>[0.045s] Traffic generator emitting 1,000 req/s</p>
                      <p>[0.100s] Cache hit ratio: 94.2%</p>
                    </div>
                  </ScrollArea>
                </CardContent>
                <CardFooter>
                  <Button type="button" variant="secondary" size="sm">
                    Inspect Node
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          10 CANVAS COMPONENTS
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-canvas" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">10</span>
          <h2 id="heading-canvas" className="text-2xl font-display font-normal text-foreground">
            Canvas Components
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            Component node, Sticky note, Boundary frame, Floating dock.
          </span>
        </div>

        <div className="border border-border rounded-lg bg-panel p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            {/* Component Node Preview */}
            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Component Node
              </span>
              <div className="rounded-node border border-control-border bg-background p-3 relative shadow-2xs hover:shadow-lifted transition-all">
                <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-node bg-[#56773A]" />
                <div className="flex items-center justify-between text-xs font-semibold mt-1">
                  <span>Order Worker</span>
                  <Badge variant="neutral" className="text-[9px] py-0">COMPUTE</Badge>
                </div>
                <p className="text-[11px] text-secondary-text mt-1.5">
                  Processes orders from Kafka queue.
                </p>
                <div className="mt-3 pt-2 border-t border-hairline flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span>in: events</span>
                  <span>out: records</span>
                </div>
              </div>
            </div>

            {/* Sticky Note Preview */}
            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Sticky Note
              </span>
              <div className="rounded-card border border-note-edge bg-note p-3 text-xs leading-relaxed shadow-raised">
                <p className="font-medium text-foreground">Consensus Invariant:</p>
                <p className="text-body mt-1">
                  Ensure leader election timeout exceeds heartbeat interval by at least 3×.
                </p>
              </div>
            </div>

            {/* Boundary Frame Preview */}
            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Boundary / Group
              </span>
              <div className="rounded-card border-2 border-dashed border-border bg-background/50 p-4 h-28 flex flex-col justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Ingestion Subsystem
                </span>
                <span className="text-xs text-secondary-text">
                  3 services inside boundary
                </span>
              </div>
            </div>
          </div>

          {/* Floating Dock Preview */}
          <div className="space-y-2 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Floating Dock
            </span>
            <div className="rounded-dock border border-border bg-background p-1 shadow-floating inline-flex items-center gap-1">
              <Button type="button" variant="tint" size="sm" className="h-7 px-2.5">
                <MousePointer className="size-3.5 mr-1" /> Select
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5">
                <Hand className="size-3.5 mr-1" /> Pan
              </Button>
              <span className="w-px h-4 bg-hairline mx-1" />
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5">
                <Library className="size-3.5 mr-1" /> Library
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5">
                <StickyNote className="size-3.5 mr-1" /> Note
              </Button>
              <span className="w-px h-4 bg-hairline mx-1" />
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2">
                <Maximize2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ──────────────────────────────────────────────────────────
          11 RULES OF USE
          ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="heading-rules" className="space-y-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">11</span>
          <h2 id="heading-rules" className="text-2xl font-display font-normal text-foreground">
            Rules of Use
          </h2>
          <span className="text-xs text-secondary-text hidden sm:inline">
            System invariants, accessibility constraints, and design rules.
          </span>
        </div>

        <div className="border border-border rounded-lg bg-panel p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground text-sm">System Invariants</h4>
              <ul className="space-y-2 text-secondary-text list-disc list-inside">
                <li><strong className="text-foreground">Single-source tokens:</strong> All colours, shadows, and radii originate in <code className="font-mono text-[10px]">tokens.ts</code>.</li>
                <li><strong className="text-foreground">Light-only canvas:</strong> Paper shell <code className="font-mono text-[10px]">#FBFAF7</code>, panel <code className="font-mono text-[10px]">#F7F5F1</code>, white cards. No dark mode.</li>
                <li><strong className="text-foreground">Accessible boundaries:</strong> Field borders reach ≥3:1 against canvas, shell, and panel.</li>
                <li><strong className="text-foreground">Accessible text:</strong> Secondary text <code className="font-mono text-[10px]">#626D68</code> reaches ≥4.5:1 on panel surface.</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-foreground text-sm">Interaction Rules</h4>
              <ul className="space-y-2 text-secondary-text list-disc list-inside">
                <li><strong className="text-foreground">Field fill state:</strong> A field rests on paper shell and turns white once it holds a value.</li>
                <li><strong className="text-foreground">Focus outlines:</strong> 2px solid rings, never hidden, color-matched to component tone.</li>
                <li><strong className="text-foreground">Restrained motion:</strong> Panels snap instantly; spinners rotate at 0.8s on <code className="font-mono text-[10px]">currentColor</code>. Nothing bounces.</li>
                <li><strong className="text-foreground">Touch targets:</strong> Pointer-coarse minimum size is 44px for accessible mobile interaction.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Legacy Command, Progress, Resizable coverage to keep tests passing */}
      <section className="space-y-6 pt-4 border-t border-hairline">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Auxiliary Layout &amp; Command Primitives
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Command */}
          <div className="space-y-2">
            <Label className="text-xs">Command Palette</Label>
            <Command value="" className="rounded-lg border border-border shadow-xs">
              <CommandInput placeholder="Search services..." />
              <CommandList>
                <CommandEmpty>No services found.</CommandEmpty>
                <CommandGroup heading="Services">
                  <CommandItem>
                    <span>Ingestion Worker</span>
                    <CommandShortcut>⌘1</CommandShortcut>
                  </CommandItem>
                  <CommandItem>
                    <span>Event Broker</span>
                    <CommandShortcut>⌘2</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </div>

          {/* Progress */}
          <div className="space-y-3">
            <Label className="text-xs">Progress Bars</Label>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <Label htmlFor="specimen-progress-determinate">Determinate (40%)</Label>
                <span className="font-mono text-secondary-text">40%</span>
              </div>
              <Progress
                id="specimen-progress-determinate"
                value={40}
                aria-label="Determinate progress 40%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="specimen-progress-indeterminate">Indeterminate</Label>
              <Progress
                id="specimen-progress-indeterminate"
                aria-label="Indeterminate progress"
              />
            </div>
          </div>

          {/* Resizable */}
          <div className="space-y-2">
            <Label className="text-xs">Resizable Panels</Label>
            <div className="h-28 rounded-md border border-border overflow-hidden">
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize={50} minSize={20}>
                  <div className="flex h-full items-center justify-center p-2 text-xs text-secondary-text bg-card">
                    Topology
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={20}>
                  <div className="flex h-full items-center justify-center p-2 text-xs text-secondary-text bg-card">
                    Telemetry
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Specimen;
