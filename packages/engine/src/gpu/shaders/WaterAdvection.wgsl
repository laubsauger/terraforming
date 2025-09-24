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
const FLOW_TRANSFER_RATE = 0.15; // Transfer 15% per frame - more conservative to prevent water loss

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(flowTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Get current water depth
  let current_depth = textureLoad(waterDepthTexIn, coord).r;

  // SIMPLE APPROACH: Just spread water based on flow field
  var new_depth = 0.0;

  // Look at all 9 cells (including self)
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let source_coord = clamp(
        coord + vec2<i32>(dx, dy),
        vec2<i32>(0),
        vec2<i32>(dims) - 1
      );

      let source_water = textureLoad(waterDepthTexIn, source_coord).r;
      if (source_water < MIN_WATER_DEPTH) { continue; }

      let source_flow = textureLoad(flowTex, source_coord).rg;
      let flow_speed = length(source_flow);

      if (dx == 0 && dy == 0) {
        // This is our own cell - keep water that doesn't flow away
        if (flow_speed < 0.1) {
          // Almost no flow - keep all water
          new_depth += source_water;
        } else {
          // Has flow - water flows away based on flow speed
          // Normalized flow speed (0 to 1)
          let normalized_speed = clamp(flow_speed / MAX_FLOW_SPEED, 0.0, 1.0);

          // Keep more water to prevent it from disappearing
          // On flat: keep ~95%, on steep slopes: keep ~50%
          let keep_fraction = 0.95 - (normalized_speed * 0.45);
          new_depth += source_water * keep_fraction;
        }
      } else {
        // This is a neighbor - check if its flow brings water here
        if (flow_speed > 0.1 && source_water > MIN_WATER_DEPTH) {
          // Does the flow point toward us?
          let to_us = vec2<f32>(-f32(dx), -f32(dy));
          let flow_dir = normalize(source_flow);
          let alignment = max(0.0, dot(flow_dir, normalize(to_us)));

          // Only transfer if reasonably aligned
          if (alignment > 0.2) {  // Lower threshold to allow more water transfer
            // Normalized flow speed (0 to 1)
            let normalized_speed = clamp(flow_speed / MAX_FLOW_SPEED, 0.0, 1.0);

            // Transfer based on alignment and speed
            // Maximum transfer is FLOW_TRANSFER_RATE when perfectly aligned and fast
            let transfer_fraction = alignment * normalized_speed * FLOW_TRANSFER_RATE;
            let transfer = source_water * transfer_fraction;
            new_depth += transfer;
          }
        }
      }
    }
  }

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