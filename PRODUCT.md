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

## Capabilities and Constraints

Seeded replay with steady, burst and linear-ramp workloads; bounded queues and request timeouts; explicit illustrative assumptions. Named local projects, autosave, checkpoints, versioned JSON import/export. No cloud sync. No need to restore an in-progress simulation. Expandable components reveal existing queues and processing on the same canvas. Expanded services support draft per-worker capacity, worker-count and shared-queue edits with atomic Apply, run reset and Undo; inspector and canvas settings stay synchronized. Named completed results persist locally, support matched-workload comparisons, and travel with current version-7 JSON exports. Services support 1–16 ideal concurrent workers; total rate equals workers × per-worker rate. Imported results retain an explicit provenance label; current portable imports are supported without maintaining old-format shims. Browser-local records are not deleted. A background-job path adds queue admission acknowledgements, seeded attempt failures, bounded retries, deadlines and separate job accounting. Named one-level subsystems group real editable components, collapse to observed summaries and preserve the original simulation. Six guided experiments connect both paths to saved comparisons. Arbitrary nested execution graphs are outside this finite milestone; visual abstraction must never replace the simulation model silently.

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
