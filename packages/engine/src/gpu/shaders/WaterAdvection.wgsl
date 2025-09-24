// WaterAdvection.wgsl - Move water along the flow field using semi-Lagrangian advection
// CRITICAL: The water transfer rate and conservation are extremely important!
// Too conservative = water piles up and never flows (our original bug)
// Too aggressive = instant flooding (current issue)
// The key is balancing how much water leaves vs arrives at each cell

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
@group(0) @binding(1) var flowTex: texture_storage_2d<rg32float, read>;   // Flow velocity field
@group(0) @binding(2) var waterDepthTexIn: texture_storage_2d<r32float, read>;   // Current water depth
@group(0) @binding(3) var waterDepthTexOut: texture_storage_2d<r32float, write>; // Updated water depth
@group(0) @binding(4) var heightTex: texture_2d<f32>;                    // Terrain height

const WORKGROUP_SIZE = 8u;
const ADVECTION_SCALE = 1.0;     // Reduced for more controlled flow
const MIN_WATER_DEPTH = 0.00001; // Very low threshold
const VISCOSITY = 0.0;            // No viscosity - free flow
const MAX_FLOW_SPEED = 500.0;    // Maximum flow speed from FlowVelocity shader
const FLOW_TRANSFER_RATE = 0.15; // Transfer 15% per frame - conservative to prevent water loss

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(flowTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Get current water depth
  let current_depth = textureLoad(waterDepthTexIn, coord).r;

  // SEMI-LAGRANGIAN ADVECTION: Follow flow backward to find where water came from
  var new_depth = current_depth;  // Start with current water

  // Get flow at current position
  let current_flow = textureLoad(flowTex, coord).rg;
  let flow_speed = length(current_flow);

  // PRESSURE-DRIVEN ENHANCEMENT: Deep water creates additional pressure flow
  // This prevents huge pileups by forcing water to flow faster when deep
  var enhanced_flow = current_flow;
  if (current_depth > 0.01) {
    // Add pressure-driven flow based on depth
    // Deeper water = more pressure = faster flow
    // Moderate boost to prevent water loss
    let pressure_boost = min(current_depth * 100.0, 3.0); // Up to 3x speed for deep water
    enhanced_flow = current_flow * (1.0 + pressure_boost);
  }

  // Calculate where water would have come from (backward trace)
  // Scale dt for stability but allow faster flow
  let dt = params.deltaTime;

  // Adaptive velocity scaling based on depth and flow
  // Shallow water flows slower, deep water flows much faster
  // Conservative scaling to maintain mass
  let depth_factor = min(current_depth * 10.0, 1.0);
  let velocity_scale = mix(0.03, 0.15, depth_factor); // Scale from 0.03 to 0.15 based on depth

  let velocity = enhanced_flow * velocity_scale;

  // Find source position (where water came from)
  let source_pos = vec2<f32>(coord) - velocity * dt;

  // Bilinear interpolation of water depth at source position
  let x0 = i32(floor(source_pos.x));
  let x1 = x0 + 1;
  let y0 = i32(floor(source_pos.y));
  let y1 = y0 + 1;

  let fx = fract(source_pos.x);
  let fy = fract(source_pos.y);

  // Clamp coordinates
  let x0c = clamp(x0, 0, i32(dims.x) - 1);
  let x1c = clamp(x1, 0, i32(dims.x) - 1);
  let y0c = clamp(y0, 0, i32(dims.y) - 1);
  let y1c = clamp(y1, 0, i32(dims.y) - 1);

  // Sample depths at four corners
  let d00 = textureLoad(waterDepthTexIn, vec2<i32>(x0c, y0c)).r;
  let d10 = textureLoad(waterDepthTexIn, vec2<i32>(x1c, y0c)).r;
  let d01 = textureLoad(waterDepthTexIn, vec2<i32>(x0c, y1c)).r;
  let d11 = textureLoad(waterDepthTexIn, vec2<i32>(x1c, y1c)).r;

  // Bilinear interpolation
  let d0 = mix(d00, d10, fx);
  let d1 = mix(d01, d11, fx);
  let advected_water = mix(d0, d1, fy);

  // Balance between pool stability and flow responsiveness
  // Conservative to prevent water disappearing
  let flow_normalized = min(flow_speed / 20.0, 1.0);
  let advection_strength = mix(0.4, 0.8, flow_normalized); // 40% to 80% advection - prevents loss

  new_depth = mix(current_depth, advected_water, advection_strength);

  var advected_depth = new_depth;

  // Apply evaporation (DISABLED for debugging - water was disappearing)
  // advected_depth = max(advected_depth - params.evaporationRate * params.deltaTime, 0.0);

  // Add rain (DISABLED for debugging)
  // advected_depth += params.rainIntensity * params.deltaTime;

  // Ensure non-negative and apply minimum threshold
  if (advected_depth < MIN_WATER_DEPTH) {
    advected_depth = 0.0;
  }

  // Store updated water depth
  textureStore(waterDepthTexOut, coord, vec4<f32>(advected_depth, 0.0, 0.0, 0.0));
}