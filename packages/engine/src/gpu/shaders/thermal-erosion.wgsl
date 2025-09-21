@group(0) @binding(0) var heightmap_read: texture_2d<f32>;
@group(0) @binding(1) var heightmap_write: texture_storage_2d<r32float, write>;

struct ThermalParams {
    talus_angle: f32,        // Critical angle of repose (radians)
    erosion_rate: f32,       // Rate of thermal erosion
    dt: f32,
}

@group(1) @binding(0) var<uniform> params: ThermalParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(heightmap_write);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);
    let center_height = textureLoad(heightmap_read, pos, 0).x;

    var total_flow = 0.0;
    var height_change = 0.0;

    // Check all 8 neighbors
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) {
                continue;
            }

            let neighbor_pos = pos + vec2<i32>(dx, dy);

            // Check bounds
            if (neighbor_pos.x < 0 || neighbor_pos.x >= i32(dims.x) ||
                neighbor_pos.y < 0 || neighbor_pos.y >= i32(dims.y)) {
                continue;
            }

            let neighbor_height = textureLoad(heightmap_read, neighbor_pos, 0).x;
            let height_diff = center_height - neighbor_height;

            // Distance to neighbor (1 for orthogonal, sqrt(2) for diagonal)
            let dist = length(vec2<f32>(f32(dx), f32(dy)));

            // Calculate slope angle
            let slope = height_diff / dist;
            let critical_slope = tan(params.talus_angle);

            // If slope exceeds critical angle, material flows
            if (slope > critical_slope) {
                let excess = (slope - critical_slope) * dist;
                let flow = excess * params.erosion_rate * params.dt;

                height_change -= flow;
                total_flow += flow;
            }
        }
    }

    // Apply height change
    let new_height = clamp(center_height + height_change, 0.0, 100.0);

    textureStore(heightmap_write, pos, vec4<f32>(new_height, 0.0, 0.0, 0.0));
}