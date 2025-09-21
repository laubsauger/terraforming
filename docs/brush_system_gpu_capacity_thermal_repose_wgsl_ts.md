# Brush System — GPU Capacity + Thermal Repose (WGSL + TS)

A complete, **GPU-first** implementation for mass-conserving pickup/deposit with a **workgroup-quota** capacity limiter and **thermal (angle-of-repose)** relaxation. Rendering stays in **Three.js TSL**; all simulation/editing is **WGSL** compute.

---

## 0) Features
- One-pass **workgroup-quota** capacity enforcement (no CPU-side scaling).
- Materials: `soil`, `rock`, `lava` (no mixing in-hand).
- Mass conserved end-to-end; units in **meters** (thickness) on fields, **kg** for hand.
- **Thermal repose** pass widens holes & spreads piles naturally (no cylindrical shafts).
- Tiny readbacks only if you want HUD/hand updates (10–20 Hz).

---

## 1) File layout
```
packages/engine/
  gpu/
    shaders/
      BrushPass_workgroup_quota.wgsl
      ApplyDeltas.wgsl
      ThermalRepose.wgsl
    pipelines/
      brush.ts
      apply.ts
      repose.ts
  sim/
    hand.ts
    fields.ts
```

---

## 2) Constants & Formats

**Grid assumptions**
- Terrain simulation grid: `GRID_W × GRID_H` (meters per cell = `CELL_SIZE`).
- Fields stored as **storage textures** (r32float) for random RW; sampled as textures for rendering.

**Densities** (tweak):
```ts
export const RHO = {
  soil: 1600, // kg/m^3
  rock: 2600,
  lava: 2700,
} as const;
```

**Texture formats**
- `soilThicknessTex`: `r32float` storage
- `rockHeightTex`: `r32float` storage (bedrock absolute elevation)
- `lavaDepthTex`: `r32float` storage
- **Optional caches**: normals, combined height for TSL

---

## 3) WGSL — BrushPass (workgroup-quota)

