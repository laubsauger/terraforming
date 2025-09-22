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

// Combined storage textures using RGBA channels
// fieldsTex: R=soil, G=rock, B=lava, A=unused (read-only)
@group(0) @binding(2) var fieldsTex : texture_storage_2d<rgba32float, read>;

// deltasTex: R=Δsoil, G=Δrock, B=Δlava, A=unused (write-only, no accumulation)
@group(0) @binding(3) var deltasTex : texture_storage_2d<rgba32float, write>;

@group(0) @binding(4) var<uniform> gridSize : vec2<u32>; // (w,h)
@group(0) @binding(5) var<uniform> cellSize : f32;       // meters per texel
@group(0) @binding(6) var<uniform> densities : vec4<f32>; // (rho_soil, rho_rock, rho_lava, _)

// Workgroup shared accumulators
var<workgroup> wg_sum_fixed : atomic<u32>; // desired mass for this tile (fixed-point)
var<workgroup> wg_scale : f32;

// Auto-generated terrain constants - DO NOT EDIT MANUALLY
const SEA_LEVEL_NORMALIZED: f32 = 0.15;
const HEIGHT_SCALE: f32 = 64.0;
const WATER_LEVEL_ABSOLUTE: f32 = 9.6;
const MAX_HEIGHT_ABSOLUTE: f32 = 64.0;
const OCEAN_DEPTH_RANGE: f32 = 9.6;

// Ocean floor is the absolute minimum (0 meters)
const OCEAN_FLOOR: f32 = 0.0;

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

const ROCK_PICK_RATE_KG_PER_S = 50.0; // when eroding rock with no soil left
const WG_SIZE = 64u; // 8x8

@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(local_invocation_index) li:u32) {
  let coord = gid.xy;
  let in_bounds = tex_index(coord);

  // 1) Each thread computes desired mass for its cell
  var desiredKg : f32 = 0.0;
  let cellArea = cellSize * cellSize;

  // Preload cell values (only if in bounds)
  var fields = vec4<f32>(0.0);
  var wpos = vec2<f32>(0.0, 0.0);

  if (in_bounds) {
    fields = textureLoad(fieldsTex, coord);
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
      if (op.kind == 0u) { // soil
        let availKg = max(fields.r, 0.0) * cellArea * densities.x;
        desiredKg += min(wantKg, availKg);
      } else if (op.kind == 1u) { // rock
        // Calculate current total height in meters (sum of all materials)
        let totalHeight = fields.r + fields.g + fields.b;
        // Only erode rock if no soil on top AND above ocean floor
        // CRITICAL: Ocean floor (0m) is the absolute minimum - no digging below
        if (fields.r <= 0.0 && totalHeight > OCEAN_FLOOR) {
          // Maximum erosion cannot go below ocean floor
          let maxErosion = max(0.0, totalHeight - OCEAN_FLOOR);
          let maxKg = maxErosion * cellArea * densities.y;
          let availKg = min(min(wantKg, ROCK_PICK_RATE_KG_PER_S * op.dt * k), maxKg);
          desiredKg += availKg;
        }
      } else { // lava
        let availKg = max(fields.b, 0.0) * cellArea * densities.z;
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

  // 3) First thread claims from global hand budget
  if (li == 0u) {
    let wg_desired_fixed = atomicLoad(&wg_sum_fixed);
    let claimed_fixed = atomicSub(&hand.remaining_fixed, min(wg_desired_fixed, atomicLoad(&hand.remaining_fixed)));
    let actual_claimed = min(claimed_fixed, wg_desired_fixed);
    if (wg_desired_fixed > 0u) {
      wg_scale = f32(actual_claimed) / f32(wg_desired_fixed);
    } else {
      wg_scale = 0.0;
    }
  }
  workgroupBarrier();

  // 4) Each thread applies scaled changes to deltas
  if (!in_bounds) { return; }
  let actualKg = desiredKg * wg_scale;
  if (actualKg == 0.0) { return; }

  // determine material and density
  var k = 0u;
  var density = densities.x;
  for (var o:u32=0u; o<arrayLength(&ops); o++) {
    let op = ops[o];
    let d = distance(wpos, op.center);
    if (d > op.radius) { continue; }
    k = op.kind;
    if (k == 0u) {
      density = densities.x;
    } else if (k == 1u) {
      density = densities.y;
    } else {
      density = densities.z;
    }
    break;
  }

  var delta_kg = actualKg;
  if (ops[0].mode == 0u) {
    // pickup: compute actual removal
    if (k == 0u) { // soil
      let s1 = fields.r;
      let avail_m = max(s1, 0.0);
      let want_m = actualKg / (cellArea * density);
      let actual_m = min(want_m, avail_m);
      delta_kg = -actual_m * cellArea * density;
    } else if (k == 1u) { // rock
      let s1 = fields.r;
      let r1 = fields.g;

      // Calculate current total height
      let totalHeight = fields.r + fields.g + fields.b;

      // Only allow rock erosion if:
      // 1. No soil on top AND
      // 2. Total height is above ocean floor (absolute minimum)
      if (s1 <= 0.0 && totalHeight > OCEAN_FLOOR) {
        let want_m = actualKg / (cellArea * density);
        // CRITICAL: Cannot erode below ocean floor (0 meters)
        let maxErosion = max(0.0, totalHeight - OCEAN_FLOOR);
        let actual_m = min(min(want_m, 0.01), maxErosion);
        delta_kg = -actual_m * cellArea * density;
      } else {
        delta_kg = 0.0;
      }
    } else { // lava
      let l1 = fields.b;
      let avail_m = max(l1, 0.0);
      let want_m = actualKg / (cellArea * density);
      let actual_m = min(want_m, avail_m);
      delta_kg = -actual_m * cellArea * density;
    }
  }

  // write to appropriate channel of delta texture
  // Note: Since deltasTex is write-only, we can't accumulate from multiple ops
  // This assumes one op per cell per frame (which is typical for brush operations)
  if (delta_kg != 0.0) {
    let dm = delta_kg / density;
    var newDeltas = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    if (k == 0u) {
      newDeltas.r = dm; // soil delta
    } else if (k == 1u) {
      newDeltas.g = dm; // rock delta
    } else if (k == 2u) {
      newDeltas.b = dm; // lava delta
    }
    textureStore(deltasTex, coord, newDeltas);
  }
}