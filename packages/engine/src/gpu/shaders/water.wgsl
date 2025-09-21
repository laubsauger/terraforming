struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) flow_uv: vec2<f32>,
}

struct WaterUniforms {
    model_view_proj: mat4x4<f32>,
    view_pos: vec3<f32>,
    time: f32,
    water_color: vec3<f32>,
    foam_color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: WaterUniforms;
@group(0) @binding(1) var accumulation_map: texture_2d<f32>;
@group(0) @binding(2) var flow_map: texture_2d<f32>;
@group(0) @binding(3) var pool_mask: texture_2d<f32>;
@group(0) @binding(4) var water_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;

    // Generate fullscreen quad
    let x = f32(vertex_index & 1u) * 2.0 - 1.0;
    let y = f32((vertex_index >> 1u) & 1u) * 2.0 - 1.0;

    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    output.world_pos = vec3<f32>(x * 50.0, 0.0, y * 50.0);

    // Advect UV by flow field
    let flow = textureSampleLevel(flow_map, water_sampler, output.uv, 0.0).xy;
    output.flow_uv = output.uv - flow * uniforms.time * 0.1;

    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample water data
    let accumulation = textureSample(accumulation_map, water_sampler, input.uv).x;
    let flow = textureSample(flow_map, water_sampler, input.uv).xy;
    let is_pool = textureSample(pool_mask, water_sampler, input.uv).x;

    // Only render where there's significant water
    if (accumulation < 2.0 && is_pool < 0.5) {
        discard;
    }

    // Water depth approximation
    let depth = clamp(accumulation / 10.0, 0.0, 1.0);

    // Base water color with depth
    var color = mix(
        uniforms.water_color * 1.5,  // Shallow
        uniforms.water_color * 0.3,  // Deep
        depth
    );

    // Flow-based distortion for surface detail
    let flow_speed = length(flow);
    let distortion = sin(input.flow_uv.x * 20.0 + uniforms.time) *
                     cos(input.flow_uv.y * 20.0 - uniforms.time * 0.7) * 0.05;

    // Foam at high flow areas
    if (flow_speed > 0.5) {
        let foam_factor = smoothstep(0.5, 1.5, flow_speed);
        let foam_pattern = fract(sin(dot(input.flow_uv * 30.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);

        if (foam_pattern > (1.0 - foam_factor * 0.3)) {
            color = mix(color, uniforms.foam_color, foam_factor);
        }
    }

    // Simple fresnel effect
    let view_dir = normalize(uniforms.view_pos - input.world_pos);
    let fresnel = pow(1.0 - abs(view_dir.y), 2.0);
    color = mix(color, vec3<f32>(0.8, 0.9, 1.0), fresnel * 0.3);

    // Alpha based on accumulation
    let alpha = clamp(accumulation / 5.0, 0.3, 0.9);

    return vec4<f32>(color, alpha);
}