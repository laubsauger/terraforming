# Project Concept & Implementation Plan — Browser-Based Terraforming & Erosion Prototype (Three.js + WebGPU + React + TypeScript + pnpm)

> Scope: Build a highly-performant, visually beautiful sandbox where players deform terrain and run accelerated erosion/terraforming simulations. No NPCs. Tight, elegant controls. Performance-first architecture with GPU-centric simulation and rendering.

---

## 1) Creative Pillars & Inspiration

* **Core fantasy:** godlike manipulation of earth, water, and lava to sculpt a living landscape that reacts in seconds.
* **Inspirations to translate (mechanics, not code):**

  * **Matter manipulation:** pick up / deposit **soil, water, lava**; water erodes, lava cools into rock; vegetation emerges on soil. ([Wikipedia][1])
  * **Fast environmental responses:** rapid terrain restructuring, sediment deposition, diversions and dams. ([Wikipedia][1])
  * **Natural hazards as systems:** tsunamis/volcanism in the original—our v1 keeps it simpler (rain inputs, inflow/outflow, lava vents). ([Wikipedia][1])

**Prototype gameplay loop (v1):**

1. **Deform terrain** (brush tools: raise/lower/smooth; deposit/remove materials).
2. **Run erosion/terraform** (toggle time, speed slider).
3. **Place sources/sinks** (water emitter, lava vent) to watch systems evolve.
4. **Measure** (live perf HUD, GPU timings; toggles to visualize buffers).

---

## 2) Technical Pillars

* **WebGPU-first**: simulations (erosion, fluids, thermal) run in **compute shaders**; minimize CPU↔GPU roundtrips.
* **Three.js (WebGPU renderer)** for scene graph, camera, input, and material nodes (TSL) where it helps. (Three’s WebGPURenderer/TSL are available in recent releases; migration implies async rendering, TSL materials.) ([GitHub][2])
* **Stable frame times:** tile-based compute, fixed workgroup sizes, ping-pong buffers, and double/triple buffering for all dynamic resources.
* **Instrumentation from day 0:** WebGPU **timestamp queries** via `GPUQuerySet` for GPU-side timings; React HUD showing *CPU frame*, *GPU passes*, *draw/dispatch counts*, and *VRAM est.* ([MDN Web Docs][3])

---

## 3) Gameplay & Simulation Design (v1)

### 3.1 Terrain Representation

* **Heightfield + material layers** (R32F height + RGBA8 materials = {soil, rock, water depth proxy, lava?} or split into multiple textures for precision).
* **Clipmapped tiles** for large terrains, **2048² working tile** for the prototype (expand later).
* **Derived maps:** slope, curvature, water velocity, sediment capacity.

### 3.2 Fluids: Shallow Water (2.5D)

* **Approach:** GPU shallow-water equations (height/velocity per cell) with semi-Lagrangian advection or MacCormack where stable; CFL-capped dt.
  Sources: shallow-water on GPU and interactive variants (GLSL/Web) — technique guidance. ([aeplay.github.io][4])

**Compute passes (per tick):**

1. **External forces/inputs:** rainfall, sources/sinks, lava inflow.
2. **Flux/velocity update:** conservative update, boundary conditions.
3. **Advection/Diffusion:** stabilize with limiter; clamp negatives.
4. **Erosion/Deposition coupling:** update sediment & bed height.
5. **Viscosity/evaporation:** small damping & optional evaporation.

### 3.3 Erosion (Hydraulic + Thermal)

* **Hydraulic:** pick-up based on **capacity = k · |v| · slope**, deposit when capacity < sediment; update bed height & sediment buffer.
* **Thermal:** creep when local slope exceeds angle-of-repose threshold; redistribute to neighbors.

### 3.4 Lava & Solidification (v1 light)

* **Scalar lava depth + temperature** fields; **cooling → rock** conversion when temp < threshold; lava adds to bed height as rock. (Inspired by lava→rock behavior from the reference.) ([fromdust.fandom.com][5])

---

## 4) Rendering & Visuals

### 4.1 Visual Target & Aesthetic

**Target Visual Reference:** Tropical island environments with vibrant, stylized realism reminiscent of games like Tropico or From Dust. Key characteristics include:

* **Terrain:** Varied elevation from sandy beaches to volcanic peaks with rich color gradients
* **Water:** Clear turquoise shallows transitioning to deep blue, with visible caustics and foam
* **Vegetation:** Lush tropical foliage (palm trees, dense undergrowth) placed procedurally based on elevation, moisture, and slope
* **Materials:** High contrast between white sand beaches, dark volcanic rock, and verdant soil
* **Atmosphere:** Bright, saturated colors with strong directional lighting creating dramatic shadows
* **Scale:** Island-scale terraforming where individual beaches, bays, and mountain ridges are clearly distinguishable

