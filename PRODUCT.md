# Canvas One

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-selected React, TypeScript, Vite, React Flow, Zustand, custom discrete-event simulation in a Web Worker, Dexie, Vitest and Playwright.

## Users

Software engineers, system architects, and technical teams designing systems, understanding complex codebases, and collaborating with AI agents beyond text-only chat.

## Product Purpose

Beyond chat: The shared canvas for engineers and AI to think, architect, and review systems together.

Canvas One provides an infinite visual whiteboard where humans and AI agents interact visually across five core engineering workflows:
1. **System Design & Simulation:** Visually drafting topologies, stress-testing distributed architectures, and simulating capacity, bottlenecks, queue backpressure, and failure modes before writing code.
2. **Code Walkthroughs:** Tracing request lifecycles, execution paths, and component boundaries across repositories.
3. **Code Review:** Evaluating architectural diffs and blast-radius impacts of PRs rather than just line-by-line syntax changes.
4. **System Explanation:** Visual Q&A and interactive breakdowns of complex protocols, state transitions, and background pipelines.
5. **Engineering Onboarding:** Guided visual tours of systems and living architectural documentation that stays anchored to real designs.

Diagram organization supports multi-selection through Shift-click and a visible touch/keyboard checklist. Selected real components move together and can align or distribute in one undoable position edit; collapsed subsystem members and subsystem shells are excluded. Diagram subsystem summaries describe architecture boundaries rather than simulation counters.

Diagram-only SVG and PNG downloads render the complete architecture independently of the editor viewport. They retain component and connection metadata and the current subsystem collapse state. SVG provides a portable vector rendition; PNG uses a white background and bounded high-resolution scale. JSON remains the editable project backup.

Canvas notes are implemented as typed design context separate from executable components. The five types are decision, assumption, future scope, question and general note; notes support an 80-character title, a 1,000-character body, collapse/expand, movement, deletion, and optional links to nodes, connections or subsystems. Notes persist with projects, checkpoints and JSON exports without entering simulation semantics. SVG/PNG exports include the note layout; visible copy is compact and full note content is retained in SVG titles.

## Positioning

The shared visual thinking surface for human–AI software engineering. While conversational AI tools force architectural reasoning into flat, ephemeral text chat, Canvas One gives engineers and AI a shared spatial canvas to visually co-design, simulate, inspect, and verify software before and alongside code generation.

## Capabilities and Constraints

Authored architecture revisions are available locally through the project selector. Up to 20 immutable snapshots record name, self-reported author, timestamp, change reason, explanation, optional issue URL and draft/final status. Finalizing a draft saves a linked final copy of its captured architecture. Comparisons expose changed components and fields, connections, notes, subsystems, workload and expanded views. Restore is one Undo/Redo action and preserves the surrounding project and saved results. Version-7 portable exports retain revisions. Shared identity, team approval and cloud synchronization remain future scope.

Seeded replay with steady, burst and linear-ramp workloads; bounded queues and request timeouts; explicit illustrative assumptions. Named local projects, autosave, checkpoints, version-8 JSON export/import, and read-only version-7 archives with runnable copies. No cloud sync. Expandable components reveal queues and processing on the same canvas. All 29 catalog kinds use explicit configurable behavior; optional examples/tutorials provide starters without restricting the catalog. Named completed results persist locally and separate root-request from background-message metrics. Services support 1–16 ideal concurrent workers; total rate equals workers × per-worker rate. Browser-local records are not deleted. One-level subsystems group real editable components, collapse to observed summaries and preserve the original simulation. With up to 100 components and 200 directed connections, names and notes are editable; any node can be duplicated as an independent unconnected copy. The simulator models performance behavior and does not execute application code or reproduce a provider-specific backend.

## Brand Commitments

Tentative name Canvas One. User selected light layout A, docked workspace. Preserve left library, central compact nodes, right inspector, slim bottom metrics, warm white dotted canvas and restrained teal/amber.

## Evidence on Hand

100 requests/s baseline; illustrative database capacity 500 lookups/s; 700 requests/s overload; 80% cache hit rate gives expected 140 database requests/s. These are educational inputs, not real benchmarks.

## Product Principles

- **Spatial over textual:** Complex software systems are networks, flows, and state transitions—represent them spatially on the canvas rather than trapped in text paragraphs.
- **Architecture before code:** Formulate, inspect, and agree on the design and implementation plan with AI before jumping into code synthesis.
- **Bi-directional fluency:** The canvas is equally readable and writable by humans and AI agents—neither is a passive spectator.
- **Truthful & grounded:** Diagrams and simulations reflect verified code structures, real contracts, and deterministic simulations—never hand-waved or invented.
- **Learning cause and effect comes first:** Simulation assumptions are visible; identical seeded workloads make comparison interpretable.
- **Domain, simulation, persistence and rendering remain independent.**

## Open Decisions

The scoped roadmap now includes load-balanced URL lookup: an optional instantaneous round-robin balancer fans traffic across 1–8 independently editable service instances, each with its own worker pool and FIFO queue, into a shared cache/database path. Full queues reject without rerouting; the shared downstream bottleneck remains visible. Nested hierarchies, alternate routing policies, health checks and hardware realism remain separately scoped.

The component catalog spans clients, edge, compute, data, messaging and operations. Future executable semantics for diagram components must be introduced explicitly, one verified model at a time.

## Future product goals

- **Team architecture workspaces:** Support shared team workspaces where named architectures are saved centrally, members can collaborate on revisions, and a team can review and finalize a chosen design. This requires explicit identity, roles and access control, concurrent editing or conflict resolution, comments/review state, and durable revision history.
- **Team-backed revision history:** Build on local authored revisions with authenticated authorship, team review and durable shared storage.
- **Scoped subsystem revisions and concurrent review cycles:** Provide a dedicated UX for proposing, reviewing, and tracking changes to specific subsystems or bounded parts of an existing system. Multiple revisions can progress simultaneously across different or overlapping subsystems, each with distinct visual identification on the canvas, isolated diffing, and structured feedback/review cycles.
- **Cross-project architecture linking and impact analysis:** Enable independent teams to maintain their own system architectures and link them via typed external links (sync RPC, async streams, shared data, schema contracts). Changes in upstream or downstream external services are detected to evaluate impacts, contract drift, and performance implications on the local design.
- **Collaboration with AI (Visual architectural decision-making playground):** Establish Canvas One as the common visual playground and deliberative canvas for architectural decision-making between engineers and AI agents. Instead of unconstrained "vibe coding"—where AI models make opaque, ad-hoc architectural decisions implicitly during code generation—engineers use the tool to visually formulate, inspect, simulate, and stress-test the system implementation plan first. Developers interactively collaborate with AI via structured revision cycles, exploring design trade-offs (caching strategies, queue bounds, concurrency scaling, database bottlenecks) on the canvas, reviewing visual diffs, and agreeing on a verified architectural blueprint before concluding the plan for downstream code execution.

The collaboration goal is future scope. The current product remains browser-local with no cloud synchronization; introducing shared workspaces must be designed as a deliberate persistence and authorization milestone rather than implied by local projects or JSON exports.
