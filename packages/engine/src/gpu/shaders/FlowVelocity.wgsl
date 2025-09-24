// FlowVelocity.wgsl - Calculate flow velocity from height gradient
// Outputs: flow field F (u,v velocity components)

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
@group(0) @binding(1) var heightTex: texture_2d<f32>;     // Terrain height (soil + rock)
@group(0) @binding(2) var flowTexIn: texture_storage_2d<rg32float, read>;  // Previous flow (for inertia)
@group(0) @binding(3) var flowTexOut: texture_storage_2d<rg32float, write>; // Output flow velocity
@group(0) @binding(4) var roughnessTex: texture_2d<f32>;  // Terrain roughness/friction
@group(0) @binding(5) var waterDepthTex: texture_storage_2d<r32float, read>; // Water depth

const WORKGROUP_SIZE = 8u;
const FLOW_INERTIA = 0.3;  // Lower inertia so water responds quicker to terrain
const MIN_FLOW_SPEED = 0.01;  // Higher minimum to ensure flow happens
const MAX_FLOW_SPEED = 50.0;  // Higher max for steep slopes
const ROUGHNESS_DAMPING = 0.8;  // Less damping  // How much roughness slows flow

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(heightTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Sample terrain height and water depth at center and neighbors
  let terrain_center = textureLoad(heightTex, coord, 0).r;
  let water_center = textureLoad(waterDepthTex, coord).r;
  let h_center = terrain_center + water_center;

  // Get neighbor heights (terrain + water)
  let coord_left = clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_right = clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_up = clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_down = clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1);

  let h_left = textureLoad(heightTex, coord_left, 0).r + textureLoad(waterDepthTex, coord_left).r;
  let h_right = textureLoad(heightTex, coord_right, 0).r + textureLoad(waterDepthTex, coord_right).r;
  let h_up = textureLoad(heightTex, coord_up, 0).r + textureLoad(waterDepthTex, coord_up).r;
  let h_down = textureLoad(heightTex, coord_down, 0).r + textureLoad(waterDepthTex, coord_down).r;

  // Calculate height gradient (∇H)
  // Note: Negative gradient points downhill
  let dx = (h_right - h_left) * 0.5;
  let dy = (h_down - h_up) * 0.5;
  let gradient = vec2<f32>(dx, dy);

  // Calculate slope magnitude
  let slope = length(gradient);

  // Convert gradient to velocity: v = -normalize(∇H) * sqrt(2 * g * |∇H|) * dt
  // This uses Bernoulli's equation for flow down a slope
  var velocity = vec2<f32>(0.0);

  // Calculate flow for any water present
  if (water_center > 0.0001) {
    // Simple approach: just use the gradient directly as velocity
    // This ensures water ALWAYS flows downhill
    velocity = -gradient * params.gravity * params.deltaTime;

    // Clamp to reasonable speeds
    let speed = length(velocity);
    if (speed > MAX_FLOW_SPEED) {
      velocity = (velocity / speed) * MAX_FLOW_SPEED;
    }
    if (speed < MIN_FLOW_SPEED && speed > 0.0001) {
      velocity = (velocity / speed) * MIN_FLOW_SPEED;
    }
  }

  // Apply terrain roughness damping
  let roughness = textureLoad(roughnessTex, coord, 0).r;
  let damping = mix(1.0, ROUGHNESS_DAMPING, roughness);
  velocity *= damping;

  // Apply inertia - blend with previous flow
  let prev_flow = textureLoad(flowTexIn, coord).rg;
  velocity = mix(velocity, prev_flow, FLOW_INERTIA);

  // Add some numerical damping to prevent instability
  velocity *= 0.99;

  // Store the flow velocity
  textureStore(flowTexOut, coord, vec4<f32>(velocity, 0.0, 0.0));
}

// Helper function to calculate divergence (for debugging/visualization)
fn divergence(coord: vec2<i32>, dims: vec2<u32>) -> f32 {
  let flow_center = textureLoad(flowTexIn, coord).rg;
  let flow_left = textureLoad(flowTexIn, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1)).rg;
  let flow_right = textureLoad(flowTexIn, clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1)).rg;
  let flow_up = textureLoad(flowTexIn, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1)).rg;
  let flow_down = textureLoad(flowTexIn, clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1)).rg;

  let div_x = (flow_right.x - flow_left.x) * 0.5;
  let div_y = (flow_down.y - flow_up.y) * 0.5;

  return div_x + div_y;
}