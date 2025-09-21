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

### A1. **Scaffold Agent** (Repo/Build)

* **Purpose:** Bootstrap and enforce the monorepo structure.
* **Inputs:** package matrix (pnpm, Vite, TS), target browsers.
* **Outputs:** `pnpm` workspace, `apps/playground`, `packages/engine`, `apps/playground/src/ui` with lint/format/test scripts.
* **Accepts when:** Clean install, `pnpm -r build` succeeds, dev server hot reloads, WGSL loader works.

### A2. **Sim Agent** (Terrain/Fluids/Erosion/Lava)

* **Purpose:** Maintain GPU compute passes and state layouts.
* **Inputs:** heightfield H, velocity F, accumulation A, depth D (opt), lava L, temperature T.
* **Outputs:** Updated textures/buffers each tick; ping‑pong management; stability guarantees (CFL, clamps).
* **Accepts when:** No NaNs/infs; per‑pass GPU timing within budget; visual regressions gated by tests.

### A3. **Render Agent** (Three.js + WebGPU + Materials)

* **Purpose:** Visual fidelity with minimal bandwidth.
* **Inputs:** Sim textures (H/F/A/P/D/T/L/C), camera, lights.
* **Outputs:** Terrain mesh (vertex displacement), water/lava materials with advected UVs, post (lightweight).
* **Accepts when:** 16.6 ms budget at target; visual QA scenes pass.

### A4. **UX Agent** (Controls/HUD/Debug)

* **Purpose:** Human‑friendly control & clear performance visibility.
* **Inputs:** Engine hooks, metrics, app state.
* **Outputs:** Brush/UI panels, time controls, debug overlays, tutorial hints.
* **Accepts when:** New user can discover all features in < 2 minutes.

### A5. **Perf Agent** (Profiling/Quality Scaling)

* **Purpose:** Enforce budgets, gather telemetry, propose scaling.
* **Inputs:** GPU timestamps, draw/dispatch counts, VRAM estimates.
* **Outputs:** Perf HUD, JSON profiles, auto‑quality scaler.
* **Accepts when:** Stable 60 FPS at default; scaler hits targets gracefully.

### A6. **DevOps Agent** (CI/CD/Artifacts)

* **Purpose:** Keep the main branch green; ship previews.
* **Inputs:** repo, test suite, build scripts.
* **Outputs:** PR checks (typecheck/lint/test/build), preview deploys, tagged releases.
* **Accepts when:** Merge only when green; preview link per PR.

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
terraforming-proto/
├─ apps/
│  └─ playground/            # Vite app shell (React)
├─ packages/
│  ├─ engine/                # WebGPU + Three glue, sim, renderer
│  │  ├─ gpu/
│  │  │  ├─ shaders/         # WGSL files
│  │  │  ├─ pipelines/       # pipeline builders
│  │  │  └─ framegraph/      # pass scheduler (lightweight)
│  │  ├─ sim/                # terrain, fluids, erosion, lava
│  │  ├─ render/             # terrain mesh, materials, renderer
│  │  └─ perf/               # GPU timers, counters
│  └─ assets/                # textures, LUTs
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ vite.config.ts
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

* `pnpm i` → `pnpm -r build` → `pnpm -C apps/playground dev`
* Open in Chrome/Edge (WebGPU enabled by default). If adapter lacks timestamps, HUD marks them as N/A.

---

## 12) Glossary

* **CFL:** Courant–Friedrichs–Lewy condition; stability criterion for advection.
* **Flow accumulation (A):** scalar field measuring upstream contribution; used to widen streams into rivers.
* **Ping‑pong:** double buffering a field for read/write alternation.

---

## 13) Open Questions (track here)

* Do we keep explicit water depth `D` in v1 or fake with A/P only?
* Which clipmap level and terrain tile size for M1 target hardware?
* Do we add SSR later, or stick to refraction only?
