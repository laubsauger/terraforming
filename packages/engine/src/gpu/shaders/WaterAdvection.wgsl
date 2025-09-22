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
@group(0) @binding(1) var flowTex: texture_2d<f32>;                      // Flow velocity field
@group(0) @binding(2) var waterDepthTexIn: texture_storage_2d<r16float, read>;   // Current water depth
@group(0) @binding(3) var waterDepthTexOut: texture_storage_2d<r16float, write>; // Updated water depth
@group(0) @binding(4) var heightTex: texture_2d<f32>;                    // Terrain height

const WORKGROUP_SIZE = 8u;
const ADVECTION_SCALE = 5.0;     // Scale factor for advection distance
const MIN_WATER_DEPTH = 0.0001;  // Minimum water depth threshold
const VISCOSITY = 0.01;          // Water viscosity damping

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(flowTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Get flow velocity
  let flow = textureLoad(flowTex, coord, 0).rg;
  let flow_speed = length(flow);

  // Get current water depth
  let current_depth = textureLoad(waterDepthTexIn, coord).r;

  // Early exit if no water
  if (current_depth < MIN_WATER_DEPTH) {
    textureStore(waterDepthTexOut, coord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
    return;
  }

  // Semi-Lagrangian advection - trace backward along flow
  let advection_distance = flow_speed * ADVECTION_SCALE * params.deltaTime;
  let source_pos = vec2<f32>(coord) - flow * advection_distance;

  // Bilinear interpolation of water depth from source position
  let x0 = i32(floor(source_pos.x));
  let y0 = i32(floor(source_pos.y));
  let fx = fract(source_pos.x);
  let fy = fract(source_pos.y);

  // Clamp coordinates
  let x0_clamped = clamp(x0, 0, i32(dims.x) - 1);
  let x1_clamped = clamp(x0 + 1, 0, i32(dims.x) - 1);
  let y0_clamped = clamp(y0, 0, i32(dims.y) - 1);
  let y1_clamped = clamp(y0 + 1, 0, i32(dims.y) - 1);

  // Sample water depth at four corners
  let d00 = textureLoad(waterDepthTexIn, vec2<i32>(x0_clamped, y0_clamped)).r;
  let d10 = textureLoad(waterDepthTexIn, vec2<i32>(x1_clamped, y0_clamped)).r;
  let d01 = textureLoad(waterDepthTexIn, vec2<i32>(x0_clamped, y1_clamped)).r;
  let d11 = textureLoad(waterDepthTexIn, vec2<i32>(x1_clamped, y1_clamped)).r;

  // Bilinear interpolation
  let d0 = mix(d00, d10, fx);
  let d1 = mix(d01, d11, fx);
  var advected_depth = mix(d0, d1, fy);

  // Apply mass conservation correction
  // Calculate divergence of flow field
  let flow_left = textureLoad(flowTex, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;
  let flow_right = textureLoad(flowTex, clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;
  let flow_up = textureLoad(flowTex, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;
  let flow_down = textureLoad(flowTex, clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1), 0).rg;

  let div_x = (flow_right.x - flow_left.x) * 0.5;
  let div_y = (flow_down.y - flow_up.y) * 0.5;
  let divergence = div_x + div_y;

  // Apply divergence correction (negative divergence = convergence = pooling)
  advected_depth *= (1.0 - divergence * params.deltaTime * 0.1);

  // Apply viscosity damping
  var viscous_depth = advected_depth;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let neighbor_coord = clamp(
        coord + vec2<i32>(dx, dy),
        vec2<i32>(0),
        vec2<i32>(dims) - 1
      );
      let neighbor_depth = textureLoad(waterDepthTexIn, neighbor_coord).r;
      viscous_depth += neighbor_depth * VISCOSITY / 8.0;
    }
  }
  advected_depth = mix(advected_depth, viscous_depth, VISCOSITY);

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