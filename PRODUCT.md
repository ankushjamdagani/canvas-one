# System studio

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-selected React, TypeScript, Vite, React Flow, Zustand, custom discrete-event simulation in a Web Worker, Dexie, Vitest and Playwright.

## Users

People learning system architecture by changing a model and observing cause and effect.

## Product Purpose

An editable infinite canvas for frontend, backend and whole-system architecture. First experiment: URL shortener with traffic, redirect service, database and optional cache.

Diagram organization supports multi-selection through Shift-click and a visible touch/keyboard checklist. Selected real components move together and can align or distribute in one undoable position edit; collapsed subsystem members and subsystem shells are excluded. Diagram subsystem summaries describe architecture boundaries rather than simulation counters.

Diagram-only SVG and PNG downloads render the complete architecture independently of the editor viewport. They retain component and connection metadata and the current subsystem collapse state. SVG provides a portable vector rendition; PNG uses a white background and bounded high-resolution scale. JSON remains the editable project backup.

## Capabilities and Constraints

Seeded replay with steady, burst and linear-ramp workloads; bounded queues and request timeouts; explicit illustrative assumptions. Named local projects, autosave, checkpoints, versioned JSON import/export. No cloud sync. No need to restore an in-progress simulation. Expandable components reveal existing queues and processing on the same canvas. Expanded services support draft per-worker capacity, worker-count and shared-queue edits with atomic Apply, run reset and Undo; inspector and canvas settings stay synchronized. Named completed results persist locally, support matched-workload comparisons, and travel with current version-7 JSON exports. Services support 1–16 ideal concurrent workers; total rate equals workers × per-worker rate. Imported results retain an explicit provenance label; current portable imports are supported without maintaining old-format shims. Browser-local records are not deleted. A background-job path adds queue admission acknowledgements, seeded attempt failures, bounded retries, deadlines and separate job accounting. Named one-level subsystems group real editable components, collapse to observed summaries and preserve the original simulation. Six guided experiments connect both paths to saved comparisons. A separate architecture-diagram mode offers 29 searchable visual component types across Clients, Edge, Compute, Data, Messaging and Operations, including a generic custom component with its own 60-character type label. Three undoable templates provide editable real-time chat, ecommerce checkout and event-processing starters with labeled relationships. With up to 100 components and 200 directed connections, names and 240-character responsibility or technology notes are editable; any node can be duplicated as an independent unconnected copy. Touch-operable handles and explicit selected-connection deletion support direct manipulation. Diagram components and templates add no executable semantics, and the existing simulation paths remain unchanged; visual abstraction must never replace the simulation model silently.

## Brand Commitments

Tentative name System studio. User selected light layout A, docked workspace. Reference: /Users/ankushjamdagani/.codex/generated_images/01a075b1-2794-7560-bc49-7100802ae27a/exec-4e3ce102-fe59-4675-9226-45ed9293037a.png. Preserve left library, central compact nodes, right inspector, slim bottom metrics, warm white dotted canvas and restrained teal/amber.

## Evidence on Hand

100 requests/s baseline; illustrative database capacity 500 lookups/s; 700 requests/s overload; 80% cache hit rate gives expected 140 database requests/s. These are educational inputs, not real benchmarks.

## Product Principles

- Learning cause and effect comes first.
- Simulation assumptions are visible.
- Identical seeded workloads make comparison interpretable.
- Domain, simulation, persistence and rendering remain independent.

## Open Decisions

The scoped roadmap now includes load-balanced URL lookup: an optional instantaneous round-robin balancer fans traffic across 1–8 independently editable service instances, each with its own worker pool and FIFO queue, into a shared cache/database path. Full queues reject without rerouting; the shared downstream bottleneck remains visible. Nested hierarchies, alternate routing policies, health checks and hardware realism remain separately scoped.

The component catalog spans clients, edge, compute, data, messaging and operations. Future executable semantics for diagram components must be introduced explicitly, one verified model at a time.