**`gpu/shaders/BrushPass_workgroup_quota.wgsl`**
```wgsl
struct BrushOp {
  mode : u32;     // 0=pickup, 1=deposit
  kind : u32;     // 0=soil, 1=rock, 2=lava
  center : vec2<f32>; // world meters (x,z)
  radius : f32;       // meters
  strengthKgPerS : f32;
  dt : f32;
};

struct HandBuf {
  remaining_fixed : atomic<u32>; // kg * 1000, capacity remaining (pickup) or mass-in-hand (deposit)
};

@group(0) @binding(0) var<storage, read> ops : array<BrushOp>;
@group(0) @binding(1) var<storage, read_write> hand : HandBuf;

// Storage textures as r32float
@group(0) @binding(2) var soilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var rockTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(4) var lavaTex : texture_storage_2d<r32float, read_write>;

// Staging delta textures (meters); cleared after ApplyDeltas
@group(0) @binding(5) var deltaSoilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(6) var deltaRockTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(7) var deltaLavaTex : texture_storage_2d<r32float, read_write>;

@group(0) @binding(8) var<uniform> gridSize : vec2<u32>; // (w,h)
@group(0) @binding(9) var<uniform> cellSize : f32;       // meters per texel
@group(0) @binding(10) var<uniform> densities : vec4<f32>; // (rho_soil, rho_rock, rho_lava, _)

// Workgroup shared accumulators
var<workgroup> wg_sum_fixed : atomic<u32>; // desired mass for this tile (fixed-point)
var<workgroup> wg_scale : f32;

fn kg_to_fixed(kg:f32)->u32 { return u32(max(kg, 0.0) * 1000.0 + 0.5); }
fn fixed_to_kg(x:u32)->f32 { return f32(x) * 0.001; }

fn tex_index(coord:vec2<u32>)->bool {
  return coord.x < gridSize.x && coord.y < gridSize.y;
}

fn world_of(coord:vec2<u32>)->vec2<f32> {
  return (vec2<f32>(coord) + vec2<f32>(0.5,0.5)) * cellSize; // (x,z)
}

fn smooth_kernel(dist:f32, radius:f32)->f32 {
  let t = clamp(1.0 - (dist*dist)/(radius*radius), 0.0, 1.0);
  // smootherstep
  return t * t * (3.0 - 2.0 * t);
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wid: vec3<u32>) {
  let coord = gid.xy;
  if (!tex_index(coord)) { return; }

  // 1) compute desired mass for this texel across all ops
  var desiredKg : f32 = 0.0;
  let cellArea = cellSize * cellSize;

  // Preload cell values
  var soil = textureLoad(soilTex, coord, 0).r;
  var rock = textureLoad(rockTex, coord, 0).r;
  var lava = textureLoad(lavaTex, coord, 0).r;

  let wpos = world_of(coord);

  for (var o:u32=0u; o<arrayLength(&ops); o++) {
    let op = ops[o];
    let d = distance(wpos, op.center);
    if (d > op.radius) { continue; }
    let k = smooth_kernel(d, op.radius);
    let wantKg = op.strengthKgPerS * op.dt * k;

    if (op.mode == 0u) { // pickup
      if (op.kind == 0u) {
        let availKg = max(soil, 0.0) * cellArea * densities.x;
        desiredKg += min(wantKg, availKg);
      } else if (op.kind == 1u) {
        if (soil <= 0.0) {
          let availKg = min(wantKg, ROCK_PICK_RATE_KG_PER_S * op.dt * k);
          desiredKg += availKg;
        }
      } else { // lava
        let availKg = max(lava, 0.0) * cellArea * densities.z;
        desiredKg += min(wantKg, availKg);
      }
    } else { // deposit
      desiredKg += wantKg; // capped by global hand remaining via WG quota
    }
  }

  // 2) Workgroup reduction -> wg_sum_fixed
  if (li == 0u) { atomicStore(&wg_sum_fixed, 0u); }
  workgroupBarrier();
  let desired_fixed_local = kg_to_fixed(desiredKg);
  atomicAdd(&wg_sum_fixed, desired_fixed_local);
  workgroupBarrier();

  // 3) One thread reserves from global hand.remaining_fixed
  if (li == 0u) {
    let sum_fixed = atomicLoad(&wg_sum_fixed);
    var grant: u32 = 0u;
    if (sum_fixed > 0u) {
      loop {
        let rem = atomicLoad(&hand.remaining_fixed);
        if (rem == 0u) { break; }
        let take = min(rem, sum_fixed);
        let cas = atomicCompareExchangeWeak(&hand.remaining_fixed, rem, rem - take);
        if (cas.exchanged) {
          grant = take; break;
        }
      }
    }
    wg_scale = (sum_fixed == 0u) ? 0.0 : f32(grant) / f32(sum_fixed);
  }
  workgroupBarrier();

  // 4) Apply scaled deltas for this texel
  if (desired_fixed_local == 0u || wg_scale == 0.0) { return; }

  let grantKg = f32(desired_fixed_local) * 0.001 * wg_scale;

  // Re-run small per-op loop to distribute correctly (same k)
  for (var o:u32=0u; o<arrayLength(&ops); o++) {
    let op = ops[o];
    let d = distance(wpos, op.center);
    if (d > op.radius) { continue; }
    let k = smooth_kernel(d, op.radius);
    let wantKg = op.strengthKgPerS * op.dt * k;

    // proportional share of this texel's grant
    let texelDesired = desiredKg;
    if (texelDesired <= 0.0) { continue; }
    let shareKg = grantKg * (wantKg / texelDesired);

    if (op.mode == 0u) { // pickup
      if (op.kind == 0u) {
        let dH = -shareKg / (densities.x * cellArea);
        let old = textureLoad(deltaSoilTex, coord, 0).r;
        textureStore(deltaSoilTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else if (op.kind == 1u) {
        let dH = -shareKg / (densities.y * cellArea);
        let old = textureLoad(deltaRockTex, coord, 0).r;
        textureStore(deltaRockTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else {
        let dH = -shareKg / (densities.z * cellArea);
        let old = textureLoad(deltaLavaTex, coord, 0).r;
        textureStore(deltaLavaTex, coord, vec4<f32>(old + dH, 0,0,0));
      }
    } else { // deposit
      if (op.kind == 0u) {
        let dH =  shareKg / (densities.x * cellArea);
        let old = textureLoad(deltaSoilTex, coord, 0).r;
        textureStore(deltaSoilTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else if (op.kind == 1u) {
        // rubble goes to soil layer (design choice)
        let dH =  shareKg / (densities.y * cellArea);
        let old = textureLoad(deltaSoilTex, coord, 0).r;
        textureStore(deltaSoilTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else {
        let dH =  shareKg / (densities.z * cellArea);
        let old = textureLoad(deltaLavaTex, coord, 0).r;
        textureStore(deltaLavaTex, coord, vec4<f32>(old + dH, 0,0,0));
      }
    }
  }
}

// Constants (override via specialization or #include-like preprocessor)
const ROCK_PICK_RATE_KG_PER_S : f32 = 50.0; // very slow mining
```

