@group(0) @binding(0) var lava_depth_read: texture_2d<f32>;
@group(0) @binding(1) var lava_depth_write: texture_storage_2d<r16float, write>;
@group(0) @binding(2) var temperature_read: texture_2d<f32>;
@group(0) @binding(3) var temperature_write: texture_storage_2d<r16float, write>;
@group(0) @binding(4) var crust_mask: texture_storage_2d<r8unorm, write>;
@group(0) @binding(5) var heightmap: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> lava_sources: array<vec4<f32>, 16>; // x,y,rate,temperature

struct LavaParams {
    viscosity: f32,
    cooling_rate: f32,
    crust_temp: f32,        // Temperature at which crust forms
    solidify_temp: f32,     // Temperature at which lava solidifies
    source_count: u32,
    dt: f32,
}

@group(1) @binding(0) var<uniform> params: LavaParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(lava_depth_write);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);
    let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

    // Load current state
    let height = textureLoad(heightmap, pos, 0).x;
    var lava_depth = textureLoad(lava_depth_read, pos, 0).x;
    var temperature = textureLoad(temperature_read, pos, 0).x;

    // Add lava from sources
    for (var i = 0u; i < params.source_count && i < 16u; i++) {
        let source = lava_sources[i];
        let dist = length(uv - source.xy);
        if (dist < 0.01) {  // Within source radius
            lava_depth += source.z * params.dt;  // z = rate
            temperature = max(temperature, source.w);  // w = temperature
        }
    }

    // Temperature-based viscosity (hotter = more fluid)
    let viscosity_factor = params.viscosity * (1.0 - temperature / 1500.0);

    // Flow simulation (simplified - based on height gradient)
    var flow_amount = 0.0;
    var heat_transfer = 0.0;
    let neighbor_count = 4;

    for (var i = 0; i < neighbor_count; i++) {
        let angle = f32(i) * 1.5708;  // 90 degrees
        let offset = vec2<i32>(i32(cos(angle) + 0.5), i32(sin(angle) + 0.5));
        let neighbor_pos = pos + offset;

        if (neighbor_pos.x >= 0 && neighbor_pos.x < i32(dims.x) &&
            neighbor_pos.y >= 0 && neighbor_pos.y < i32(dims.y)) {

            let neighbor_height = textureLoad(heightmap, neighbor_pos, 0).x;
            let neighbor_lava = textureLoad(lava_depth_read, neighbor_pos, 0).x;
            let neighbor_temp = textureLoad(temperature_read, neighbor_pos, 0).x;

            // Height difference including lava surface
            let our_surface = height + lava_depth;
            let neighbor_surface = neighbor_height + neighbor_lava;
            let height_diff = our_surface - neighbor_surface;

            // Flow based on height difference and viscosity
            if (height_diff > 0.0 && temperature > params.solidify_temp) {
                let flow = min(height_diff * 0.25 / viscosity_factor * params.dt, lava_depth);
                flow_amount -= flow;
            }

            // Heat exchange with neighbors
            let temp_diff = temperature - neighbor_temp;
            heat_transfer -= temp_diff * 0.1 * params.dt;
        }
    }

    // Apply flow and cooling
    lava_depth = max(0.0, lava_depth + flow_amount);
    temperature = max(0.0, temperature + heat_transfer - params.cooling_rate * params.dt);

    // Determine crust formation
    let has_crust = temperature < params.crust_temp && lava_depth > 0.01;
    let crust_value = select(0.0, 1.0, has_crust);

    // Solidification - convert to rock when too cool
    if (temperature < params.solidify_temp && lava_depth > 0.01) {
        // In a real system, we'd add to heightmap here
        lava_depth *= 0.95;  // Slowly reduce lava as it solidifies
    }

    // Store results
    textureStore(lava_depth_write, pos, vec4<f32>(lava_depth, 0.0, 0.0, 0.0));
    textureStore(temperature_write, pos, vec4<f32>(temperature, 0.0, 0.0, 0.0));
    textureStore(crust_mask, pos, vec4<f32>(crust_value, 0.0, 0.0, 0.0));
}