struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) uv: vec2<f32>,
}

struct LavaUniforms {
    model_view_proj: mat4x4<f32>,
    view_pos: vec3<f32>,
    time: f32,
    hot_color: vec3<f32>,
    cool_color: vec3<f32>,
    crust_color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: LavaUniforms;
@group(0) @binding(1) var lava_depth: texture_2d<f32>;
@group(0) @binding(2) var temperature: texture_2d<f32>;
@group(0) @binding(3) var crust_mask: texture_2d<f32>;
@group(0) @binding(4) var lava_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;

    // Generate fullscreen quad
    let x = f32(vertex_index & 1u) * 2.0 - 1.0;
    let y = f32((vertex_index >> 1u) & 1u) * 2.0 - 1.0;

    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    output.world_pos = vec3<f32>(x * 50.0, 0.0, y * 50.0);

    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample lava data
    let depth = textureSample(lava_depth, lava_sampler, input.uv).x;
    let temp = textureSample(temperature, lava_sampler, input.uv).x;
    let has_crust = textureSample(crust_mask, lava_sampler, input.uv).x;

    // Only render where there's lava
    if (depth < 0.01) {
        discard;
    }

    // Temperature-based color (1500K to 700K range)
    let temp_normalized = clamp((temp - 700.0) / 800.0, 0.0, 1.0);

    // Base emissive color
    var emissive = mix(uniforms.cool_color, uniforms.hot_color, temp_normalized);

    // Crust darkening
    if (has_crust > 0.5) {
        emissive = mix(emissive, uniforms.crust_color, 0.7);

        // Cracks in the crust showing hot lava underneath
        let crack_pattern = fract(sin(dot(input.uv * 50.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);
        if (crack_pattern > 0.9) {
            emissive = uniforms.hot_color;
        }
    }

    // Animated flow patterns
    let flow_pattern = sin(input.uv.x * 30.0 + uniforms.time * 0.5) *
                       cos(input.uv.y * 30.0 - uniforms.time * 0.3);
    emissive *= 1.0 + flow_pattern * 0.1 * temp_normalized;

    // Glow effect intensity based on temperature
    let glow_intensity = temp_normalized * 2.0;
    emissive *= glow_intensity;

    // Depth-based opacity
    let alpha = clamp(depth * 2.0, 0.5, 1.0);

    return vec4<f32>(emissive, alpha);
}