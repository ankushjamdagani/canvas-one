---
name: System studio
description: A light docked workspace for learning architecture through seeded simulation.
colors:
  paper: "#fff"
  canvas: "#fafbf9"
  line: "#e1e7e3"
  ink: "#243b41"
  muted: "#677773"
  teal: "#087f84"
  teal-soft: "#e4f3f0"
  amber: "#a76108"
  amber-soft: "#fff3df"
  teal-hover: "#086b70"
  small-text: "#5e7267"
  canvas-dots: "#d6e0dc"
typography:
  headline:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "23px"
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: "-0.8px"
  title:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "12px"
    lineHeight: 1.7
  node-label:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "11px"
    fontWeight: 650
  metric:
    fontFamily: '"Inter Variable", sans-serif'
    fontSize: "18px"
    fontWeight: 550
    letterSpacing: "-0.4px"
rounded:
  tag: "4px"
  control: "6px"
  guide: "8px"
  node: "9px"
  panel: "10px"
spacing:
  control-gap: "7px"
  node-gap: "12px"
  guide-padding: "16px"
  inspector-padding: "23px 20px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 19px"
  button-primary-hover:
    backgroundColor: "{colors.teal-hover}"
  button-default:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 11px"
  component-node:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node}"
    padding: "22px 15px"
    width: "215px"
  warning-tag:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.tag}"
    padding: "5px 7px"
---

# Design System: System studio

## Overview

**Creative North Star: "Light docked workspace A"**

The selected light docked workspace keeps architecture, configuration and observed results in one working surface. Warm white material, a quiet dotted canvas, compact cards and restrained teal and amber support learning through changes and replay.

Operate mode is the dominant interaction posture: edit the graph, inspect a component, run a seeded workload and compare the result. Density belongs in useful controls and measurements, while the central graph retains room to pan.

**Key Characteristics:**

- Left library, central graph, right inspector and slim bottom metrics.
- Warm white surfaces with fine borders and limited elevation.
- Compact Inter typography and tabular numerical measurements.
- Teal for action and selection; amber for pressure and warnings.

## Colors

Teal and amber sit against warm near-white surfaces with green-gray dividers and dark blue-green ink. Frontmatter values are extracted from `src/styles.css` and `ArchitectureCanvas.tsx`; CSS remains the implementation source of truth.

- Primary: `teal` identifies the run action, selection, focus and suggestions. `teal-soft` provides a quiet action tint; `teal-hover` darkens the primary button on hover.
- Secondary: `amber` and `amber-soft` signal predicted overload, observed queue pressure and validation. Pair status color with words or icons.
- Neutral: `paper` supplies panels and cards, `canvas` the graph field, `line` dock separators, `ink` primary text and `muted` secondary copy. The `small-text` override strengthens small captions. `canvas-dots` is the graph grid color.

## Typography

Inter Variable with sans-serif fallback is the implemented family throughout. Its use matches the selected reference; preserve it. Root text is 13px. The experiment heading uses the headline role; panel headings use 14px/600, inspector explanation headings 20px/500 with 1.5 line height, and component labels 11px/650. Body paragraphs use 12px with 1.7 line height; inspector copy is usually 11px. Small captions range from 8px to 10px and use stronger secondary ink where overridden.

Measurements use tabular numerals. Main metric values are 18px/550; units are smaller and visually secondary. No display type or decorative font is implemented.

## Layout

Desktop is a viewport-height three-column grid: 218px library, flexible central workspace with a 360px minimum, and 284px inspector. Minimum studio height is 650px. Library and inspector scroll independently. The center stacks toolbar, graph, experiment guide and a slim metrics strip. The graph has a 20px dotted grid with 1px dots; node cards are 215px wide with 12px internal gaps. Heading placement is 34px from the graph top and 33px from the left. Metrics use an 88px minimum row with 14px 24px padding.

At 1600px and above, docks become 234px and 310px. At 1200px and below, they become 185px and 252px and secondary toolbar text recedes. At 900px and below, the library is 150px wide and the inspector moves below the central workspace. At 560px and below, the interface becomes a vertical document: compact horizontal library, 620px workspace, metrics and full-width inspector. Inspector fields share two columns; metric detail sections stack.