### 4.2 Technical Implementation

* **Renderer:** `THREE.WebGPURenderer` with **TSL** node materials where possible; custom WGSL compute for simulation, sampling the results in materials for rendering. (Docs/forums indicate use of WebGPU builds & TSL nodes.) ([GitHub][2])
* **Terrain draw:** single **mesh grid** (heightfield in vertex stage via texture fetch) with **triplanar** material blending (soil/rock/lava), **screen-space water** overlay or a second pass.
* **Water:** either render from shallow-water height as a **separate surface** with normals from gradients; cheap refraction/fresnel.
* **Lava:** emissive+distortion with cooling mask; subtle flow lines from velocity field.
* **Lighting:** single directional + ambient; later add cascaded shadows if perf allows.
* **Post:** restrained—FXAA/TAA optional; avoid bandwidth-heavy passes early.

**CPU↔GPU minimization:**

* Upload terrain inputs **once**; all simulation happens in GPU buffers.
* **Bindless-like** approach via bind groups reused per pass; **no readbacks** during frame (only on-demand for screenshots/export).
* Use **indirect dispatch/draw** counts prepared on GPU (phase 2).

Short answer: **use a height/displacement map and sample it in the vertex stage**, not direct CPU-side vertex edits.

Here’s why (for your WebGPU-first sim):

* **Keeps everything on the GPU.** Your erosion/flow kernels already live in compute; they can write the **heightfield texture/buffer** directly. The vertex shader just reads that to displace a regular grid. Zero CPU↔GPU roundtrips.
* **Cheap, scalable LOD.** Heightmaps + clipmaps/tiles are trivial; swapping or mip-stepping a texture is way cheaper than rebuilding/indexing big vertex buffers every frame.
* **Easy normals & effects.** Derive normals from height gradients in-shader; same field also drives wetness, foam, and river masks. One source of truth.
* **Stable frame times.** Regular grid + persistent bind groups + no geometry churn → fewer stalls than mutating large VBOs.

When would you manipulate vertex buffers instead?

* You need **non-heightfield topology** (caves/overhangs, marching cubes, destructible meshes).
* You’re targeting a **fixed, small mesh** with rare updates (then a storage buffer + compute rewrite can be fine).

### Recommended setup

* **Geometry:** single plane grid (or tiled clipmaps).
* **Data:** `heightTex` (R32F or RG16F) written by compute; optional `heightDelta` for brushes then applied.
* **Vertex stage:** sample `heightTex` at the grid UV → set `position.y`. Compute normal from central differences on `heightTex` (or from a precomputed normal map if you want).
* **Rendering:** triplanar blend using the same height-derived normal; water/lava sample height & flow fields.

Pseudo (vertex stage idea):

```wgsl
// Attributes: aPos.xy is grid in [0,1], z unused.
// Uniforms: world scale; Textures: heightTex
let h = textureSampleLevel(heightTex, sampLin, aPos.xy, 0.0).r;
let worldPos = vec3(aPos.x * WORLD_X, h * HEIGHT_SCALE, aPos.y * WORLD_Z);
```

If later you outgrow pure heightfields (caves), introduce a **second path** (marching cubes or SDF mesh) just for those features, and keep the bulk terrain as a displaced grid.

So for this prototype—**height/displacement map all the way.**

---

## 5) Controls & UX

* **Mouse:** LMB raise/deposit, RMB lower/remove, MMB smooth.
* **Modifiers:** Shift size+, Alt strength+, Ctrl pick material (soil/water/lava).
* **Keyboard:** Space = Pause/Play; `1/2/3` time scale; `R` rain toggle; `F` flood fill (debug).
* **UI (React):**

  * Sliders: **Brush size**, **Strength**, **Time scale**.
  * Toggles: **Show wireframe**, **Show flow**, **Show sediment**, **Show timings**.
  * Perf HUD: FPS, CPU ms, **GPU pass timings** (query results), dispatch/draw counts, buffer/texture usage summary.

---

## 6) Performance & Instrumentation

* **Budgets:** 16.6 ms @ 60 FPS target on mid-range dGPU; stretch 8.3 ms @ 120.
* **GPU queries:** `GPUQuerySet` for **timestamps** around each compute & render pass; Chrome exposes timestamp features (documented). ([MDN Web Docs][3])
* **Framegraph mindset:** declare passes & resources; ensure write-after-read hazards are resolved; keep barriers minimal.
* **Quality scaling knobs:**

  * Simulation: grid resolution, substeps, tiling size, diffusion toggles.
  * Rendering: terrain mesh density, water quality, normal map detail, shadows off/on.
  * **Dynamic resolution** for heightfield sampling.
