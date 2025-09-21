# AGENTS.md

> Charter for a small, focused set of software agents (and humans) collaborating to ship a highly-performant, WebGPU-first terraforming & erosion prototype in the browser using Three.js, React, TypeScript, and pnpm.

---

## 0) North Star

* **Goal:** Real‑time, beautiful terrain manipulation (soil/water/lava) with convincing erosion and flow, stable 60 FPS on mid‑range GPUs at 1080p.
* **Constraints:** WebGPU‑first; minimal CPU↔GPU traffic; instrumentation from day 0; elegant UX; no NPCs.
* **Definition of Done (v1):**

  * Brush sculpt + water/lava sources, pause/play & time scale.
  * Streams→rivers→lakes behavior via hybrid field + shading.
  * GPU timestamp HUD; debug overlays (flow, accumulation, pools).

---

## 1) Agent Roster (who does what)

> Think of each “agent” as a focused persona you can run locally (CLI), in CI, or mentally. Each has inputs, outputs, acceptance criteria, and a tight scope.

### A1. **Scaffold Agent** (Repo/Build) ✅ COMPLETE

* **Purpose:** Bootstrap and enforce the monorepo structure.
* **Inputs:** package matrix (pnpm, Vite, TS), target browsers.
* **Outputs:** `pnpm` workspace, `apps/playground`, `packages/engine`, `packages/types` with build scripts.
* **Status:** ✅ Complete - monorepo structure established, WGSL loader working, concurrent dev workflow active.
* **Key Files:** `package.json`, `pnpm-workspace.yaml`, `apps/playground/vite-plugin-wgsl.ts`

### A2. **Sim Agent** (Terrain/Fluids/Erosion/Lava) 🚧 IN PROGRESS

* **Purpose:** Maintain GPU compute passes and state layouts.
* **Inputs:** heightfield H, velocity F, accumulation A, depth D (opt), lava L, temperature T.
* **Outputs:** Updated textures/buffers each tick; ping‑pong management; stability guarantees (CFL, clamps).
* **Status:** 🚧 Core brush system complete, thermal repose implemented, other systems partial.
* **Implemented:**
  - ✅ BrushSystem with mass conservation (workgroup-quota)
  - ✅ Fields management for GPU textures
  - ✅ ThermalRepose for angle-of-repose physics
  - ⚠️  Flow/erosion systems (shaders exist, integration partial)
* **Key Files:**
  - `packages/engine/src/sim/BrushSystem.ts`
  - `packages/engine/src/gpu/shaders/BrushPass_workgroup_quota.wgsl`
  - `packages/engine/src/gpu/shaders/ThermalRepose.wgsl`

### A3. **Render Agent** (Three.js + WebGPU + Materials) ✅ CORE COMPLETE

* **Purpose:** Visual fidelity with minimal bandwidth.
* **Inputs:** Sim textures (H/F/A/P/D/T/L/C), camera, lights.
* **Outputs:** Terrain mesh (vertex displacement), water/lava materials with advected UVs, 3-stage brush feedback.
* **Status:** ✅ Core rendering pipeline established with TSL materials.
* **Implemented:**
  - ✅ TerrainRenderer with WebGPU integration
  - ✅ TerrainMaterialTSL with displacement mapping
  - ✅ WaterMaterialTSL with beach break effects
  - ✅ LavaMaterialTSL system
  - ✅ 3-stage visual feedback (hover/alt-ready/active)
  - ✅ Material-specific brush indicators
* **Key Files:**
  - `packages/engine/src/render/TerrainRenderer.ts`
  - `packages/engine/src/render/materials/*TSL.ts`

### A4. **UX Agent** (Controls/HUD/Debug) ✅ CORE COMPLETE

