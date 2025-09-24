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
@group(0) @binding(1) var heightTex: texture_2d<f32>;     // Combined terrain height (soil + rock)
@group(0) @binding(2) var flowTexIn: texture_storage_2d<rg32float, read>;  // Previous flow (for inertia)
@group(0) @binding(3) var flowTexOut: texture_storage_2d<rg32float, write>; // Output flow velocity
@group(0) @binding(4) var roughnessTex: texture_2d<f32>;  // Terrain roughness/friction (rock texture)
@group(0) @binding(5) var waterDepthTex: texture_storage_2d<r32float, read>; // Water depth

const WORKGROUP_SIZE = 8u;
const FLOW_INERTIA = 0.0;     // No inertia - instant response to terrain
const MIN_FLOW_SPEED = 10.0;   // Reasonable minimum flow
const MAX_FLOW_SPEED = 500.0;  // Cap at reasonable speed
const ROUGHNESS_DAMPING = 1.0; // No damping at all
const PRESSURE_SCALE = 50.0;   // Water pushes water ahead of it

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(heightTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Sample terrain height and water depth at center
  // heightTex already contains combined soil + rock height
  let terrain_center = textureLoad(heightTex, coord, 0).r;
  let water_center = textureLoad(waterDepthTex, coord).r;
  // Don't use water in height for flow calculation - only terrain matters for direction!
  let h_center = terrain_center;

  // Check multiple scales - look further for flow direction
  // Scale 1: immediate neighbors
  let coord_left1 = clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_right1 = clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_up1 = clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_down1 = clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), vec2<i32>(dims) - 1);

  // Scale 2: look 4 pixels away for better gradient
  let coord_left4 = clamp(coord + vec2<i32>(-4, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_right4 = clamp(coord + vec2<i32>(4, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_up4 = clamp(coord + vec2<i32>(0, -4), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_down4 = clamp(coord + vec2<i32>(0, 4), vec2<i32>(0), vec2<i32>(dims) - 1);

  // Scale 3: look 8 pixels away for long-range flow
  let coord_left8 = clamp(coord + vec2<i32>(-8, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_right8 = clamp(coord + vec2<i32>(8, 0), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_up8 = clamp(coord + vec2<i32>(0, -8), vec2<i32>(0), vec2<i32>(dims) - 1);
  let coord_down8 = clamp(coord + vec2<i32>(0, 8), vec2<i32>(0), vec2<i32>(dims) - 1);

  // Get TERRAIN heights at all scales (already combined)
  let h_left = textureLoad(heightTex, coord_left1, 0).r;
  let h_right = textureLoad(heightTex, coord_right1, 0).r;
  let h_up = textureLoad(heightTex, coord_up1, 0).r;
  let h_down = textureLoad(heightTex, coord_down1, 0).r;


  let h_left4 = textureLoad(heightTex, coord_left4, 0).r;
  let h_right4 = textureLoad(heightTex, coord_right4, 0).r;
  let h_up4 = textureLoad(heightTex, coord_up4, 0).r;
  let h_down4 = textureLoad(heightTex, coord_down4, 0).r;

  let h_left8 = textureLoad(heightTex, coord_left8, 0).r;
  let h_right8 = textureLoad(heightTex, coord_right8, 0).r;
  let h_up8 = textureLoad(heightTex, coord_up8, 0).r;
  let h_down8 = textureLoad(heightTex, coord_down8, 0).r;

  // Calculate multi-scale gradients - combine all scales for better flow
  // Scale 1: local gradient
  let dx1 = (h_right - h_left) * 0.5;
  let dy1 = (h_down - h_up) * 0.5;

  // Scale 2: medium-range gradient (normalized by distance)
  let dx4 = (h_right4 - h_left4) * 0.125;  // Divide by 8 (4 pixels each direction)
  let dy4 = (h_down4 - h_up4) * 0.125;

  // Scale 3: long-range gradient (normalized by distance)
  let dx8 = (h_right8 - h_left8) * 0.0625; // Divide by 16 (8 pixels each direction)
  let dy8 = (h_down8 - h_up8) * 0.0625;

  // Combine gradients - prioritize long-range for direction, local for detail
  let gradient = vec2<f32>(
    dx1 * 0.2 + dx4 * 0.3 + dx8 * 0.5,  // Weight long-range more
    dy1 * 0.2 + dy4 * 0.3 + dy8 * 0.5
  );

  // Calculate slope magnitude
  let slope = length(gradient);

  // Convert gradient to velocity: v = -normalize(∇H) * sqrt(2 * g * |∇H|) * dt
  // This uses Bernoulli's equation for flow down a slope
  var velocity = vec2<f32>(0.0);

  // Calculate flow based on terrain gradient ALWAYS
  // Even empty cells need flow direction for water to spread into them
  if (true) {  // Always calculate flow, not just where water exists
    // WATER PRESSURE - Water pushes water ahead creating cascades
    // Calculate pressure gradient from water depth differences
    var pressure_flow = vec2<f32>(0.0);

    // Water depth creates pressure that pushes horizontally
    let water_left = textureLoad(waterDepthTex, coord_left1).r;
    let water_right = textureLoad(waterDepthTex, coord_right1).r;
    let water_up = textureLoad(waterDepthTex, coord_up1).r;
    let water_down = textureLoad(waterDepthTex, coord_down1).r;

    // Pressure difference drives flow even on flat terrain
    pressure_flow.x = (water_left - water_right) * PRESSURE_SCALE;
    pressure_flow.y = (water_up - water_down) * PRESSURE_SCALE;

    // Find steepest TERRAIN downhill direction (check all 8 neighbors)
    // CRITICAL: Base flow on terrain slope, NOT terrain+water height!
    var steepest_dir = vec2<f32>(0.0);
    var max_drop = 0.0;

    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) { continue; }

        let neighbor_coord = clamp(coord + vec2<i32>(dx, dy), vec2<i32>(0), vec2<i32>(dims) - 1);
        // Compare terrain heights (already combined)
        let neighbor_terrain = textureLoad(heightTex, neighbor_coord, 0).r;
        let drop = terrain_center - neighbor_terrain;

        if (drop > max_drop) {
          max_drop = drop;
          steepest_dir = normalize(vec2<f32>(f32(dx), f32(dy)));
        }
      }
    }

    // Always calculate terrain-based flow direction
    // This ensures empty cells have flow direction for water to spread into

    // Use real terrain gradient to calculate flow
    velocity = -gradient * 10000.0;  // Big multiplier to make flow visible

    // Override with steepest direction if there's a clear drop
    if (max_drop > 0.0001) {  // Lower threshold
      // Strong downhill flow in steepest direction
      velocity = steepest_dir * max_drop * 50000.0;  // Much larger multiplier
    }

    // Add pressure-driven flow only if water exists
    if (water_center > 0.00001) {
      velocity += pressure_flow;

      // Ensure minimum flow speed based on water depth
      let speed = length(velocity);
      let depth_based_min = MIN_FLOW_SPEED * (1.0 + water_center * 10.0);

      if (speed < depth_based_min && speed > 0.001) {
        velocity = (velocity / speed) * depth_based_min;
      }
    }

    // Cap maximum speed
    let speed = length(velocity);
    if (speed > MAX_FLOW_SPEED) {
      velocity = (velocity / speed) * MAX_FLOW_SPEED;
    }
  }

  // No roughness damping - let water flow freely
  // No inertia - water instantly responds to terrain

  // Store the calculated flow velocity
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