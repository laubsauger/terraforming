struct BrushOp {
  mode : u32,     // 0=pickup, 1=deposit
  kind : u32,     // 0=soil, 1=rock, 2=lava
  center : vec2<f32>, // world meters (x,z)
  radius : f32,       // meters
  strengthKgPerS : f32,
  dt : f32,
};

struct HandBuf {
  remaining_fixed : atomic<u32>, // kg * 1000, capacity remaining (pickup) or mass-in-hand (deposit)
};

@group(0) @binding(0) var<storage, read> ops : array<BrushOp>;
@group(0) @binding(1) var<storage, read_write> hand : HandBuf;

// Storage textures as r32float (read-only, we only read current values)
@group(0) @binding(2) var soilTex : texture_storage_2d<r32float, read>;
@group(0) @binding(3) var rockTex : texture_storage_2d<r32float, read>;
@group(0) @binding(4) var lavaTex : texture_storage_2d<r32float, read>;

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
  let in_bounds = tex_index(coord);

  // 1) compute desired mass for this texel across all ops
  var desiredKg : f32 = 0.0;
  let cellArea = cellSize * cellSize;

  // Preload cell values (only if in bounds)
  var soil = 0.0;
  var rock = 0.0;
  var lava = 0.0;
  var wpos = vec2<f32>(0.0, 0.0);

  if (in_bounds) {
    soil = textureLoad(soilTex, coord).r;
    rock = textureLoad(rockTex, coord).r;
    lava = textureLoad(lavaTex, coord).r;
    wpos = world_of(coord);
  }

  // Only compute if in bounds
  if (in_bounds) {
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
  } // end if (in_bounds)

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
    wg_scale = select(0.0, f32(grant) / f32(sum_fixed), sum_fixed != 0u);
  }
  workgroupBarrier();

  // 4) Apply scaled deltas for this texel (only if in bounds and have work to do)
  if (in_bounds && desired_fixed_local != 0u && wg_scale != 0.0) {
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
        let old = textureLoad(deltaSoilTex, coord).r;
        textureStore(deltaSoilTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else if (op.kind == 1u) {
        let dH = -shareKg / (densities.y * cellArea);
        let old = textureLoad(deltaRockTex, coord).r;
        textureStore(deltaRockTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else {
        let dH = -shareKg / (densities.z * cellArea);
        let old = textureLoad(deltaLavaTex, coord).r;
        textureStore(deltaLavaTex, coord, vec4<f32>(old + dH, 0,0,0));
      }
    } else { // deposit
      if (op.kind == 0u) {
        let dH =  shareKg / (densities.x * cellArea);
        let old = textureLoad(deltaSoilTex, coord).r;
        textureStore(deltaSoilTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else if (op.kind == 1u) {
        // rubble goes to soil layer (design choice)
        let dH =  shareKg / (densities.y * cellArea);
        let old = textureLoad(deltaSoilTex, coord).r;
        textureStore(deltaSoilTex, coord, vec4<f32>(old + dH, 0,0,0));
      } else {
        let dH =  shareKg / (densities.z * cellArea);
        let old = textureLoad(deltaLavaTex, coord).r;
        textureStore(deltaLavaTex, coord, vec4<f32>(old + dH, 0,0,0));
      }
    }
  }
  } // end if (in_bounds && have work)
}

// Constants (override via specialization or #include-like preprocessor)
const ROCK_PICK_RATE_KG_PER_S : f32 = 50.0; // very slow mining