@group(0) @binding(0) var heightmap: texture_2d<f32>;
@group(0) @binding(1) var heightmap_sampler: sampler;
@group(0) @binding(2) var flow_read: texture_2d<f32>;  // Previous flow field
@group(0) @binding(3) var flow_write: texture_storage_2d<rg16float, write>;

struct SimParams {
    dt: f32,
    damping: f32,
    inertia: f32,
    gravity: f32,
}

@group(1) @binding(0) var<uniform> params: SimParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(flow_write);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(dims);

    // Sample height at current position
    let h_center = textureSampleLevel(heightmap, heightmap_sampler, uv, 0.0).x;

    // Compute gradient using central differences
    let texel_size = 1.0 / vec2<f32>(dims);
    let h_right = textureSampleLevel(heightmap, heightmap_sampler, uv + vec2<f32>(texel_size.x, 0.0), 0.0).x;
    let h_left = textureSampleLevel(heightmap, heightmap_sampler, uv - vec2<f32>(texel_size.x, 0.0), 0.0).x;
    let h_up = textureSampleLevel(heightmap, heightmap_sampler, uv + vec2<f32>(0.0, texel_size.y), 0.0).x;
    let h_down = textureSampleLevel(heightmap, heightmap_sampler, uv - vec2<f32>(0.0, texel_size.y), 0.0).x;

    let gradient = vec2<f32>(
        (h_right - h_left) * 0.5,
        (h_up - h_down) * 0.5
    );

    // Previous flow velocity
    let prev_flow = textureLoad(flow_read, pos, 0).xy;

    // Apply forces: gravity pulls "downhill" (negative gradient)
    let force = -gradient * params.gravity;

    // Update velocity with inertia and damping
    var new_flow = prev_flow * params.inertia + force * params.dt;
    new_flow *= (1.0 - params.damping * params.dt);

    // CFL condition - limit maximum velocity
    let max_velocity = 0.5 / params.dt;  // Half cell per timestep
    let speed = length(new_flow);
    if (speed > max_velocity) {
        new_flow = new_flow * (max_velocity / speed);
    }

    textureStore(flow_write, pos, vec4<f32>(new_flow, 0.0, 0.0));
}