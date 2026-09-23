import * as React from "react";
import { Settings } from "lucide-react";
import { evergreen } from "@/components/studio/tokens";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
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
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
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
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

  return (
    <div className="min-h-screen bg-background text-foreground p-8 max-w-6xl mx-auto space-y-12">
      <header className="space-y-2 border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight">System Studio Component Specimen</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic review page for shadcn primitives and Evergreen design tokens.
        </p>
      </header>

      {/* (a) Colour tokens */}
      <section aria-labelledby="heading-colours" className="space-y-4">
        <h2 id="heading-colours" className="text-xl font-semibold tracking-tight">
          Colour Tokens
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {colorEntries.map(([name, hex]) => (
            <div key={name} className="flex flex-col gap-1.5 border p-2.5 rounded-md bg-card">
              <div
                className="h-10 w-full rounded border border-border"
                style={{ backgroundColor: hex }}
              />
              <span className="font-mono text-xs font-medium truncate">{name}</span>
              <span className="font-mono text-xs text-muted-foreground">{hex}</span>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* (b) Radii */}
      <section aria-labelledby="heading-radii" className="space-y-4">
        <h2 id="heading-radii" className="text-xl font-semibold tracking-tight">
          Radii
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {radiusEntries.map(([name, val]) => (
            <div key={name} className="flex flex-col gap-1.5 border p-2.5 rounded-md bg-card">
              <div
                className="h-14 w-full border-2 border-primary bg-muted flex items-center justify-center font-mono text-xs font-semibold"
                style={{ borderRadius: `${val}px` }}
              >
                {val}px
              </div>
              <span className="font-mono text-xs font-medium">{name}</span>
              <span className="font-mono text-xs text-muted-foreground">{val}px</span>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* (c) Typography */}
      <section aria-labelledby="heading-typography" className="space-y-4">
        <h2 id="heading-typography" className="text-xl font-semibold tracking-tight">
          Typography
        </h2>
        <div className="grid gap-6 border p-6 rounded-lg bg-card">
          <div
            className="font-sans space-y-1"
            style={{
              fontFamily:
                'var(--font-sans, "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
            }}
          >
            <p className="text-xs font-mono text-muted-foreground">
              font-sans: var(--font-sans, &quot;IBM Plex Sans&quot;)
            </p>
            <h3 className="text-lg font-semibold">
              The quick brown fox jumps over the lazy dog
            </h3>
            <p className="text-sm text-secondary-text">
              Evergreen paper foundation with light-only surfaces, high-contrast text, and hairline borders.
            </p>
          </div>

          <div
            className="font-mono space-y-1"
            style={{
              fontFamily:
                'var(--font-mono, "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace)',
            }}
          >
            <p className="text-xs font-mono text-muted-foreground">
              font-mono: var(--font-mono, &quot;IBM Plex Mono&quot;)
            </p>
            <p className="text-sm font-medium">
              p95: 142ms | throughput: 2,450 req/s | error-rate: 0.0012 | memory: 512MB
            </p>
            <p className="text-xs text-muted-foreground">
              0123456789 ABCDEF +-*= /%$#@! [] {} ()
            </p>
          </div>

          <div
            className="font-display space-y-1"
            style={{
              fontFamily: 'var(--font-display, "Newsreader", Georgia, serif)',
            }}
          >
            <p className="text-xs font-mono text-muted-foreground">
              font-display: var(--font-display, &quot;Newsreader&quot;)
            </p>
            <h3 className="text-2xl font-normal italic">
              Architectural intent and discrete-event system simulation
            </h3>
            <p className="text-sm text-secondary-text">
              System Studio Directions — Evergreen Scheme (18C)
            </p>
          </div>
        </div>
      </section>

      <Separator />

      {/* (d) Button */}
      <section aria-labelledby="heading-buttons" className="space-y-6">
        <h2 id="heading-buttons" className="text-xl font-semibold tracking-tight">
          Buttons
        </h2>
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
            <h3 className="text-sm font-medium text-muted-foreground">Loading States</h3>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="default" loading>
                Running
              </Button>
              <Button type="button" variant="secondary" loading>
                Working
              </Button>
              <Button type="button" variant="tint" loading>
                Working
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
      </section>

      <Separator />

      {/* (e) Input and Textarea */}
      <section aria-labelledby="heading-inputs" className="space-y-6">
        <h2 id="heading-inputs" className="text-xl font-semibold tracking-tight">
          Inputs &amp; Textareas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Input States</h3>
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="input-rest">Input (Rest)</Label>
                <Input id="input-rest" type="text" defaultValue="System Studio Service" />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="input-placeholder">Input (Placeholder)</Label>
                <Input
                  id="input-placeholder"
                  type="text"
                  placeholder="Enter subsystem name..."
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="input-disabled">Input (Disabled)</Label>
                <Input
                  id="input-disabled"
                  type="text"
                  defaultValue="Immutable checkpoint payload"
                  disabled
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="input-invalid">Input (Invalid)</Label>
                <Input
                  id="input-invalid"
                  type="text"
                  defaultValue="invalid:service:id"
                  aria-invalid="true"
                  aria-describedby="input-invalid-error"
                />
                <span
                  id="input-invalid-error"
                  role="alert"
                  className="text-xs text-destructive font-medium"
                >
                  Service identifier cannot contain colons
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Textarea States</h3>
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="textarea-rest">Textarea (Rest)</Label>
                <Textarea
                  id="textarea-rest"
                  defaultValue="Primary raft consensus cluster with 3 replicas and dynamic leader election."
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="textarea-placeholder">Textarea (Placeholder)</Label>
                <Textarea
                  id="textarea-placeholder"
                  placeholder="Describe architectural constraints and requirements..."
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="textarea-disabled">Textarea (Disabled)</Label>
                <Textarea
                  id="textarea-disabled"
                  defaultValue="Archived execution log and transaction traces (read-only)."
                  disabled
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="textarea-invalid">Textarea (Invalid)</Label>
                <Textarea
                  id="textarea-invalid"
                  defaultValue="queue_capacity: -100"
                  aria-invalid="true"
                  aria-describedby="textarea-invalid-error"
                />
                <span
                  id="textarea-invalid-error"
                  role="alert"
                  className="text-xs text-destructive font-medium"
                >
                  Queue capacity must be a positive integer
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* (f) Checkbox, RadioGroup, Switch */}
      <section aria-labelledby="heading-selection-controls" className="space-y-6">
        <h2 id="heading-selection-controls" className="text-xl font-semibold tracking-tight">
          Selection Controls
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Checkbox</h3>
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
                <Checkbox id="checkbox-disabled-off" disabled />
                <Label htmlFor="checkbox-disabled-off">Replication factor (Disabled Off)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="checkbox-disabled-on" defaultChecked disabled />
                <Label htmlFor="checkbox-disabled-on">Kernel persistence (Disabled On)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="checkbox-mixed" checked="indeterminate" />
                <Label htmlFor="checkbox-mixed">Retry policy (Mixed)</Label>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Radio Group</h3>
            <RadioGroup defaultValue="radio-on">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="radio-off" id="radio-off" />
                <Label htmlFor="radio-off">Round-robin routing (Off)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="radio-on" id="radio-on" />
                <Label htmlFor="radio-on">Least-connections routing (On)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="radio-disabled" id="radio-disabled" disabled />
                <Label htmlFor="radio-disabled">Adaptive latency routing (Disabled)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Switch</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch id="switch-off" />
                <Label htmlFor="switch-off">Debug logging (Off)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="switch-on" defaultChecked />
                <Label htmlFor="switch-on">Real-time simulation (On)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="switch-disabled-off" disabled />
                <Label htmlFor="switch-disabled-off">Experimental optimizer (Disabled Off)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="switch-disabled-on" defaultChecked disabled />
                <Label htmlFor="switch-disabled-on">Deterministic execution (Disabled On)</Label>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* (g) Tabs */}
      <section aria-labelledby="heading-tabs" className="space-y-4">
        <h2 id="heading-tabs" className="text-xl font-semibold tracking-tight">
          Tabs
        </h2>
        <Tabs defaultValue="tab-overview" className="w-full">
          <TabsList>
            <TabsTrigger value="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="tab-performance">Performance</TabsTrigger>
            <TabsTrigger value="tab-settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="tab-overview" className="p-4 border rounded-md mt-2 bg-card">
            Overview content for the selected architecture scenario.
          </TabsContent>
          <TabsContent value="tab-performance" className="p-4 border rounded-md mt-2 bg-card">
            Performance metrics: throughput, 95th percentile latency, queue depth.
          </TabsContent>
          <TabsContent value="tab-settings" className="p-4 border rounded-md mt-2 bg-card">
            Settings: concurrency limits, circuit breaker timeouts, retry budgets.
          </TabsContent>
        </Tabs>
      </section>

      <Separator />

      {/* (h) Badges */}
      <section aria-labelledby="heading-badges" className="space-y-4">
        <h2 id="heading-badges" className="text-xl font-semibold tracking-tight">
          Badges
        </h2>
        <div className="flex flex-wrap gap-2">
          {badgeVariantsList.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      </section>

      <Separator />

      {/* (i) Alerts */}
      <section aria-labelledby="heading-alerts" className="space-y-4">
        <h2 id="heading-alerts" className="text-xl font-semibold tracking-tight">
          Alerts
        </h2>
        <div className="space-y-4">
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
      </section>

      <Separator />

      {/* (j) Overlays */}
      <section aria-labelledby="heading-overlays" className="space-y-6">
        <h2 id="heading-overlays" className="text-xl font-semibold tracking-tight">
          Overlays
        </h2>
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

          {/* DropdownMenu with nested submenu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button">Open Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Project Actions</DropdownMenuLabel>
              <DropdownMenuItem>
                New Subsystem
                <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>Duplicate Node</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Export Model</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Export as JSON</DropdownMenuItem>
                  <DropdownMenuItem>Export as SVG</DropdownMenuItem>
                  <DropdownMenuItem>Export as Mermaid</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete Scenario</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
        </div>
      </section>

      <Separator />

      {/* Card & ScrollArea */}
      <section aria-labelledby="heading-cards" className="space-y-4">
        <h2 id="heading-cards" className="text-xl font-semibold tracking-tight">
          Cards &amp; Scroll Area
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Subsystem Node</CardTitle>
              <CardDescription>Order ingestion and dispatch service</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-secondary-text">
                Observed throughput: 1,840 req/s. 99th percentile response time: 24ms.
              </p>
            </CardContent>
            <CardFooter>
              <Button type="button" variant="secondary" size="sm">
                Inspect Node
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Execution Log</CardTitle>
              <CardDescription>Scrollable simulated trace events</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-28 w-full rounded border p-2">
                <div className="space-y-1 font-mono text-xs">
                  <p>[0.000s] Simulation started (seed: 42)</p>
                  <p>[0.012s] Load balancer initialized</p>
                  <p>[0.045s] Traffic generator emitting 1,000 req/s</p>
                  <p>[0.100s] Cache hit ratio: 94.2%</p>
                  <p>[0.250s] Autoscaler spun up 2 additional replicas</p>
                  <p>[0.500s] Checkpoint written to local store</p>
                  <p>[0.750s] Scenario completed successfully</p>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Kbd */}
      <section aria-labelledby="heading-kbd" className="space-y-4">
        <h2 id="heading-kbd" className="text-xl font-semibold tracking-tight">
          Keyboard Shortcuts (Kbd)
        </h2>
        <div className="flex flex-wrap items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-secondary-text">Command palette:</span>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-secondary-text">Copy node:</span>
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>C</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-secondary-text">Dismiss overlay:</span>
            <Kbd>Esc</Kbd>
          </div>
        </div>
      </section>

      <Separator />

      {/* Select */}
      <section aria-labelledby="heading-select" className="space-y-4">
        <h2 id="heading-select" className="text-xl font-semibold tracking-tight">
          Select (Radix)
        </h2>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="specimen-select-trigger">Database Engine</Label>
          <Select defaultValue="postgres">
            <SelectTrigger id="specimen-select-trigger" aria-label="Database Engine">
              <SelectValue placeholder="Select an engine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="postgres">PostgreSQL (Relational)</SelectItem>
              <SelectItem value="redis">Redis (In-Memory Cache)</SelectItem>
              <SelectItem value="kafka">Apache Kafka (Event Stream)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <Separator />

      {/* Native Select */}
      <section aria-labelledby="heading-native-select" className="space-y-4">
        <h2 id="heading-native-select" className="text-xl font-semibold tracking-tight">
          Native Select
        </h2>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="specimen-native-select">Runtime Target</Label>
          <NativeSelect id="specimen-native-select" defaultValue="node20" aria-label="Runtime Target">
            <NativeSelectOption value="node20">Node.js 20 LTS</NativeSelectOption>
            <NativeSelectOption value="python312">Python 3.12</NativeSelectOption>
            <NativeSelectOption value="go122">Go 1.22</NativeSelectOption>
          </NativeSelect>
        </div>
      </section>

      <Separator />

      {/* Slider */}
      <section aria-labelledby="heading-slider" className="space-y-4">
        <h2 id="heading-slider" className="text-xl font-semibold tracking-tight">
          Slider
        </h2>
        <div className="max-w-xs space-y-2">
          <div className="flex justify-between text-xs">
            <Label htmlFor="specimen-slider">Traffic Capacity</Label>
            <span className="font-mono text-secondary-text">65%</span>
          </div>
          <Slider
            id="specimen-slider"
            aria-label="Traffic Capacity"
            defaultValue={[65]}
            max={100}
            step={1}
          />
        </div>
      </section>

      <Separator />

      {/* Toggle & Toggle Group */}
      <section aria-labelledby="heading-toggle-group" className="space-y-4">
        <h2 id="heading-toggle-group" className="text-xl font-semibold tracking-tight">
          Toggle &amp; Toggle Group
        </h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Diagram Alignment (Single)</Label>
            <ToggleGroup type="single" defaultValue="center" aria-label="Diagram Alignment">
              <ToggleGroupItem value="left" aria-label="Align left">
                Left
              </ToggleGroupItem>
              <ToggleGroupItem value="center" aria-label="Align center">
                Center
              </ToggleGroupItem>
              <ToggleGroupItem value="right" aria-label="Align right">
                Right
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label>Standalone Toggle</Label>
            <div>
              <Toggle aria-label="Toggle pin state" defaultPressed>
                Pin Panel
              </Toggle>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* Breadcrumb */}
      <section aria-labelledby="heading-breadcrumb" className="space-y-4">
        <h2 id="heading-breadcrumb" className="text-xl font-semibold tracking-tight">
          Breadcrumb
        </h2>
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
      </section>

      <Separator />

      {/* Command */}
      <section aria-labelledby="heading-command" className="space-y-4">
        <h2 id="heading-command" className="text-xl font-semibold tracking-tight">
          Command
        </h2>
        <div className="max-w-md">
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
                <CommandItem>
                  <span>Storage Engine</span>
                  <CommandShortcut>⌘3</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </section>

      <Separator />

      {/* Progress */}
      <section aria-labelledby="heading-progress" className="space-y-4">
        <h2 id="heading-progress" className="text-xl font-semibold tracking-tight">
          Progress
        </h2>
        <div className="max-w-md space-y-4">
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
      </section>

      <Separator />

      {/* Resizable */}
      <section aria-labelledby="heading-resizable" className="space-y-4">
        <h2 id="heading-resizable" className="text-xl font-semibold tracking-tight">
          Resizable Panels
        </h2>
        <div className="max-w-md h-32 rounded-md border border-border overflow-hidden">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="flex h-full items-center justify-center p-4 text-xs text-secondary-text bg-card">
                Service Topology
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="flex h-full items-center justify-center p-4 text-xs text-secondary-text bg-card">
                Telemetry Stream
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </section>

      <Separator />

      {/* HoverCard */}
      <section aria-labelledby="heading-hover-card" className="space-y-4">
        <h2 id="heading-hover-card" className="text-xl font-semibold tracking-tight">
          Hover Card
        </h2>
        <div>
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
      </section>

      <Separator />

      {/* Toast */}
      <section aria-labelledby="heading-toast" className="space-y-4">
        <h2 id="heading-toast" className="text-xl font-semibold tracking-tight">
          Toast
        </h2>
        <ToastProvider>
          <div className="max-w-md">
            <Toast open={true}>
              <div className="grid gap-1">
                <ToastTitle>Simulation Completed</ToastTitle>
                <ToastDescription>
                  10,000 requests processed with 0 errors.
                </ToastDescription>
              </div>
              <ToastAction altText="View details">Details</ToastAction>
              <ToastClose />
            </Toast>
          </div>
          <ToastViewport className="static relative z-auto flex max-w-md flex-col p-0 top-auto sm:static sm:bottom-auto sm:right-auto sm:top-auto" />
        </ToastProvider>
      </section>
    </div>
  );
}

export default Specimen;
