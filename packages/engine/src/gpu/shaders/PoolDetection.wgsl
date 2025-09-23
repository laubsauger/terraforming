// PoolDetection.wgsl - Detect pools/lakes where water accumulates
// Marks areas with low flow and convergence as pools

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
@group(0) @binding(1) var flowTex: texture_2d<f32>;           // Flow velocity field
@group(0) @binding(2) var waterDepthTex: texture_storage_2d<r32float, read>;     // Water depth
@group(0) @binding(3) var poolMaskTex: texture_storage_2d<r32float, write>;  // Pool mask output
@group(0) @binding(4) var heightTex: texture_2d<f32>;         // Terrain height

const WORKGROUP_SIZE = 8u;
const DIVERGENCE_THRESHOLD = -0.01;  // Negative = convergence (pooling)
const SPEED_THRESHOLD = 0.05;        // Low speed indicates pooling
const DEPTH_THRESHOLD = 0.01;        // Minimum water depth for pool
const SMOOTHING_RADIUS = 2u;         // Radius for height smoothing comparison

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(flowTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Get water depth
  let water_depth = textureLoad(waterDepthTex, coord).r;

  // No pool without water
  if (water_depth < DEPTH_THRESHOLD) {
    textureStore(poolMaskTex, coord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
    return;
  }

  // Get flow at center
  let flow_center = textureLoad(flowTex, coord, 0).rg;
  let flow_speed = length(flow_center);

  // Calculate divergence of flow field
  let flow_left = textureLoad(flowTex, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;
  let flow_right = textureLoad(flowTex, clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;
  let flow_up = textureLoad(flowTex, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;
  let flow_down = textureLoad(flowTex, clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;

  let div_x = (flow_right.x - flow_left.x) * 0.5;
  let div_y = (flow_down.y - flow_up.y) * 0.5;
  let divergence = div_x + div_y;

  // Check for convergence and low speed
  let is_converging = divergence < DIVERGENCE_THRESHOLD;
  let is_slow = flow_speed < SPEED_THRESHOLD;

  // Check if we're in a local depression (approximation)
  let h_center = textureLoad(heightTex, coord, 0).r + water_depth;

  // Calculate smoothed height for comparison
  var smoothed_height = 0.0;
  var weight_sum = 0.0;
  for (var dy = -i32(SMOOTHING_RADIUS); dy <= i32(SMOOTHING_RADIUS); dy++) {
    for (var dx = -i32(SMOOTHING_RADIUS); dx <= i32(SMOOTHING_RADIUS); dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let sample_coord = clamp(
        coord + vec2<i32>(dx, dy),
        vec2<i32>(0),
        vec2<i32>(dims) - 1
      );

      let h_sample = textureLoad(heightTex, sample_coord, 0).r;
      let w_sample = textureLoad(waterDepthTex, sample_coord).r;
      let total_height = h_sample + w_sample;

      let distance = length(vec2<f32>(f32(dx), f32(dy)));
      let weight = 1.0 / (1.0 + distance);

      smoothed_height += total_height * weight;
      weight_sum += weight;
    }
  }
  smoothed_height /= weight_sum;

  // We're in a depression if our height is below the smoothed surrounding height
  let is_depression = h_center < smoothed_height - 0.001;

  // Calculate pool strength based on multiple factors
  var pool_strength = 0.0;

  if (is_converging) {
    pool_strength += 0.3;
  }

  if (is_slow) {
    pool_strength += 0.3;
  }

  if (is_depression) {
    pool_strength += 0.4;
  }

  // Enhance pool detection for deeper water
  let depth_factor = min(water_depth / 0.1, 1.0);  // Normalize to 0-1
  pool_strength *= (0.5 + 0.5 * depth_factor);

  // Apply hysteresis by reading previous pool mask (if available)
  // This helps maintain stable pool boundaries
  // Note: In a real implementation, we'd read from a previous frame's pool mask
  if (pool_strength > 0.4) {
    pool_strength = min(pool_strength * 1.2, 1.0);  // Strengthen existing pools
  }

  // Store the pool mask
  textureStore(poolMaskTex, coord, vec4<f32>(pool_strength, 0.0, 0.0, 0.0));
}