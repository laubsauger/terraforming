// FluidCombined.wgsl - Combined fluid simulation pass for performance
// Combines flow velocity, accumulation, and erosion in a single kernel

struct Params {
  // Physics
  gravity: f32,
  evaporationRate: f32,
  rainIntensity: f32,
  resolution: f32,
  deltaTime: f32,
  time: f32,

  // Erosion
  erosionRate: f32,
  depositionRate: f32,
  carryingCapacityK: f32,
  minWaterForErosion: f32,

  // Flow dynamics
  flowInertia: f32,
  minFlowSpeed: f32,
  maxFlowSpeed: f32,
  accumulationDecay: f32,
}

struct CellData {
  height: f32,        // Combined terrain height
  water: f32,         // Water depth
  sediment: f32,      // Suspended sediment
  flow: vec2<f32>,    // Flow velocity
  accumulation: f32,  // Flow accumulation
  temperature: f32,   // For lava
}

@group(0) @binding(0) var<uniform> params: Params;

// Height fields (read)
@group(0) @binding(1) var soilTex: texture_2d<f32>;
@group(0) @binding(2) var rockTex: texture_2d<f32>;

// Flow fields (read/write via storage)
@group(0) @binding(3) var flowTex: texture_storage_2d<rg16float, read_write>;
@group(0) @binding(4) var waterDepthTex: texture_storage_2d<r16float, read_write>;
@group(0) @binding(5) var flowAccumTex: texture_storage_2d<r32float, read_write>;
@group(0) @binding(6) var sedimentTex: texture_storage_2d<r16float, read_write>;

// Material deltas (write) - for erosion/deposition
@group(0) @binding(7) var deltaSoilTex: texture_storage_2d<r32float, write>;

// Sources buffer
@group(0) @binding(8) var<storage, read> sources: array<vec4<f32>, 128>; // x, y, rate, type

const WORKGROUP_SIZE = 8u;

fn sampleHeightAt(coord: vec2<i32>) -> f32 {
  let soil = textureLoad(soilTex, coord, 0).r;
  let rock = textureLoad(rockTex, coord, 0).r;
  return soil + rock;
}

fn calculateGradient(coord: vec2<i32>, dims: vec2<u32>) -> vec2<f32> {
  let h_center = sampleHeightAt(coord);

  // Sample neighbors with bounds checking
  let h_left = sampleHeightAt(clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1));
  let h_right = sampleHeightAt(clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1));
  let h_up = sampleHeightAt(clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1));
  let h_down = sampleHeightAt(clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1));

  return vec2<f32>((h_right - h_left) * 0.5, (h_down - h_up) * 0.5);
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(soilTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // ========================================
  // Step 1: Load current state
  // ========================================
  var cell: CellData;
  cell.height = sampleHeightAt(coord);
  cell.water = textureLoad(waterDepthTex, coord).r;
  cell.sediment = textureLoad(sedimentTex, coord).r;
  cell.flow = textureLoad(flowTex, coord).rg;
  cell.accumulation = textureLoad(flowAccumTex, coord).r;

  // ========================================
  // Step 2: Source emission
  // ========================================
  var water_emission = 0.0;
  for (var i = 0u; i < 32u; i++) {  // Check first 32 sources for performance
    let source = sources[i];
    if (source.w < 0.0) { break; }  // Inactive source

    let dist = length(vec2<f32>(coord) - source.xy * vec2<f32>(dims));
    if (dist < 3.0) {  // Within source radius
      let falloff = exp(-dist * dist / 2.0);
      if (source.w < 0.5) {  // Water source
        water_emission += source.z * params.deltaTime * falloff;
      }
    }
  }
  cell.water += water_emission;

  // ========================================
  // Step 3: Flow velocity from gradient
  // ========================================
  let gradient = calculateGradient(coord, dims);
  let slope = length(gradient);

  if (slope > 0.001) {
    let flow_dir = -gradient / slope;  // Normalize and negate (downhill)
    let flow_speed = sqrt(2.0 * params.gravity * slope) * params.deltaTime;
    let new_flow = flow_dir * clamp(flow_speed, params.minFlowSpeed, params.maxFlowSpeed);

    // Apply inertia
    cell.flow = mix(new_flow, cell.flow, params.flowInertia);
  }

  // ========================================
  // Step 4: Flow accumulation
  // ========================================
  cell.accumulation *= params.accumulationDecay;
  cell.accumulation += params.rainIntensity * params.deltaTime;

  // Route accumulation from upslope neighbors
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let n_coord = coord + vec2<i32>(dx, dy);
      if (n_coord.x < 0 || n_coord.x >= i32(dims.x) ||
          n_coord.y < 0 || n_coord.y >= i32(dims.y)) { continue; }

      let n_flow = textureLoad(flowTex, n_coord).rg;
      let to_us = normalize(vec2<f32>(-dx, -dy));
      let alignment = dot(normalize(n_flow), to_us);

      if (alignment > 0.5) {
        let n_acc = textureLoad(flowAccumTex, n_coord).r;
        cell.accumulation += n_acc * alignment * 0.1;
      }
    }
  }

  // ========================================
  // Step 5: Hydraulic erosion
  // ========================================
  var soil_change = 0.0;

  if (cell.water > params.minWaterForErosion) {
    let flow_speed = length(cell.flow);
    let carrying_capacity = params.carryingCapacityK * flow_speed * slope * sqrt(cell.water);

    if (cell.sediment < carrying_capacity) {
      // Erode
      let erosion = min(
        params.erosionRate * (carrying_capacity - cell.sediment) * params.deltaTime,
        cell.height * 0.01  // Max 1% per frame
      );
      soil_change = -erosion;
      cell.sediment += erosion;
    } else {
      // Deposit
      let deposition = min(
        params.depositionRate * (cell.sediment - carrying_capacity) * params.deltaTime,
        cell.sediment * 0.5
      );
      soil_change = deposition;
      cell.sediment -= deposition;
    }
  }

  // ========================================
  // Step 6: Evaporation and water dynamics
  // ========================================
  cell.water = max(cell.water - params.evaporationRate * params.deltaTime, 0.0);

  // ========================================
  // Step 7: Store results
  // ========================================
  textureStore(flowTex, coord, vec4<f32>(cell.flow, 0.0, 0.0));
  textureStore(waterDepthTex, coord, vec4<f32>(cell.water, 0.0, 0.0, 0.0));
  textureStore(flowAccumTex, coord, vec4<f32>(cell.accumulation, 0.0, 0.0, 0.0));
  textureStore(sedimentTex, coord, vec4<f32>(cell.sediment, 0.0, 0.0, 0.0));
  textureStore(deltaSoilTex, coord, vec4<f32>(soil_change, 0.0, 0.0, 0.0));
}