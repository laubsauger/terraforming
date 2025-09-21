@group(0) @binding(0) var heightmap_read: texture_2d<f32>;
@group(0) @binding(1) var heightmap_write: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var flow_field: texture_2d<f32>;
@group(0) @binding(3) var sediment_read: texture_2d<f32>;
@group(0) @binding(4) var sediment_write: texture_storage_2d<r16float, write>;

struct ErosionParams {
    capacity_constant: f32,    // Kc - capacity constant
    deposition_constant: f32,  // Kd - deposition rate
    erosion_constant: f32,     // Ke - erosion rate
    min_slope: f32,            // Minimum slope for erosion
    dt: f32,
}

@group(1) @binding(0) var<uniform> params: ErosionParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(heightmap_write);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);

    // Load current state
    let height = textureLoad(heightmap_read, pos, 0).x;
    let flow = textureLoad(flow_field, pos, 0).xy;
    let sediment = textureLoad(sediment_read, pos, 0).x;

    // Compute slope magnitude
    let h_right = textureLoad(heightmap_read, pos + vec2<i32>(1, 0), 0).x;
    let h_left = textureLoad(heightmap_read, pos + vec2<i32>(-1, 0), 0).x;
    let h_up = textureLoad(heightmap_read, pos + vec2<i32>(0, 1), 0).x;
    let h_down = textureLoad(heightmap_read, pos + vec2<i32>(0, -1), 0).x;

    let gradient = vec2<f32>(
        (h_right - h_left) * 0.5,
        (h_up - h_down) * 0.5
    );
    let slope = length(gradient);

    // Compute carrying capacity based on flow speed and slope
    let flow_speed = length(flow);
    let capacity = params.capacity_constant * flow_speed * max(slope, params.min_slope);

    var new_height = height;
    var new_sediment = sediment;

    if (sediment < capacity) {
        // Erosion: pick up sediment
        let erosion_amount = min(
            (capacity - sediment) * params.erosion_constant * params.dt,
            height * 0.01  // Limit erosion per timestep
        );
        new_height -= erosion_amount;
        new_sediment += erosion_amount;
    } else {
        // Deposition: drop sediment
        let deposition_amount = min(
            (sediment - capacity) * params.deposition_constant * params.dt,
            sediment
        );
        new_height += deposition_amount;
        new_sediment -= deposition_amount;
    }

    // Transport sediment downstream (simplified)
    let flow_dir = normalize(flow);
    let downstream_pos = pos + vec2<i32>(flow_dir * 1.0);

    if (downstream_pos.x >= 0 && downstream_pos.x < i32(dims.x) &&
        downstream_pos.y >= 0 && downstream_pos.y < i32(dims.y)) {
        let downstream_sediment = textureLoad(sediment_read, downstream_pos, 0).x;
        new_sediment = mix(new_sediment, downstream_sediment, flow_speed * 0.1 * params.dt);
    }

    // Clamp values
    new_height = clamp(new_height, 0.0, 100.0);
    new_sediment = clamp(new_sediment, 0.0, 10.0);

    textureStore(heightmap_write, pos, vec4<f32>(new_height, 0.0, 0.0, 0.0));
    textureStore(sediment_write, pos, vec4<f32>(new_sediment, 0.0, 0.0, 0.0));
}