Mobile initially centers a readable node at 0.9 zoom, allows a minimum zoom of 0.6 and provides a pan hint. It does not fit the whole architecture into a tiny overview. Adding nodes recenters on the selected node. Checkpoints use a native details/summary disclosure, initially closed on mobile and open on larger screens. On mobile its expanded list is capped at 120px and the save controls remain accessible.

## Elevation & Depth

Docked surfaces and graph cards rely on fine borders and tonal separation. Floating project and assumptions panels, toasts and errors alone use `0 12px 35px #203d3521`. The selected node uses a teal border and a 2px pale outline offset by 2px. Default nodes have no shadow.

## Shapes

Controls and inputs use 6px corners, tags 4px, experiment guides 8px, nodes 9px and floating panels 10px. Most surfaces use a 1px border. Circular forms are reserved for status dots, traffic icons, connection handles and warning badges. Compact line icons accompany labels and controls.

## Components

- **Library:** bordered rows introduce traffic, service, database and cache components. Project selection sits above; checkpoints and assumptions remain nearby.
- **Toolbar:** neutral history/reset controls and one teal run/pause action. Autosave status remains a small operational cue.
- **Graph node:** icon, name, configured rate/capacity and an external footnote. Before a run, footnotes describe the model; after a run, they show observed queue and utilization. An amber border and alert icon mark observed utilization above 95%.
- **Connections:** smooth directed teal edges label configured-rate calculations with `expected`. Running edges animate; selection is amber. These labels are predictions, not measured throughput.
- **Inspector:** configuration and explanation tabs share a dock. Inputs show units; explanation pairs predicted demand/capacity with teaching copy and a concrete next action. Measured node accounting appears only once a run has advanced. Preserve the explicit prediction-versus-simulation sentence.
- **Metrics:** collapsed output shows completed requests/s, p95 latency, current queue, failed requests and simulated time where space allows. Unavailable results display an em dash. Expansion reveals observed queue history, request accounting and previous-run comparison. Latency describes successful requests only; throughput is completed requests divided by elapsed time. Compare runs only when workload seed, traffic, duration and timeout match.
- **Feedback:** semantic status callouts, validation banners, save status, toasts and accessible focus outlines explain state. Buttons transition background and border over 0.15s; the running guide dot pulses over 1s. Reduced-motion mode suppresses transitions and animation.

## Do's and Don'ts

- Do preserve the docked workspace hierarchy and readable graph cards.
- Do label configured-rate predictions as expected and measured values as simulation output.
- Do show units, empty measurement states and explicit illustrative assumptions.
- Do keep mobile cards readable through pan and zoom and retain checkpoint disclosure.
- Don't introduce a marketing hero, decorative imagery or a new visual identity into the workspace.
- Don't shrink the entire mobile graph to fit at the expense of readable labels.
- Don't present predicted database arrivals or configured capacities as measured results.
- Don't silently replace the explicit processing model with visual abstraction.


## Expandable component detail (milestone 4)

The compact 215 px node card retains its original footprint in the request path. A small right-hand chevron expands it downward, keeping connection handles at the header's 39 px center. The inspector offers the same action explicitly. Details reveal the existing model rather than introduce a new one: ten aggregate queue-occupancy segments, one processing slot, sampled state, fixed processing time and relevant counters. Cache branching labels describe configured hit/miss probabilities. A quiet “Same model · view only” footer preserves the distinction.

Traffic connections use a persistent solid route plus small teal directional dots. A 1.2-second linear CSS loop travels one 24 px dash period and retains its phase through pause/resume. Renderer measurements are retained across worker updates so edges do not remount. The cue pauses on hidden pages and disappears under reduced-motion preferences or zero expected demand.

On mobile, the introductory copy sits above a dedicated 380 px canvas area. Expanded cards are centered at readable scale, with no heading overlay on the revealed details. All expansion metadata belongs to project presentation, outside the simulation graph.


