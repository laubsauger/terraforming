// HydraulicErosion.wgsl - Hydraulic erosion based on water flow
// Picks up sediment when flow is fast, deposits when slow

struct Params {
  gravity: f32,
  evaporationRate: f32,
  rainIntensity: f32,
  resolution: f32,
  deltaTime: f32,
  time: f32,
  _padding1: f32,
  _padding2: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var flowTex: texture_2d<f32>;              // Flow velocity
@group(0) @binding(2) var waterDepthTex: texture_2d<f32>;        // Water depth
@group(0) @binding(3) var heightTex: texture_2d<f32>;            // Combined height (soil + rock) for slope
@group(0) @binding(4) var soilTex: texture_storage_2d<r32float, read_write>;      // Soil height (modified by erosion)
@group(0) @binding(5) var sedimentTexIn: texture_storage_2d<r32float, read>;      // Current sediment
@group(0) @binding(6) var sedimentTexOut: texture_storage_2d<r32float, write>;   // Updated sediment
@group(0) @binding(7) var flowAccumulationTex: texture_2d<f32>;  // Flow accumulation for capacity

const WORKGROUP_SIZE = 8u;

// Erosion parameters
const CARRYING_CAPACITY_CONSTANT = 0.5;   // K in capacity = K * |v| * slope
const EROSION_RATE = 0.01;                // Rate of picking up sediment
const DEPOSITION_RATE = 0.02;             // Rate of depositing sediment
const MIN_WATER_DEPTH = 0.001;            // Minimum water depth for erosion
const SLOPE_EXPONENT = 1.5;               // Power for slope in capacity calculation
const FLOW_EXPONENT = 1.0;                // Power for flow speed in capacity calculation

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(flowTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Get current state
  let flow = textureLoad(flowTex, coord, 0).rg;
  let flow_speed = length(flow);
  let water_depth = textureLoad(waterDepthTex, coord, 0).r;
  let current_sediment = textureLoad(sedimentTexIn, coord).r;
  var soil_height = textureLoad(soilTex, coord).r;

  // No erosion without sufficient water
  if (water_depth < MIN_WATER_DEPTH) {
    textureStore(sedimentTexOut, coord, vec4<f32>(current_sediment, 0.0, 0.0, 0.0));
    return;
  }

  // Calculate terrain slope using combined height (soil + rock)
  let h_center = textureLoad(heightTex, coord, 0).r;
  let h_left = textureLoad(heightTex, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1), 0).r;
  let h_right = textureLoad(heightTex, clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1), 0).r;
  let h_up = textureLoad(heightTex, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1), 0).r;
  let h_down = textureLoad(heightTex, clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1), 0).r;

  let dx = (h_right - h_left) * 0.5;
  let dy = (h_down - h_up) * 0.5;
  let slope = length(vec2<f32>(dx, dy));

  // Calculate carrying capacity
  // capacity = K * |v|^a * slope^b * depth
  let flow_factor = pow(flow_speed, FLOW_EXPONENT);
  let slope_factor = pow(max(slope, 0.001), SLOPE_EXPONENT);
  let depth_factor = sqrt(water_depth);  // More capacity with deeper water
  var carrying_capacity = CARRYING_CAPACITY_CONSTANT * flow_factor * slope_factor * depth_factor;

  // Enhance capacity in high flow accumulation areas (rivers)
  let flow_acc = textureLoad(flowAccumulationTex, coord, 0).r;
  let river_factor = 1.0 + log(1.0 + flow_acc) * 0.1;
  carrying_capacity *= river_factor;

  // Calculate sediment transport
  var new_sediment = current_sediment;
  var soil_change = 0.0;

  if (current_sediment < carrying_capacity) {
    // Pick up sediment (erosion)
    let pickup_amount = min(
      EROSION_RATE * (carrying_capacity - current_sediment) * params.deltaTime,
      soil_height * 0.1  // Don't erode more than 10% of soil in one step
    );

    new_sediment += pickup_amount;
    soil_change = -pickup_amount;
  } else {
    // Deposit sediment (sedimentation)
    let deposit_amount = min(
      DEPOSITION_RATE * (current_sediment - carrying_capacity) * params.deltaTime,
      current_sediment * 0.5  // Don't deposit more than half the sediment
    );

    new_sediment -= deposit_amount;
    soil_change = deposit_amount;
  }

  // Advect sediment along flow field (semi-Lagrangian)
  if (flow_speed > 0.001) {
    let flow_normalized = flow / flow_speed;
    let advect_dist = min(flow_speed * params.deltaTime * 10.0, 1.0);  // Limit advection distance
    let source_pos = vec2<f32>(coord) - flow_normalized * advect_dist;

    // Bilinear interpolation of sediment from source position
    let x0 = i32(floor(source_pos.x));
    let y0 = i32(floor(source_pos.y));
    let fx = fract(source_pos.x);
    let fy = fract(source_pos.y);

    // Clamp coordinates
    let x0_clamped = clamp(x0, 0, i32(dims.x) - 1);
    let x1_clamped = clamp(x0 + 1, 0, i32(dims.x) - 1);
    let y0_clamped = clamp(y0, 0, i32(dims.y) - 1);
    let y1_clamped = clamp(y0 + 1, 0, i32(dims.y) - 1);

    // Sample sediment at four corners
    let s00 = textureLoad(sedimentTexIn, vec2<i32>(x0_clamped, y0_clamped)).r;
    let s10 = textureLoad(sedimentTexIn, vec2<i32>(x1_clamped, y0_clamped)).r;
    let s01 = textureLoad(sedimentTexIn, vec2<i32>(x0_clamped, y1_clamped)).r;
    let s11 = textureLoad(sedimentTexIn, vec2<i32>(x1_clamped, y1_clamped)).r;

    // Bilinear interpolation
    let s0 = mix(s00, s10, fx);
    let s1 = mix(s01, s11, fx);
    let advected_sediment = mix(s0, s1, fy);

    // Blend advected with local changes
    new_sediment = mix(new_sediment, advected_sediment, 0.5);
  }

  // Apply soil height change
  soil_height = max(soil_height + soil_change, 0.0);
  textureStore(soilTex, coord, vec4<f32>(soil_height, 0.0, 0.0, 0.0));

  // Store updated sediment
  new_sediment = max(new_sediment, 0.0);  // Ensure non-negative
  textureStore(sedimentTexOut, coord, vec4<f32>(new_sediment, 0.0, 0.0, 0.0));
}