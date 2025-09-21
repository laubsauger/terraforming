@group(0) @binding(0) var flow_field: texture_2d<f32>;
@group(0) @binding(1) var accumulation: texture_2d<f32>;
@group(0) @binding(2) var pool_mask: texture_storage_2d<r8unorm, write>;

struct PoolParams {
    flow_threshold: f32,
    accumulation_threshold: f32,
}

@group(1) @binding(0) var<uniform> params: PoolParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(pool_mask);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);

    // Load flow velocity and accumulation
    let flow = textureLoad(flow_field, pos, 0).xy;
    let accum = textureLoad(accumulation, pos, 0).x;

    // Compute divergence (simplified - checking if flow is converging)
    let flow_right = textureLoad(flow_field, pos + vec2<i32>(1, 0), 0).x;
    let flow_left = textureLoad(flow_field, pos + vec2<i32>(-1, 0), 0).x;
    let flow_up = textureLoad(flow_field, pos + vec2<i32>(0, 1), 0).y;
    let flow_down = textureLoad(flow_field, pos + vec2<i32>(0, -1), 0).y;

    let divergence = (flow_right - flow_left) + (flow_up - flow_down);

    // Detect pools: low flow speed, high accumulation, converging flow
    let speed = length(flow);
    let is_pool = (speed < params.flow_threshold) &&
                  (accum > params.accumulation_threshold) &&
                  (divergence < 0.0);

    let pool_value = select(0.0, 1.0, is_pool);

    textureStore(pool_mask, pos, vec4<f32>(pool_value, 0.0, 0.0, 0.0));
}