* **Purpose:** Human‑friendly control & clear performance visibility.
* **Inputs:** Engine hooks, metrics, app state.
* **Outputs:** Brush/UI panels, time controls, debug overlays, collapsible interface.
* **Status:** ✅ Core UI established with comprehensive brush controls.
* **Implemented:**
  - ✅ TerraformingUI with collapsible sections
  - ✅ BrushSection with mode/material/radius/strength controls
  - ✅ Hand mass/capacity visualization
  - ✅ Zustand state management
  - ✅ RunSection (pause/play), TimeScaleSection
  - ✅ QualitySection, DebugOverlaySection
  - ✅ Performance HUD toggle
* **Key Files:**
  - `apps/playground/src/components/TerraformingUI.tsx`
  - `apps/playground/src/components/sections/BrushSection.tsx`
  - `apps/playground/src/store/uiStore.ts`

### A5. **Perf Agent** (Profiling/Quality Scaling) ⚠️ PARTIAL

* **Purpose:** Enforce budgets, gather telemetry, propose scaling.
* **Inputs:** GPU timestamps, draw/dispatch counts, VRAM estimates.
* **Outputs:** Perf HUD, JSON profiles, auto‑quality scaler.
* **Status:** ⚠️ Performance monitoring hooks exist, full profiling system partial.
* **Implemented:**
  - ✅ Performance sample types in `@terraforming/types`
  - ✅ usePerfSamples hook
  - ✅ PerfHudSection component with snapshot capability
  - ⚠️  GPU timestamp integration (framework ready)
* **Key Files:**
  - `apps/playground/src/hooks/usePerfSamples.ts`
  - `apps/playground/src/components/sections/PerfHudSection.tsx`

### A6. **DevOps Agent** (CI/CD/Artifacts) ⚠️ LOCAL ONLY

* **Purpose:** Keep the main branch green; ship previews.
* **Inputs:** repo, test suite, build scripts.
* **Outputs:** PR checks (typecheck/lint/test/build), preview deploys, tagged releases.
* **Status:** ⚠️ Local development workflow established, CI/CD not configured.
* **Implemented:**
  - ✅ Local typecheck/build pipeline
  - ✅ Watch mode for development
  - ⚠️  No CI/CD, lint, or test frameworks configured yet

---

## 2) Operating Principles

* **GPU‑centric:** All simulation on GPU; CPU only orchestrates.
* **Small surfaces:** Narrow, stable, composable APIs between packages.
* **Perf by default:** Every feature lands with timing in HUD.
* **Fail visibly:** Debug overlays for any non‑obvious data.
* **Deterministic dev:** Seeded randomness; recordable input.

---

## 3) Repository Layout (pnpm monorepo)

```text
terraforming/ (sand-box)
├─ apps/
│  └─ playground/            # Vite app shell (React)
│      ├─ src/
│      │  ├─ components/     # UI components & sections
│      │  ├─ store/          # Zustand state management
│      │  └─ hooks/          # React hooks
│      ├─ vite-plugin-wgsl.ts # WGSL loader plugin
│      └─ tailwind.config.ts # Tailwind v4 config
├─ packages/
│  ├─ types/                 # Shared TypeScript definitions
│  │  └─ src/index.ts       # Engine interface types
│  ├─ engine/                # WebGPU + Three glue, sim, renderer
│  │  ├─ src/
│  │  │  ├─ gpu/
│  │  │  │  ├─ shaders/      # WGSL compute shaders
│  │  │  │  └─ pipelines/    # GPU pipeline management
│  │  │  ├─ sim/             # Simulation systems (brush, fields, hand)
│  │  │  ├─ render/          # Three.js renderer & TSL materials
│  │  │  └─ index.ts         # Main engine API
│  │  └─ dist/               # Build output
│  └─ assets/ (optional)     # Shared textures, LUTs
├─ docs/
│  ├─ concept/               # Architecture documentation
│  └─ brush_system_*.md      # Implementation specifications
├─ pnpm-workspace.yaml
├─ AGENTS.md                 # This file
├─ CLAUDE.md                 # Development guidance
└─ package.json
```

---

## 4) Core Implementation Strategy

