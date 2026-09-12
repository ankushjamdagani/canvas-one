# Graph Report - /Users/ankushjamdagani/personal/system-design-planner  (2026-09-09)

## Corpus Check
- 139 files · ~253,368 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 488 nodes · 1162 edges · 70 communities (65 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c2215291`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Simulation Engine and Controls|Simulation Engine and Controls]]
- [[_COMMUNITY_Canvas Application and Inspector|Canvas Application and Inspector]]
- [[_COMMUNITY_Experiments and Saved Results|Experiments and Saved Results]]
- [[_COMMUNITY_Project Models and Persistence|Project Models and Persistence]]
- [[_COMMUNITY_Component Catalog and Export|Component Catalog and Export]]
- [[_COMMUNITY_Workload Metrics and Charts|Workload Metrics and Charts]]
- [[_COMMUNITY_Package Dependencies and Scripts|Package Dependencies and Scripts]]
- [[_COMMUNITY_TypeScript Compiler Configuration|TypeScript Compiler Configuration]]
- [[_COMMUNITY_Canvas Alignment and Distribution|Canvas Alignment and Distribution]]
- [[_COMMUNITY_Exported Event Pipeline|Exported Event Pipeline]]
- [[_COMMUNITY_Finite Cache Implementation|Finite Cache Implementation]]
- [[_COMMUNITY_Event Pipeline Screenshot|Event Pipeline Screenshot]]
- [[_COMMUNITY_Diagram Export Workflow|Diagram Export Workflow]]
- [[_COMMUNITY_Load Balancer Screenshot|Load Balancer Screenshot]]
- [[_COMMUNITY_Background Job Settings|Background Job Settings]]
- [[_COMMUNITY_Mobile Canvas Organization|Mobile Canvas Organization]]
- [[_COMMUNITY_Cache Capacity Comparison|Cache Capacity Comparison]]
- [[_COMMUNITY_Database Overload Remediation|Database Overload Remediation]]
- [[_COMMUNITY_Service Capacity Editing|Service Capacity Editing]]
- [[_COMMUNITY_Seeded Arrival Visualization|Seeded Arrival Visualization]]
- [[_COMMUNITY_Cache Baseline Comparison|Cache Baseline Comparison]]
- [[_COMMUNITY_Redirect Backend Subsystem|Redirect Backend Subsystem]]
- [[_COMMUNITY_Workspace Design Documentation|Workspace Design Documentation]]
- [[_COMMUNITY_Retry Cost Guide|Retry Cost Guide]]
- [[_COMMUNITY_Organization Browser Tests|Organization Browser Tests]]
- [[_COMMUNITY_Editable Architecture Components|Editable Architecture Components]]
- [[_COMMUNITY_Application Request Path|Application Request Path]]
- [[_COMMUNITY_Mobile Component Library|Mobile Component Library]]
- [[_COMMUNITY_Event Processing Template|Event Processing Template]]
- [[_COMMUNITY_Chat Architecture Diagram|Chat Architecture Diagram]]
- [[_COMMUNITY_Mobile Job Queue|Mobile Job Queue]]
- [[_COMMUNITY_Burst Workload Results|Burst Workload Results]]
- [[_COMMUNITY_Mobile Component Inspection|Mobile Component Inspection]]
- [[_COMMUNITY_Finite Cache Warmup Guide|Finite Cache Warmup Guide]]
- [[_COMMUNITY_Database Bottleneck Evidence|Database Bottleneck Evidence]]
- [[_COMMUNITY_Concurrent Service Slots|Concurrent Service Slots]]
- [[_COMMUNITY_Custom Component Duplication|Custom Component Duplication]]
- [[_COMMUNITY_Custom Component Labels|Custom Component Labels]]
- [[_COMMUNITY_Cache Hit Rate Evidence|Cache Hit Rate Evidence]]
- [[_COMMUNITY_Mobile Image Export|Mobile Image Export]]
- [[_COMMUNITY_Mobile Service Settings|Mobile Service Settings]]
- [[_COMMUNITY_Queue Pressure Remediation|Queue Pressure Remediation]]
- [[_COMMUNITY_Job Burst Guide|Job Burst Guide]]
- [[_COMMUNITY_Load Balanced Workloads|Load Balanced Workloads]]
- [[_COMMUNITY_Mobile Baseline Experiment|Mobile Baseline Experiment]]
- [[_COMMUNITY_Verification and Milestone Records|Verification and Milestone Records]]
- [[_COMMUNITY_Ramp Capacity Discovery|Ramp Capacity Discovery]]
- [[_COMMUNITY_Saved Result Comparison|Saved Result Comparison]]
- [[_COMMUNITY_Collapsed Subsystem Metrics|Collapsed Subsystem Metrics]]
- [[_COMMUNITY_Expanded Subsystem Members|Expanded Subsystem Members]]
- [[_COMMUNITY_Custom Component Planning|Custom Component Planning]]
- [[_COMMUNITY_Component Limit Evidence|Component Limit Evidence]]
- [[_COMMUNITY_Chat Template Evidence|Chat Template Evidence]]
- [[_COMMUNITY_Architecture Template Planning|Architecture Template Planning]]

## God Nodes (most connected - your core abstractions)
1. `useEditor` - 28 edges
2. `validateGraph()` - 24 edges
3. `Metrics` - 21 edges
4. `isJobGraph()` - 21 edges
5. `Graph` - 20 edges
6. `makeNode()` - 20 edges
7. `Simulation` - 20 edges
8. `workerCount()` - 19 edges
9. `clone()` - 18 edges
10. `ModelNode` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Seeded system simulation` --conceptually_related_to--> `Seeded irregular arrivals`  [INFERRED]
  PRODUCT.md → artifacts/expanded-mobile.png
- `Diagram multi-selection organization` --implements--> `Two-component mobile selection`  [INFERRED]
  plans/canvas-organization-result.md → artifacts/canvas-organization-mobile.png
- `Diagram SVG and PNG export` --implements--> `Download SVG and PNG controls`  [INFERRED]
  plans/diagram-export-result.md → artifacts/diagram-export-ui.png
- `validateSavedRun()` --indirect_call--> `node()`  [INFERRED]
  src/domain/results.ts → tests/organization.spec.ts
- `System Studio design system` --conceptually_related_to--> `Architecture workspace`  [INFERRED]
  DESIGN.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Seeded experiment workload views** — product_seeded_system_simulation, artifacts_expanded_mobile_seeded_irregular_arrivals, artifacts_load_balanced_mobile_seeded_workload_controls, artifacts_ramp_mobile_linear_ramp [INFERRED 0.85]
- **Diagram authoring capabilities** — plans_architecture_templates_three_starters, plans_canvas_organization_multi_selection, plans_custom_components_and_duplication_custom_component, plans_diagram_export_svg_png_export [INFERRED 0.85]
- **Background Jobs Processing Flow** — artifacts_background_jobs_job_producer, artifacts_background_jobs_job_queue, artifacts_background_jobs_job_worker [EXTRACTED 1.00]
- **Event Processing Pipeline** — artifacts_diagram_export_event_producer, artifacts_diagram_export_event_stream, artifacts_diagram_export_stream_processor, artifacts_diagram_export_event_archive, artifacts_diagram_export_data_warehouse, artifacts_diagram_export_analytics [EXTRACTED 1.00]
- **Round-robin Service Fan-out** — artifacts_load_balanced_load_balancer, artifacts_load_balanced_service_instance_1, artifacts_load_balanced_service_instance_2, artifacts_load_balanced_service_instance_3 [EXTRACTED 1.00]

## Communities (70 total, 5 thin omitted)

### Community 0 - "Simulation Engine and Controls"
Cohesion: 0.09
Nodes (23): ComponentInternals(), Field, JobControls(), queueFields, workerFields, JobInternals(), ServiceModelEditor(), JobMetrics (+15 more)

### Community 1 - "Canvas Application and Inspector"
Cohesion: 0.11
Nodes (31): App(), ResultsPanel, ArchitectureCanvas(), ArchitectureNode, ComponentNode(), edgeTypes, icons, nodeTypes (+23 more)

### Community 2 - "Experiments and Saved Results"
Cohesion: 0.13
Nodes (30): ExperimentCoach(), ResultsPanel(), RunContext(), ArchitectureTemplate, diagram(), EdgeSpec, NodeSpec, Experiment (+22 more)

### Community 3 - "Project Models and Persistence"
Cohesion: 0.20
Nodes (20): run(), failureCount(), backgroundJobs(), Checkpoint, clone(), newProject(), validateGraph(), cacheDescription() (+12 more)

### Community 4 - "Component Catalog and Export"
Cohesion: 0.11
Nodes (24): DiagramExport(), componentCatalog, componentCategories, ComponentCategory, ComponentDefinition, architectureDiagram(), validateSubsystems(), Box (+16 more)

### Community 5 - "Workload Metrics and Charts"
Cohesion: 0.15
Nodes (12): MetricsPanel(), WorkloadChart(), observedCacheHitRate(), Metrics, Settings, nextArrivalTime(), rateAt(), sameGraphWorkload() (+4 more)

### Community 6 - "Package Dependencies and Scripts"
Cohesion: 0.07
Nodes (27): dependencies, dexie, @fontsource-variable/inter, lucide-react, react, react-dom, @xyflow/react, zustand (+19 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+7 more)

### Community 8 - "Canvas Alignment and Distribution"
Cohesion: 0.31
Nodes (10): Alignment, alignNodes(), changed(), distributeNodes(), LayoutAxis, LayoutNode, LayoutResult, PositionUpdate (+2 more)

### Community 9 - "Exported Event Pipeline"
Cohesion: 0.22
Nodes (9): Analytics, Archive Warehouse and Analytics Outputs, Data Warehouse, Event Archive, Exported Event Pipeline SVG, Event Producer, Event Producer to Stream, Event Stream (+1 more)

### Community 11 - "Event Pipeline Screenshot"
Cohesion: 0.33
Nodes (6): Analytics, Data Warehouse, Event Archive, Event Producer, Event Stream, Stream Processor

### Community 12 - "Diagram Export Workflow"
Cohesion: 0.33
Nodes (6): Collapsed event platform subsystem, Entire diagram current subsystem view, Download SVG and PNG controls, Complete graph export, Planned diagram export contract, Diagram SVG and PNG export

### Community 13 - "Load Balancer Screenshot"
Cohesion: 0.47
Nodes (6): Shared Database, Round-robin Load Balancer, Service Instance 1, Service Instance 2, Service Instance 3, Traffic Source

### Community 14 - "Background Job Settings"
Cohesion: 0.40
Nodes (5): Background Job Experiment Settings, Job Producer, Job Queue, Job Worker, Retry Policy

### Community 15 - "Mobile Canvas Organization"
Cohesion: 0.40
Nodes (5): Alignment and distribution controls, Two-component mobile selection, Position-only organization, Diagram multi-selection organization, Planned canvas organization workflow

### Community 16 - "Cache Capacity Comparison"
Cohesion: 0.40
Nodes (5): Small versus Larger Cache Comparison, Database, Finite LRU Cache, Redirect Service, Traffic Source

### Community 17 - "Database Overload Remediation"
Cohesion: 0.40
Nodes (5): Add Cache Remediation, Demand Exceeds Capacity, Overloaded Database, Redirect Service, Traffic Source

### Community 18 - "Service Capacity Editing"
Cohesion: 0.40
Nodes (5): Database, Editable Redirect Service, Service Capacity Settings, Shared FIFO Queue, Traffic Source

### Community 19 - "Seeded Arrival Visualization"
Cohesion: 0.40
Nodes (5): Expanded traffic arrival generator, Seeded irregular arrivals, View-only expanded internals, Prediction and simulation boundary, Seeded system simulation

### Community 20 - "Cache Baseline Comparison"
Cohesion: 0.40
Nodes (5): Before and After Cache Comparison, Cache, Database, Redirect Service, Traffic Source

### Community 21 - "Redirect Backend Subsystem"
Cohesion: 0.40
Nodes (5): Database, Redirect Backend Subsystem, Redirect Service, Shared FIFO Queue, Traffic Source

### Community 22 - "Workspace Design Documentation"
Cohesion: 0.50
Nodes (4): Implemented architecture workspace surface, System Studio design system, System Studio application document, Architecture workspace

### Community 23 - "Retry Cost Guide"
Cohesion: 0.50
Nodes (4): Job Producer, Job Queue, Job Worker, Understand Retry Cost

### Community 26 - "Editable Architecture Components"
Cohesion: 0.67
Nodes (3): Architecture diagram canvas, Editable media bucket component, Client to API gateway to application service

### Community 27 - "Application Request Path"
Cohesion: 0.67
Nodes (3): API Gateway, Application Service, Client

### Community 28 - "Mobile Component Library"
Cohesion: 0.67
Nodes (3): Connection Metadata Editor, Mobile Architecture Workspace, Searchable Queue Component

### Community 29 - "Event Processing Template"
Cohesion: 0.67
Nodes (3): Archive and Analytics Branch, Event Processing Template, Ingestion and Processing Path

### Community 30 - "Chat Architecture Diagram"
Cohesion: 0.67
Nodes (3): Chat Client, Component Library, Diagram-only Architecture

### Community 31 - "Mobile Job Queue"
Cohesion: 0.67
Nodes (3): Admission acknowledgement differs from completion, Mobile background job flow, Shared FIFO job queue

### Community 32 - "Burst Workload Results"
Cohesion: 0.67
Nodes (3): Burst Traffic Profile, Observed Queue and Failure Metrics, Request Pipeline

### Community 33 - "Mobile Component Inspection"
Cohesion: 0.67
Nodes (3): Component Inspector, Mobile Diagram Canvas, Subsystem Control

### Community 34 - "Finite Cache Warmup Guide"
Cohesion: 0.67
Nodes (3): Cache entries and TTL configuration, Finite LRU plus TTL cache, Warm a finite cache guide

### Community 35 - "Database Bottleneck Evidence"
Cohesion: 0.67
Nodes (3): Database bottleneck under 700 requests per second, Shared bounded FIFO queue, Four-worker redirect service

### Community 36 - "Concurrent Service Slots"
Cohesion: 0.67
Nodes (3): Expanded Redirect Service, Sixteen Processing Slot Configuration, Shared FIFO Queue

### Community 37 - "Custom Component Duplication"
Cohesion: 0.67
Nodes (3): Custom Component Palette, Release Flags Component, Release Flags Copy

### Community 38 - "Custom Component Labels"
Cohesion: 0.67
Nodes (3): Custom Component Catalog, Custom Component Instance, Wrapped Long Labels

### Community 39 - "Cache Hit Rate Evidence"
Cohesion: 0.67
Nodes (3): Cache hit and miss routing, Observed 79.7 percent hit rate, Before and after cache comparison

### Community 40 - "Mobile Image Export"
Cohesion: 0.67
Nodes (3): Mobile Diagram Export Workspace, PNG Download Feedback, SVG Download Action

### Community 41 - "Mobile Service Settings"
Cohesion: 0.67
Nodes (3): Atomic mobile service editor, Applying settings resets run, Worker count times per-worker capacity

### Community 42 - "Queue Pressure Remediation"
Cohesion: 0.67
Nodes (3): Add Cache Remediation, FIFO Queue Pressure, Overloaded Database

### Community 43 - "Job Burst Guide"
Cohesion: 0.67
Nodes (3): Guided Burst Experiment Steps, Absorb a Job Burst Guide, Job Producer

### Community 44 - "Load Balanced Workloads"
Cohesion: 0.67
Nodes (3): Load-balanced lookup experiment, Seeded workload controls, Steady burst and ramp patterns

### Community 45 - "Mobile Baseline Experiment"
Cohesion: 0.67
Nodes (3): Baseline Experiment Controls, Mobile URL Lookup Experiment, Steady Traffic Configuration

### Community 46 - "Verification and Milestone Records"
Cohesion: 0.67
Nodes (3): Incremental replay performance profile, Verification evidence, Implemented milestone handoff

### Community 47 - "Ramp Capacity Discovery"
Cohesion: 0.67
Nodes (3): Capacity discovery by increasing load, Linear traffic ramp, 100 to 900 requests per second

### Community 48 - "Saved Result Comparison"
Cohesion: 0.67
Nodes (3): Observed Simulation Metrics, Saved Results Comparison, Short Baseline Result

### Community 49 - "Collapsed Subsystem Metrics"
Cohesion: 0.67
Nodes (3): Collapsed aggregate waiting and active state, Observed traffic into subsystem boundary, Collapsed redirect backend subsystem

### Community 50 - "Expanded Subsystem Members"
Cohesion: 0.67
Nodes (3): Redirect Service Explanation, Expanded Subsystem Boundary, Redirect Service Member

### Community 51 - "Custom Component Planning"
Cohesion: 0.67
Nodes (3): Atomic component duplication, Custom diagram component, Planned custom components and duplication

## Knowledge Gaps
- **153 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+148 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `KeyedCache` connect `Finite Cache Implementation` to `Simulation Engine and Controls`, `Workload Metrics and Charts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `validateGraph()` connect `Project Models and Persistence` to `Simulation Engine and Controls`, `Canvas Application and Inspector`, `Experiments and Saved Results`, `Component Catalog and Export`, `Workload Metrics and Charts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `Metrics` connect `Workload Metrics and Charts` to `Simulation Engine and Controls`, `Canvas Application and Inspector`, `Experiments and Saved Results`, `Project Models and Persistence`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _158 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Simulation Engine and Controls` be split into smaller, more focused modules?**
  _Cohesion score 0.09438775510204081 - nodes in this community are weakly interconnected._
- **Should `Canvas Application and Inspector` be split into smaller, more focused modules?**
  _Cohesion score 0.1101010101010101 - nodes in this community are weakly interconnected._
- **Should `Experiments and Saved Results` be split into smaller, more focused modules?**
  _Cohesion score 0.13414634146341464 - nodes in this community are weakly interconnected._

## Extraction accounting

Graph health warning: the raw extraction has 114 dangling-endpoint edges and the undirected graph collapses 21 parallel relationships. The graph remains usable but incomplete; see `graph-health.json` and the preserved `extraction-audit.json`. Inferred connections are hypotheses, including AST indirect-call matches, and require source verification before implementation decisions.

Code was extracted locally by Graphify. Semantic extraction used this Codex session and three worker batches; each image was handled as an individual chunk. The agent tool does not expose input/output usage counts. Zero values in Graphify token fields are unavailable-usage placeholders, not a claim of zero semantic cost. Future product goals are documentation, not implemented features.
