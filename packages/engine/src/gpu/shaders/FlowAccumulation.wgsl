// FlowAccumulation.wgsl - Accumulate flow downhill to create stream networks
// Uses the classic "contributing area" algorithm - routes virtual rain particles downhill

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
@group(0) @binding(1) var flowTex: texture_2d<f32>;         // Flow velocity field
@group(0) @binding(2) var accumulationTex: texture_storage_2d<r32float, read_write>; // Flow accumulation
@group(0) @binding(3) var heightTex: texture_2d<f32>;       // Height field for slope weighting

const WORKGROUP_SIZE = 8u;
const ACCUMULATION_DECAY = 0.95;  // Hysteresis - old accumulation persists
const RAIN_AMOUNT = 1.0;          // Base rain contribution per cell
const BLUR_RADIUS = 1u;           // Blur radius for stream merging
const MIN_ACCUMULATION = 0.001;   // Threshold below which accumulation is zeroed
const SLOPE_POWER = 2.0;          // Power for slope-based weighting

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(flowTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Get current accumulation (with decay for hysteresis)
  var accumulation = textureLoad(accumulationTex, coord).r * ACCUMULATION_DECAY;

  // Add base rain contribution
  accumulation += RAIN_AMOUNT * params.rainIntensity * params.deltaTime;

  // Get flow velocity at this point
  let flow = textureLoad(flowTex, coord, 0).rg;
  let flow_speed = length(flow);

  // Route accumulation from upstream neighbors
  // Check all 8 neighbors to see who flows into this cell
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let neighbor_coord = coord + vec2<i32>(dx, dy);

      // Skip out-of-bounds neighbors
      if (neighbor_coord.x < 0 || neighbor_coord.x >= i32(dims.x) ||
          neighbor_coord.y < 0 || neighbor_coord.y >= i32(dims.y)) {
        continue;
      }

      // Get neighbor's flow
      let neighbor_flow = textureLoad(flowTex, neighbor_coord, 0).rg;

      // Calculate if neighbor flows toward us
      let flow_dir = normalize(neighbor_flow);
      let to_us = normalize(vec2<f32>(coord - neighbor_coord));
      let alignment = dot(flow_dir, to_us);

      // If neighbor flows toward us (alignment > threshold), add its contribution
      if (alignment > 0.5) {
        let neighbor_acc = textureLoad(accumulationTex, neighbor_coord).r;

        // Weight by alignment and flow speed
        let weight = alignment * length(neighbor_flow);

        // Add weighted contribution
        accumulation += neighbor_acc * weight * 0.1; // Scale down to prevent overflow
      }
    }
  }

  // Apply slope-based weighting to favor channels on steep slopes
  let h_center = textureLoad(heightTex, coord, 0).r;
  var total_slope = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let neighbor_coord = clamp(
        coord + vec2<i32>(dx, dy),
        vec2<i32>(0),
        vec2<i32>(dims) - 1
      );
      let h_neighbor = textureLoad(heightTex, neighbor_coord, 0).r;
      let slope = max(h_center - h_neighbor, 0.0);
      total_slope += slope;
    }
  }

  // Enhance accumulation on slopes
  let slope_factor = pow(total_slope * 0.125, SLOPE_POWER);  // Normalize by 8 neighbors
  accumulation *= (1.0 + slope_factor);

  // Apply blur for stream merging
  if (BLUR_RADIUS > 0u) {
    var blurred_acc = accumulation;
    var weight_sum = 1.0;

    for (var dy = -i32(BLUR_RADIUS); dy <= i32(BLUR_RADIUS); dy++) {
      for (var dx = -i32(BLUR_RADIUS); dx <= i32(BLUR_RADIUS); dx++) {
        if (dx == 0 && dy == 0) { continue; }

        let sample_coord = clamp(
          coord + vec2<i32>(dx, dy),
          vec2<i32>(0),
          vec2<i32>(dims) - 1
        );

        let sample_acc = textureLoad(accumulationTex, sample_coord).r;
        let distance = length(vec2<f32>(dx, dy));
        let weight = 1.0 / (1.0 + distance);

        blurred_acc += sample_acc * weight;
        weight_sum += weight;
      }
    }

    accumulation = mix(accumulation, blurred_acc / weight_sum, 0.3);  // Partial blur
  }

  // Apply minimum threshold
  if (accumulation < MIN_ACCUMULATION) {
    accumulation = 0.0;
  }

  // Store the updated accumulation
  textureStore(accumulationTex, coord, vec4<f32>(accumulation, 0.0, 0.0, 0.0));
}