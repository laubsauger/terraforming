# Fluid & Erosion Implementation Todo List

Based on the architecture defined in `docs/concept/02_fluids.md`, `AGENTS.md`, and `docs/concept/01_core.md`, here's the implementation plan:

## Phase 1: GPU Field Infrastructure ✅ (Mostly Complete)
- [x] Height field (H) - R32F texture
- [x] Ping-pong buffer management
- [x] Field initialization and GPU texture setup
- [x] Thermal repose system

## Phase 2: Flow Field Core (Priority 1)
- [ ] **Slope → Velocity Pass** (compute shader)
  - [ ] Calculate gradient ∇H from height field
  - [ ] Convert to velocity: `v = normalize(∇H) * g * dt`
  - [ ] Apply damping by terrain roughness
  - [ ] Add optional inertia: `v = lerp(v_prev, v_new, α)`
  - [ ] Store as Flow field F (RG16F for u,v components)

- [ ] **Flow Accumulation Pass** (compute shader)
  - [ ] Route "rain" particles downhill following velocity field
  - [ ] Accumulate flow counts in texture A (R16F/R32F)
  - [ ] Add hysteresis to maintain channels when flow drops
  - [ ] Implement decay: `A = A * decay + new_accumulation`

## Phase 3: Water Simulation (Priority 2)
- [ ] **Water Depth Field** (optional for v1)
  - [ ] Add water depth texture D (R16F)
  - [ ] Semi-Lagrangian advection along velocity field
  - [ ] Apply continuity equation for mass conservation

- [ ] **Pooling Detection**
  - [ ] Calculate divergence of velocity field
  - [ ] Mark pool areas where `div(v) > threshold` and `|v| < speed_threshold`
  - [ ] Optional: priority-flood approximation for basin detection
  - [ ] Store pool mask P (R8 texture)

- [ ] **Ocean/Sea Level**
  - [ ] Mark cells at height ≤ sea_level as ocean
  - [ ] Flood-fill ocean regions (once at load)
  - [ ] Maintain soft boundary via distance transform

## Phase 4: Erosion System (Priority 3)
- [ ] **Hydraulic Erosion** (compute shader)
  - [ ] Calculate carrying capacity: `capacity = K * |v| * slope`
  - [ ] Pick up sediment when `sediment < capacity`
  - [ ] Deposit sediment when `sediment > capacity`
  - [ ] Update height field based on erosion/deposition
  - [ ] Maintain sediment field S (R16F)

- [ ] **Integration with existing Thermal Repose**
  - [ ] Combine hydraulic + thermal erosion in single pass
  - [ ] Ensure mass conservation across both systems

## Phase 5: Rendering Integration
- [ ] **River/Stream Rendering**
  - [ ] Generate river mask: `R = smoothstep(k1, k2, blur(A))`
  - [ ] Darken terrain albedo based on accumulation A
  - [ ] Add gloss/wetness based on water presence
  - [ ] Carve micro-normals along flow channels

- [ ] **Water Surface Rendering**
  - [ ] Use existing WaterMaterialTSL (already improved)
  - [ ] Sample flow field F for UV advection
  - [ ] Implement "flowmap ping-pong" for texture sliding
  - [ ] Add foam/streak particles at high curl(F) areas

- [ ] **Debug Overlays**
  - [ ] Flow field visualization (arrows/colors)
  - [ ] Accumulation heatmap
  - [ ] Pool mask overlay
  - [ ] Sediment concentration view

## Phase 6: Lava System (Priority 4)
- [ ] **Lava Fields**
  - [ ] Lava depth L (R16F)
  - [ ] Temperature T (R16F)
  - [ ] Crust mask C (R8)

- [ ] **Lava Physics**
  - [ ] Viscosity based on temperature: `μ(T)`
  - [ ] Slower flow: `flow_lava = F / (1 + μ * gain)`
  - [ ] Cooling: `T → ambient` over time
  - [ ] Solidification: when `T < T_threshold`, convert to rock

- [ ] **Lava Rendering**
  - [ ] Use existing LavaMaterialTSL
  - [ ] Emissive from blackbody(T)
  - [ ] Crust mask for matte vs shiny areas

## Phase 7: Performance & Polish
- [ ] **Resolution Scaling**
  - [ ] Run sim at 1/4 or 1/8 render resolution
  - [ ] Edge-aware upsampling for crisp channels
  - [ ] Quality settings (low/medium/high)

- [ ] **GPU Optimizations**
  - [ ] Pack fields efficiently (RG16F/RGBA16F)
  - [ ] Reuse bind groups
  - [ ] Add GPU timestamps for each pass
  - [ ] Profile and optimize slowest passes

- [ ] **UI Integration**
  - [ ] Add flow/erosion toggles
  - [ ] Erosion rate sliders
  - [ ] Rain intensity control
  - [ ] Water source placement tool

## Implementation Order (Recommended)
1. **Week 1**: Flow velocity + accumulation (Phase 2)
2. **Week 1-2**: Basic water rendering integration (Phase 5 partial)
3. **Week 2**: Hydraulic erosion (Phase 4)
4. **Week 2-3**: Water depth & pooling (Phase 3)
5. **Week 3**: Lava system (Phase 6)
6. **Week 4**: Polish & optimization (Phase 7)

## Key WGSL Shader Files Needed
- [ ] `FlowVelocity.wgsl` - Calculate flow from height gradient
- [ ] `FlowAccumulation.wgsl` - Accumulate flow downhill
- [ ] `HydraulicErosion.wgsl` - Erosion/deposition
- [ ] `WaterAdvection.wgsl` - Move water along flow
- [ ] `PoolDetection.wgsl` - Find pools/lakes
- [ ] `LavaFlow.wgsl` - Viscous lava movement
- [ ] `LavaCooling.wgsl` - Temperature & solidification

## Testing Checklist
- [ ] Streams naturally merge into rivers
- [ ] Water pools in depressions forming lakes
- [ ] Erosion creates realistic valleys
- [ ] 60 FPS maintained with all systems active
- [ ] Mass conservation verified (no water created/destroyed)
- [ ] Debug overlays clearly show system behavior

## Current Status
- ✅ Water material improved (less metallic, more scattered reflections)
- ✅ Core GPU infrastructure ready (fields, ping-pong, compute pipeline)
- ✅ Thermal repose working
- ⚠️ Flow/erosion shaders exist but need integration
- ❌ No water simulation implemented yet
- ❌ No lava flow physics

## Notes from Existing Code
Looking at the existing shaders in `packages/engine/src/gpu/shaders/`:
- Several erosion-related shaders already exist but aren't integrated
- Need to review and potentially refactor these for the new architecture
- Priority is getting basic flow field working first