## Workload controls (milestone 5)

Traffic pattern is a three-button segmented choice in the existing inspector: Steady, Burst and Ramp. The selected control uses the existing soft-teal selection style. A compact configured-rate plot precedes the rate and timing inputs. Burst times share one row; mobile keeps rate fields full-width.

Live metrics place configured traffic above observed queue history. Both plots stretch over the same time-axis width, with independent explicitly named vertical quantities. Configured rate is teal; queue length is amber. The comparison column explains burst recovery using observed counts, while cumulative latency remains clearly distinct from the final queue state. Edge labels and traffic cards show the instantaneous configured rate without altering animation phase.


## Saved experiment results (milestone 6)

Saved runs sit beside checkpoints in the library. A completed run offers an inline naming form. Selecting saved results opens a docked bottom panel, keeping the architecture visible above it. Native baseline/comparison selects lead into a measurement table and a shared-scale queue overlay: baseline amber, comparison teal. Workload matching and imported provenance appear beside the evidence; mismatched workloads suppress deltas.

The desktop panel scrolls internally with a 460 px height cap. Canvas resizing reframes the graph with space reserved for its heading. Mobile keeps readable node scale and places the full results panel in document flow. Rename, restore and delete controls remain accessible below the measurements; deletion offers an inline undo action.


## Editable service internals (milestone 8)

The expanded service retains its queue, processor and observed counters. Two compact, labeled inputs below those measurements edit capacity and waiting slots. Apply changes commits both values in one action; Cancel/Escape discards the draft. A short note explains the run reset and Undo. Inputs inherit the workspace's fields, typography and focus treatment; canvas drag, pan and deletion keys do not intercept editing.

Only service internals gain these controls. Database/cache views retain their view-only note. Mobile allocates 500 px to the canvas when service controls are present, preserving the readable 0.9 node scale and full access to inputs/actions. This is direct parameter editing, not nested graph editing.


## Concurrent service workers (milestone 9)

Expanded services add a Workers field to the existing atomic edit form. The capacity label explicitly says Per worker; a compact equation shows the applied worker count × rate = total req/s. The node header shows total capacity. The inspector uses the same worker-count and total-capacity domain helpers, labels capacity units req/s/worker and explains the shared queue.

The processor block labels the configured slot count and sampled occupied count. Up to sixteen aggregate occupancy segments use teal for occupied slots, with an accessible meter and sampled-state wording; these segments do not identify individual worker histories. The queue remains one shared bounded FIFO. Service utilization is labeled worker utilization. Mobile provides a 580 px canvas when the service editor is expanded, keeping all sixteen slots and editing actions visible at readable scale.

Saved-result contexts identify historical single-worker models. Comparisons explain model-version mismatches and suppress deltas while leaving original measurements intact. Other docks, components, traffic motion and the selected light design remain consistent.


## Background jobs and subsystem composition

The light docked workspace now offers an Experiment path selector. Job queue and worker cards reveal admission, attempt processing and retry settings; producer acknowledgement is explicitly distinct from completion. Job edges distinguish offered traffic from observed attempts. Subsystems use a lightly tinted dashed enclosure when expanded and a compact solid summary when collapsed. Header dragging moves members together. Names and controls remain in the left dock; mobile uses disclosures and a readable focused node rather than squeezing the whole subsystem into view. Renderer-only group dimensions are retained across samples to keep collapsed cards and boundary edges stable.


## Guided experiments

A compact library selector loads four concrete starters. The inspector's guide contains one learning question, three practical steps and an observed-results disclosure. Guide in the toolbar returns to it after component inspection. Findings use current measured queue, completion, attempt and failure counters; they do not claim real-system sizing. The guide is model metadata excluded from the simulation signature, preserving live runs when returning to free exploration and restoring the selected lesson with Undo/checkpoints. Mobile keeps native selectors and the coach in document flow.

Viewport restoration considers canvas height and node identity changes. This preserves manual zoom for an unchanged workspace while reframing when switching starter graphs or returning from a differently sized results pane. Expanded controls remain inside the canvas.