* **Debug views:** visualize **workgroup tiles**, **CFL numbers**, **nan/inf mask**, **overdraw** (heatmap).

---

## 7) Project Structure (pnpm + Vite + React + TypeScript)

```text
terraforming-proto/
├─ packages/
│  ├─ engine/                    # core sim & rendering glue (no React)
│  │  ├─ gpu/
│  │  │  ├─ pipelines/           # pipeline builders (compute/render)
│  │  │  ├─ shaders/             # WGSL: fluid, erosion, thermal, lava
│  │  │  └─ framegraph/          # lightweight pass scheduler
│  │  ├─ sim/
│  │  │  ├─ terrain.ts           # heightfield + materials alloc/IO
│  │  │  ├─ fluids.ts            # shallow water state/passes
│  │  │  ├─ erosion.ts           # hydraulic/thermal coupling
│  │  │  └─ lava.ts              # lava cooling & deposition
│  │  ├─ render/
│  │  │  ├─ terrainMesh.ts       # three.js mesh + height fetch in VS
│  │  │  ├─ materials.ts         # TSL node mats for terrain/water/lava
│  │  │  └─ renderer.ts          # THREE.WebGPURenderer wrapper
│  │  └─ perf/
│  │     ├─ gpuTimers.ts         # GPUQuerySet helpers
│  │     └─ counters.ts          # frame stats, buffer sizes
│  ├─ types/                     # shared TS contracts & DTOs
│  └─ assets/                    # textures, LUTs
├─ apps/
│  └─ playground/                # Vite app shell (React)
│     ├─ src/
│     │  ├─ ui/                   # HUD, controls, Zustand store
│     │  ├─ components/ui/       # shadcn primitives (app-local)
│     │  └─ lib/
│     ├─ main.tsx
│     └─ App.tsx
├─ pnpm-workspace.yaml
├─ package.json
├─ tsconfig.json
└─ vite.config.ts
```

**Key choices**

* **Vite** for fast dev & WGSL loader (custom plugin to import `.wgsl`).
* **Engine package = framework-agnostic** (pure TS + WebGPU + Three).
* **HUD lives inside apps/playground/src/ui**; still React-only, but shipped with the playground for direct iteration.
* **Shared types in @terraforming/types** to decouple engine/app and stabilise DTOs.
* **UI state via Zustand slices**; dedicated store per engine instance to avoid prop drilling and control re-render surfaces.
* **Tailwind v4 + shadcn UI kit** provide consistent styling primitives for the playground shell.

---

## 8) Data Flow & GPU Resources

* **Textures/Buffers**

  * `heightTex` (R32F), `waterH`, `waterU`, `waterV` (R32F), `sediment` (R16F), `materialMask` (RGBA8), `lavaH`, `lavaT`.
  * **Ping-pong** pairs for any field updated in-place (`A/B`).
* **Bind groups**

  * `SimReadBG`, `SimWriteBG` per pass with immutable layout.
* **Pass order (per frame while running)**

  1. Input brush → **compute** write to staging deltas.
  2. Fluids step (flux → advect → boundary).
  3. Erosion/deposition.
  4. Thermal creep.
  5. Lava cooling/solidification.
  6. Swap ping-pong; clear staging.
  7. **Render** terrain+water+lava.

---

## 9) Example WGSL Sketches (illustrative, not final)

**Hydraulic capacity & erosion (kernel core):**

```wgsl
@group(0) @binding(0) var<storage, read> height : array<f32>;
@group(0) @binding(1) var<storage, read> velU   : array<f32>;
@group(0) @binding(2) var<storage, read> velV   : array<f32>;
@group(0) @binding(3) var<storage, read_write> sediment : array<f32>;
@group(0) @binding(4) var<storage, read_write> bed     : array<f32>;

const K_CAP : f32 = 0.75;
const ERODE_RATE : f32 = 0.002;
const DEPOSIT_RATE : f32 = 0.003;

@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = index(gid.xy);
  let slope = estimateSlope(i);        // from neighbor heights
  let speed = length(vec2(velU[i], velV[i]));
  let capacity = K_CAP * speed * slope;

  if (sediment[i] > capacity) {
    // deposit
    let d = min(sediment[i] - capacity, DEPOSIT_RATE);
    sediment[i] -= d;
    bed[i] += d;
  } else {
    // erode
    let e = min(capacity - sediment[i], ERODE_RATE);
    sediment[i] += e;
    bed[i] -= e;
  }
}
```

**Brush write (accumulate deltas to avoid data hazards):**

```wgsl
// Writes to a delta texture, later applied in a dedicated pass
@group(0) @binding(0) var<storage, read> brushOps : array<BrushOp>;
@group(0) @binding(1) var<storage, read_write> heightDelta : array<f32>;
```

---

