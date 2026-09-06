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

Seeded replay with steady, burst and linear-ramp workloads; bounded queues and request timeouts; explicit illustrative assumptions. Named local projects, autosave, checkpoints, versioned JSON import/export. No cloud sync. No need to restore an in-progress simulation. Expandable components reveal existing queues and processing on the same canvas. Named completed results persist locally, support matched-workload comparisons, and travel with version-3 JSON exports. Imported results retain an explicit provenance label. Editable nested subgraphs are future work; visual abstraction must never replace the simulation model silently.

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

Detailed subsystem modeling and realistic architecture comparisons are later milestones.
