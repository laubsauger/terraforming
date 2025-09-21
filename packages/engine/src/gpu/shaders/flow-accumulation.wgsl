@group(0) @binding(0) var flow_field: texture_2d<f32>;
@group(0) @binding(1) var flow_sampler: sampler;
@group(0) @binding(2) var accumulation_read: texture_2d<f32>;
@group(0) @binding(3) var accumulation_write: texture_storage_2d<r16float, write>;
@group(0) @binding(4) var<storage, read> water_sources: array<vec4<f32>, 32>; // x,y,rate,padding

struct AccumParams {
    rainfall: f32,
    decay: f32,
    source_count: u32,
    dt: f32,
}

@group(1) @binding(0) var<uniform> params: AccumParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(accumulation_write);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(dims);

    // Get flow velocity at this position
    let flow = textureSampleLevel(flow_field, flow_sampler, uv, 0.0).xy;

    // Previous accumulation value with decay
    var accum = textureLoad(accumulation_read, pos, 0).x * (1.0 - params.decay * params.dt);

    // Add rainfall contribution
    accum += params.rainfall * params.dt;

    // Add water source contributions
    for (var i = 0u; i < params.source_count && i < 32u; i++) {
        let source = water_sources[i];
        let dist = length(uv - source.xy);
        if (dist < 0.01) {  // Within source radius
            accum += source.z * params.dt;  // z = rate
        }
    }

    // Trace upstream to gather contributions (simplified)
    let texel_size = 1.0 / vec2<f32>(dims);
    let upstream_count = 4;
    for (var i = 0; i < upstream_count; i++) {
        let angle = f32(i) * 6.28318 / f32(upstream_count);
        let offset = vec2<f32>(cos(angle), sin(angle)) * texel_size * 2.0;
        let sample_uv = uv + offset;

        if (sample_uv.x >= 0.0 && sample_uv.x <= 1.0 &&
            sample_uv.y >= 0.0 && sample_uv.y <= 1.0) {

            let sample_flow = textureSampleLevel(flow_field, flow_sampler, sample_uv, 0.0).xy;
            // Check if flow points toward us
            let flow_dir = normalize(sample_flow);
            let to_us = normalize(uv - sample_uv);
            let alignment = dot(flow_dir, to_us);

            if (alignment > 0.5) {
                let sample_accum = textureSampleLevel(accumulation_read, flow_sampler, sample_uv, 0.0).x;
                accum += sample_accum * alignment * 0.1 * params.dt;
            }
        }
    }

    // Apply hysteresis for stability
    let prev_accum = textureLoad(accumulation_read, pos, 0).x;
    accum = mix(prev_accum, accum, 0.5);

    // Clamp to reasonable range
    accum = clamp(accum, 0.0, 100.0);

    textureStore(accumulation_write, pos, vec4<f32>(accum, 0.0, 0.0, 0.0));
}