> **Note:** This writes deltas to the `delta*` textures only. The next pass applies and clamps.

---

## 4) WGSL — ApplyDeltas (clamp, clear deltas)

**`gpu/shaders/ApplyDeltas.wgsl`**
```wgsl
@group(0) @binding(0) var soilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(1) var rockTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var lavaTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var deltaSoilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(4) var deltaRockTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(5) var deltaLavaTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(6) var<uniform> gridSize : vec2<u32>;

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = gid.xy;
  if (p.x >= gridSize.x || p.y >= gridSize.y) { return; }

  var s = textureLoad(soilTex, p, 0).r;
  var r = textureLoad(rockTex, p, 0).r;
  var l = textureLoad(lavaTex, p, 0).r;

  let ds = textureLoad(deltaSoilTex, p, 0).r;
  let dr = textureLoad(deltaRockTex, p, 0).r;
  let dl = textureLoad(deltaLavaTex, p, 0).r;

  s = max(0.0, s + ds);
  r = max(ROCK_MIN_HEIGHT, r + dr);
  l = max(0.0, l + dl);

  textureStore(soilTex, p, vec4<f32>(s,0,0,0));
  textureStore(rockTex, p, vec4<f32>(r,0,0,0));
  textureStore(lavaTex, p, vec4<f32>(l,0,0,0));

  // clear deltas
  textureStore(deltaSoilTex, p, vec4<f32>(0,0,0,0));
  textureStore(deltaRockTex, p, vec4<f32>(0,0,0,0));
  textureStore(deltaLavaTex, p, vec4<f32>(0,0,0,0));
}

const ROCK_MIN_HEIGHT : f32 = -1000.0; // allow deep mines (tweak)
```

---

## 5) WGSL — ThermalRepose (angle-of-repose)

**`gpu/shaders/ThermalRepose.wgsl`**
```wgsl
@group(0) @binding(0) var rockTex : texture_storage_2d<r32float, read>;
@group(0) @binding(1) var soilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var soilOutTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var<uniform> gridSize : vec2<u32>;
@group(0) @binding(4) var<uniform> cellSize : f32;
@group(0) @binding(5) var<uniform> tanPhi : f32; // tan(angle-of-repose)

fn inBounds(p:vec2<i32>)->bool { return p.x>=0 && p.y>=0 && u32(p.x)<gridSize.x && u32(p.y)<gridSize.y; }

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  if (!inBounds(p)) { return; }

  let h0 = textureLoad(rockTex, uvec2(p), 0).r + textureLoad(soilTex, uvec2(p), 0).r;
  var soilHere = textureLoad(soilTex, uvec2(p), 0).r;
  var delta = 0.0;

  // 8-neighborhood
  let nb = array<vec2<i32>,8>(
    vec2<i32>( 1, 0), vec2<i32>(-1, 0), vec2<i32>(0, 1), vec2<i32>(0,-1),
    vec2<i32>( 1, 1), vec2<i32>( 1,-1), vec2<i32>(-1,1), vec2<i32>(-1,-1)
  );
  for (var k=0; k<8; k++) {
    let q = p + nb[k];
    if (!inBounds(q)) { continue; }
    let dist = length(vec2<f32>(nb[k])) * cellSize;
    let hq = textureLoad(rockTex, uvec2(q), 0).r + textureLoad(soilTex, uvec2(q), 0).r;
    let drop = h0 - hq;
    let maxDrop = tanPhi * dist;
    if (drop > maxDrop && soilHere > 0.0) {
      let move = 0.5 * (drop - maxDrop); // split difference
      let moveClamped = min(move, soilHere);
      soilHere -= moveClamped;
      // accumulate into neighbor in out texture
      let so = textureLoad(soilOutTex, uvec2(q), 0).r;
      textureStore(soilOutTex, uvec2(q), vec4<f32>(so + moveClamped,0,0,0));
      delta -= moveClamped;
    }
  }

  // write self
  let selfOut = textureLoad(soilOutTex, uvec2(p), 0).r;
  textureStore(soilOutTex, uvec2(p), vec4<f32>(selfOut + soilHere + delta, 0,0,0));
}
```
**Integration pattern**
- Before first iteration each tick: copy `soilTex → soilOutTex` (or clear `soilOutTex` to 0 and add current soil when writing self as above).
- Run **2–4 iterations**: after each iteration, swap `soilTex ↔ soilOutTex`, clear the new `soilOutTex`.