## 10) Three.js Integration (WebGPU)

* Use **`THREE.WebGPURenderer`**; terrain as a single plane with vertex displacement from `heightTex` sampled in the vertex stage; TSL nodes for triplanar splat and for sampling debug views. (Three community notes r167+ adds webgpu builds and TSL focus.) ([GitHub][2])
* Water: separate mesh rendered after terrain, normals from water height gradient.
* Camera: **Arcball** with damped inertia; gizmo for source placement.

---

## 11) Milestones

**M0 – Bootstrap (1–2 days)**

* pnpm workspace, Vite React app, WebGPU feature check, Three.js WebGPU renderer boot scene.
* Wire perf HUD (CPU frame delta, RAF loop).

**M1 – Terrain & Brush (3–5 days)**

* Heightfield alloc, brush deltas (compute), vertex displacement render.
* Triplanar material + simple lighting.

**M2 – Shallow Water v1 (1 week)**

* Water state buffers, stable step, boundary conditions, render surface.
* Basic erosion coupling (pick-up/deposit).

**M3 – Instrumentation (2–3 days)**

* GPU **timestamp queries** around each pass; on-screen timings; export JSON profile. ([MDN Web Docs][3])

**M4 – Thermal & Lava (1 week)**

* Angle-of-repose creep; lava temp/cooling to rock; emissive pass.

**M5 – Polish & Scalability (ongoing)**

* Clipmaps, dynamic quality, UI refinement, code cleanup.

---

## 12) Risks & Mitigations

* **WebGPU feature variability**: gate features (timestamp queries, 16-bit storage) with runtime checks; graceful fallbacks. ([MDN Web Docs][6])
* **Three.js WebGPU maturity**: stick to **documented** surfaces; isolate renderer wrapper to swap if needed; track r167+ changes (TSL). ([GitHub][2])
* **Numerical stability**: enforce CFL condition; clamp/limiters; per-tile dt caps.
* **Bandwidth & sync stalls**: no per-frame readbacks; persistent bind groups; pack fields to reduce textures where safe.

---

## 13) Acceptance Criteria (Prototype)

* Runs in desktop Chrome/Edge with WebGPU on by default.
* 60 FPS on a mid-range dGPU at **1024² sim** and **1080p** render with water+erosion enabled.
* Brush interactions update terrain **<100 ms end-to-end**.
* Perf HUD shows GPU timings per pass (compute+render) and dispatch counts.
* Toggleable debug visualizations for flow, sediment, and lava cooling.

---

## 14) Implementation Notes & References

* **From Dust** mechanics: matter manipulation, fast terrain response, lava→rock, erosion/water behaviors. ([Wikipedia][1])
* **WebGPU API & queries:** MDN GPUQuerySet and timestamp features; Chrome WebGPU updates. ([MDN Web Docs][3])
* **Three.js WebGPU & TSL state:** forum/issue threads on r167+ WebGPURenderer/TSL. ([GitHub][2])
* **Shallow water techniques** (GPU): interactive and academic references for 2.5D fluids. ([aeplay.github.io][4])
* **WebGPU spec overview:** W3C / MDN background. ([W3C][7])

---

## 15) Next Steps (Concrete)

1. Scaffold repo + workspace; create **engine** & **ui** packages.
2. Stand up **WebGPURenderer** scene with a displaced plane from a static heightmap.
3. Add **GPU timers** wrapper and perf HUD early (even with dummy passes).
4. Implement **brush → heightDelta** compute, then apply to height.
5. Implement **water step v1** (no erosion), render it; then **erosion coupling**.
6. Add **thermal** and **lava cooling** passes; refine materials.
7. Clipmaps + quality toggles; finalize debug views; record perf baselines.

---

If you want, I can turn this into a repo skeleton (pnpm workspace + Vite + Three.js WebGPU + folders + WGSL stubs) so you can run it locally on day one.

[1]: https://en.wikipedia.org/wiki/From_Dust?utm_source=chatgpt.com "From Dust"
[2]: https://github.com/mrdoob/three.js/issues/28957?utm_source=chatgpt.com "Documentation: State of `WebGPURenderer` and Nodes"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet?utm_source=chatgpt.com "GPUQuerySet - Web APIs - MDN"
[4]: https://aeplay.github.io/WebFlood/interactive_shallow_water.pdf?utm_source=chatgpt.com "Interactive Shallow-Water-Simulations in City Environments"
[5]: https://fromdust.fandom.com/wiki/Lava?utm_source=chatgpt.com "Lava | From Dust Wiki | Fandom"
[6]: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API?utm_source=chatgpt.com "WebGPU API - Web APIs | MDN - Mozilla"
[7]: https://www.w3.org/TR/webgpu/?utm_source=chatgpt.com "WebGPU"