### 4.1 Data Model (GPU resources)

* `H`: height (R32F).
* `F`: flow/velocity (RG16F or RGBA16F) in texel space.
* `A`: flow accumulation (R16F/R32F) with decay.
* `P`: pool mask (R8).
* `D` (opt): water depth (R16F/R32F).
* `L`: lava depth (R16F/R32F), `T`: temperature (R16F/R32F), `C`: crust (R8).
* **Ping‑pong** all dynamic fields; **bind groups** are persistent.

### 4.2 Simulation Loop (per frame if running)

1. **Slope & Velocity:** ∇H → F (with inertia & damping).
2. **Accumulation:** route rain/sources along F → A (with hysteresis).
3. **Pooling:** detect basins via div(F)+speed (P), optional height relax.
4. **(Optional) Depth:** advect D/L; cool T; form crust C.
5. **Erosion/Thermal:** capacity‑based pick‑up/deposit; angle‑of‑repose creep.

> All passes run at ¼–⅛ screen res; upscale with edge‑aware filter.

### 4.3 Rendering

* **Terrain:** single grid; vertex displace by H; triplanar blend; wetness & micro‑channels from A/P.
* **Water:** screen‑aligned surface or thin mesh, **advected UVs** by F, Fresnel/refraction, foam at curl/slowdown.
* **Lava:** same flow, emissive from T, crust mask C modulates roughness.
* **Post:** minimal (FXAA/TAA optional) to protect bandwidth.

### 4.4 CPU↔GPU Traffic

* Upload sources/brush ops as compact SSBOs each frame.
* No readbacks during frame; optional capture path offline.
* Indirect draw/dispatch in phase 2 (future).

---

## 5) Public APIs (package boundaries)

### `packages/engine`

```ts
// bootstrap
initEngine(canvas: HTMLCanvasElement, opts: EngineOpts): Promise<Engine>;

// control
engine.setRunState(paused: boolean): void;
engine.setTimeScale(mult: number): void;
engine.setQuality(opts: QualityOpts): void; // sim res, substeps

// inputs
engine.brush.enqueue(op: BrushOp): void;    // CPU→GPU ring buffer
engine.sources.set(kind: 'water'|'lava', list: Source[]): void;

// debug & perf
engine.debug.setOverlay(kind: DebugOverlay | 'none'): void;
engine.perf.onSample((sample: GpuTimings & Counters) => void): Unsub;
```

### `apps/playground/src/ui`

* Pure React: consumes `engine` methods, renders HUD & panels.

---

## 6) Guardrails & Acceptance

* **Numerical stability:** CFL‑capped dt; clamp negatives; NaN mask.
* **Performance:** 16.6 ms target; GPU timestamps per pass in HUD.
* **Visual QA:** golden scenes with expected channel/ridge/pool shapes.
* **Cross‑device:** feature gates (timestamp queries, 16‑bit storage) with graceful fallback.

---

## 7) Metrics & Telemetry

* **Frame:** CPU ms, GPU total ms, per‑pass ms.
* **Work:** dispatches, workgroup sizes, threads total, draw calls.
* **Memory:** textures/buffers (count, bytes), peak VRAM estimate.
* **Quality scaler:** target FPS vs actual, chosen tier.
* **UX:** interaction latency (brush down→visible effect).

---

## 8) Test Plan

* **Unit (TS):** math helpers (indexing, slopes, CFL).
* **WGSL tests:** offline WGSL kernels with known inputs/outputs (via headless adapter in CI if available, else host‑sim mock).
* **Visual regression:** snapshot key buffers (A/P/H slices) and final frame.
* **Performance gates:** CI fails if microbench > thresholds.

---

## 9) Milestones (suggested)

* **M0:** Scaffold + blank scene + HUD shell.
* **M1:** Heightfield + brush deltas + displaced terrain.
* **M2:** Flow F + accumulation A + river mask R visuals.
* **M3:** Water material w/ advected UVs + foam.
* **M4:** Erosion + thermal creep.
* **M5:** Lava (T, C) + emissive/crust shading.
* **M6:** Quality scaler + polish + docs.