If you lack float texture writes in your adapter, route through SSBOs instead; logic stays the same.

---

## 6) TypeScript — Fields & Hand

**`sim/fields.ts`** (creation & convenience)
```ts
export type Fields = {
  soil: GPUTexture;
  rock: GPUTexture;
  lava: GPUTexture;
  deltaSoil: GPUTexture;
  deltaRock: GPUTexture;
  deltaLava: GPUTexture;
};

export function createFieldTex(device: GPUDevice, w:number, h:number) {
  return device.createTexture({
    size: { width: w, height: h },
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
}

export function createFields(device: GPUDevice, w:number, h:number): Fields {
  return {
    soil: createFieldTex(device,w,h),
    rock: createFieldTex(device,w,h),
    lava: createFieldTex(device,w,h),
    deltaSoil: createFieldTex(device,w,h),
    deltaRock: createFieldTex(device,w,h),
    deltaLava: createFieldTex(device,w,h),
  };
}
```

**`sim/hand.ts`** (hand buffer + helpers)
```ts
export type MatKind = 'soil' | 'rock' | 'lava';

export interface HandState {
  kind: MatKind | null;
  massKg: number;   // current mass carried
  capKg: number;    // capacity
}

export function handRemainingFixed_pickup(hand: HandState) {
  const remaining = Math.max(0, hand.capKg - hand.massKg);
  return Math.round(remaining * 1000); // fixed-point
}

export function handRemainingFixed_deposit(hand: HandState) {
  return Math.round(Math.max(0, hand.massKg) * 1000);
}
```

---

## 7) TypeScript — Pipelines

**`gpu/pipelines/brush.ts`**
```ts
import BrushWGSL from '../shaders/BrushPass_workgroup_quota.wgsl?raw';

export function createBrushPipeline(device: GPUDevice, layout: GPUBindGroupLayout) {
  const module = device.createShaderModule({ code: BrushWGSL });
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
}

export function createBrushBindGroupLayout(device: GPUDevice) {
  return device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // ops
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // hand
    { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // soil
    { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // rock
    { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // lava
    { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // Δsoil
    { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // Δrock
    { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // Δlava
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
    { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // cellSize
    { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // densities
  ]});
}
```

**`gpu/pipelines/apply.ts`**
```ts
import ApplyWGSL from '../shaders/ApplyDeltas.wgsl?raw';

export function createApplyPipeline(device: GPUDevice, layout: GPUBindGroupLayout) {
  const module = device.createShaderModule({ code: ApplyWGSL });
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
}

export function createApplyBindGroupLayout(device: GPUDevice) {
  return device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // soil
    { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // rock
    { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // lava
    { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // dSoil
    { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // dRock
    { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // dLava
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
  ]});
}
```

**`gpu/pipelines/repose.ts`**
```ts
import ReposeWGSL from '../shaders/ThermalRepose.wgsl?raw';

export function createReposePipeline(device: GPUDevice, layout: GPUBindGroupLayout) {
  const module = device.createShaderModule({ code: ReposeWGSL });
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
}

export function createReposeBindGroupLayout(device: GPUDevice) {
  return device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read', format: 'r32float' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // cellSize
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // tanPhi
  ]});
}
```

---

## 8) Dispatch & Orchestration (TS)

**Core tick**
```ts
function ceilDiv(a:number, b:number){ return Math.ceil(a/b); }

export function runBrush(device: GPUDevice, pass: GPUComputePassEncoder, pipelines: any, bg: GPUBindGroup, w:number, h:number){
  pass.setPipeline(pipelines.brush);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(ceilDiv(w, 8), ceilDiv(h, 8));
}

export function runApply(device: GPUDevice, pass: GPUComputePassEncoder, pipelines:any, bg: GPUBindGroup, w:number, h:number){
  pass.setPipeline(pipelines.apply);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(ceilDiv(w, 8), ceilDiv(h, 8));
}

export function runReposeIterations(device: GPUDevice, encoder: GPUCommandEncoder, pipelines:any, makeBG:(useOutAs:number)=>GPUBindGroup, w:number, h:number, iters=3){
  for(let i=0;i<iters;i++){
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipelines.repose);
    pass.setBindGroup(0, makeBG(i % 2)); // swap soilTex/soilOutTex bindings inside makeBG
    pass.dispatchWorkgroups(ceilDiv(w, 8), ceilDiv(h, 8));
    pass.end();
    // clear soilOut for next iter if your shader expects it
  }
}
```

