// WaterAdvection.wgsl - Move water along the flow field using semi-Lagrangian advection

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
const ADVECTION_SCALE = 2.0;     // Moderate for stable flow
const MIN_WATER_DEPTH = 0.00001; // Very low threshold
const VISCOSITY = 0.0;            // No viscosity - free flow
const MAX_FLOW_SPEED = 500.0;    // Need this constant here too
const FLOW_TRANSFER_RATE = 0.9;  // Transfer 90% of water per frame at max flow - water shouldn't stick on steep slopes!

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
        if (flow_speed < 1.0) {
          // Very low flow - keep most water
          new_depth += source_water * 0.95;
        } else {
          // Has flow - water flows away based on flow speed
          // Normalized flow speed (0 to 1)
          let normalized_speed = clamp(flow_speed / MAX_FLOW_SPEED, 0.0, 1.0);

          // On steep slopes (high flow speed), almost no water should remain!
          // Use exponential falloff for more realistic behavior
          let keep_fraction = pow(1.0 - normalized_speed, 2.0) * 0.5;
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
          if (alignment > 0.3) {
            // Normalized flow speed (0 to 1)
            let normalized_speed = clamp(flow_speed / MAX_FLOW_SPEED, 0.0, 1.0);

            // Transfer a significant portion when well-aligned and fast-flowing
            // On steep slopes, most water should transfer in the flow direction
            let base_transfer = normalized_speed * FLOW_TRANSFER_RATE;
            let transfer = source_water * alignment * base_transfer;
            new_depth += transfer;
          }
        }
      }
    }
  }

  var advected_depth = new_depth;

  // Apply evaporation
  advected_depth = max(advected_depth - params.evaporationRate * params.deltaTime, 0.0);

  // Add rain
  advected_depth += params.rainIntensity * params.deltaTime;

  // Ensure non-negative and apply minimum threshold
  if (advected_depth < MIN_WATER_DEPTH) {
    advected_depth = 0.0;
  }

  // Store updated water depth
  textureStore(waterDepthTexOut, coord, vec4<f32>(advected_depth, 0.0, 0.0, 0.0));
}