---

## 10) Agent Prompts (if automating)

### Sim Agent (system)

"""
You own GPU simulation passes. Keep math stable (CFL, clamps), minimize bandwidth, and expose buffers via stable bindings. Refuse features without budget.
"""

* **Tasks:** update WGSL kernels, add ping‑pong buffers, write timing scopes.
* **Checklist:** no NaNs; per‑pass ms; A/P overlays correct; tests pass.

### Render Agent (system)

"""
You deliver beauty at a fixed budget. Prefer node/TSL or custom shaders. Keep passes few; avoid heavy post. Expose debug toggles.
"""

* **Tasks:** terrain displace, triplanar, water/lava materials, foam decals.
* **Checklist:** 1 draw for terrain, 1 for water, 1 for lava (goal); timings OK.

### Perf Agent (system)

"""
You enforce 16.6 ms. Add GPU timestamp ranges, counters, and a quality scaler. Fail PRs that regress budgets.
"""

* **Tasks:** GPUQuerySet helpers, HUD wiring, scaler heuristics.
* **Checklist:** HUD visible; JSON profile export; CI perf guard.

### UX Agent (system)

"""
You make controls obvious and delightful. No walls of text. Tooltips + sensible defaults.
"""

* **Tasks:** brush panel, sources list, time controls, debug dropdown, mini‑tutorial.
* **Checklist:** discoverability test (<2 min) passes.

---

## 11) Runbook

* `pnpm i` → `pnpm dev` (runs concurrent build:watch + dev server)
* Alternative: `pnpm -r build` → `pnpm --filter @terraforming/playground dev`
* Open in Chrome/Edge (WebGPU enabled by default). If adapter lacks timestamps, HUD marks them as N/A.
* Use Alt+Click to interact with terrain brush system

---

## 12) Glossary

* **CFL:** Courant–Friedrichs–Lewy condition; stability criterion for advection.
* **Flow accumulation (A):** scalar field measuring upstream contribution; used to widen streams into rivers.
* **Ping‑pong:** double buffering a field for read/write alternation.

---

## 13) Implementation Status (as of current)

### ✅ Completed Systems
- **Brush System**: Mass-conserving pickup/deposit with workgroup-quota enforcement
- **Material System**: Soil/rock/lava with density-based calculations
- **Visual Feedback**: 3-stage interaction (hover/alt-ready/active) with material indicators
- **Thermal Repose**: Angle-of-repose physics for natural terrain slopes
- **TSL Materials**: Terrain displacement, water beach breaks, lava rendering
- **UI Framework**: Comprehensive control panels with Zustand state management

### 🚧 Partially Implemented
- **Flow/Erosion**: WGSL shaders exist, integration with renderer partial
- **Performance Monitoring**: Framework ready, GPU timestamp integration pending
- **Quality Scaling**: Basic quality controls, auto-scaler not implemented

### ❌ Not Yet Implemented
- **Water Depth Simulation**: Currently using accumulation field only
- **Lava Flow Physics**: Lava material exists, flow dynamics pending
- **CI/CD Pipeline**: Local development only
- **Automated Testing**: No test framework configured

### 🎯 Current Architecture Strengths
- **GPU-First**: All simulation on WebGPU compute shaders
- **Mass Conservation**: Mathematically sound brush system
- **Performance-Oriented**: Direct texture binding, minimal CPU↔GPU traffic
- **Modular Design**: Clean separation between sim, render, and UI layers

## 14) Open Questions (track here)

* Do we keep explicit water depth `D` in v1 or fake with A/P only?
* Which clipmap level and terrain tile size for M1 target hardware?
* Do we add SSR later, or stick to refraction only?
* Should we implement indirect draw/dispatch for phase 2?
* How to best integrate the existing flow/erosion shaders with the current renderer?