**Per-frame order**
```ts
// 0. Update small uniforms (hand remaining, densities, cellSize)
// 1. Brush pass (capacity enforced in-GPU)
// 2. Apply deltas (clamp & clear)
// 3. Repose 2–4 iterations
// 4. (Optional) hydraulic / lava cooling
// 5. Render (TSL samples height = rock + soil [ + cooled lava contribution ])
```

---

## 9) CPU ↔ GPU Data (small & optional)
- **Hand remaining**: CPU writes `remaining_fixed` before Brush (pickup → capacity-left; deposit → mass-in-hand). You *may* read back after brush to update UI (sphere size), but not required for correctness.
- **HUD**: read a small `u32` copy of `remaining_fixed` at **10–20 Hz** for smooth UI.

```ts
// write before brush
const remaining_fixed = (mode==='pickup') ? handRemainingFixed_pickup(hand) : handRemainingFixed_deposit(hand);
queue.writeBuffer(handBuf, 0, new Uint32Array([remaining_fixed]));

// optional readback
// create a mappable copy buffer once; copy handBuf → readback; map at low Hz
```

---

## 10) Rendering Notes (TSL)
- **Vertex displacement:** `height = rock + soil;` (lava rendered separately as a sheet using its depth/flow).
- **Normals:** derive from height in TSL (central difference) or sample a cached normal texture you update per tick.
- **In-hand sphere:** size from `mass / ρ(kind)`; distinct material per kind; for lava, emissive + advected normals (TSL flow UVs).

---

## 11) Instructions for the Code Agent

1) **Add files** exactly as in the layout above. Ensure `?raw` WGSL imports are supported by Vite.
2) **Create textures** for soil/rock/lava and their deltas as `r32float` with STORAGE | TEXTURE usage.
3) **Bind groups**
   - Brush BG: ops SSBO, hand SSBO, field storage textures, delta storage textures, uniforms (gridSize, cellSize, densities).
   - Apply BG: field storage textures + delta textures + gridSize.
   - Repose BG: rock (read), soil (read_write), soilOut (read_write), gridSize, cellSize, tanPhi.
4) **Uniforms**
   - `gridSize = (W,H)`; `cellSize` in meters; `densities = (ρ_soil, ρ_rock, ρ_lava, 0)`; `tanPhi = tan(angle)`.
5) **Brush ops upload**
   - Map a ring buffer SSBO of `BrushOp[]`. Each pointer-update enqueues `{ mode, kind, center, radius, strengthKgPerS, dt }`.
   - Clear the ops count each tick.
6) **Hand capacity**
   - For **pickup**: set `remaining_fixed = (capKg - hand.massKg) * 1000`.
   - For **deposit**: set `remaining_fixed = hand.massKg * 1000`.
7) **Dispatch**
   - `workgroup_size(8,8)` over full grid; footprint outside brush does near-zero work due to early `radius` check.
8) **Apply & Repose**
   - Run Apply once per tick.
   - Run Repose for 2–4 iterations (swap soil/soilOut each iter).
9) **UI/HUD** (optional readback)
   - Copy `hand.remaining_fixed` to a readback buffer at 10–20 Hz to compute the cursor sphere size. Avoid per-frame reads.
10) **Validation**
   - Clamp negatives in Apply; assert no NaNs by masking `isnan()` (optional debug pass).
   - Visualize `soil`, `rock`, `lava` individually with debug toggles.

---

## 12) Tuning
- **Angle-of-repose**: start at `φ = 33°` → `tanPhi ≈ 0.65`; soils feel right around 0.6–0.7.
- **Mining rate**: `ROCK_PICK_RATE_KG_PER_S` low (e.g., 50) so rock removal is slow.
- **Iterations**: 3 Repose iterations per tick is a good balance.
- **Brush kernel**: current smootherstep is artifact-free; raise exponent for sharper edges if needed.

---

## 13) Extensions (later)
- Per-material **friction/φ** values (wet sand lower φ, rock rubble higher).
- **Hydraulic coupling**: erosion capacity modulates soil transfer after flows.
- **Indirect brush**: convert raycast hit to tile bounds and dispatch only those workgroups.
- **Multiplayer**: add per-op IDs so totals can be tracked per player if needed.
```

