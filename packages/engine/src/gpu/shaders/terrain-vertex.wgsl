struct VertexInput {
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) normal: vec3<f32>,
}

struct Uniforms {
    model: mat4x4<f32>,
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    grid_size: vec2<f32>,
    terrain_scale: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var heightmap: texture_2d<f32>;
@group(0) @binding(2) var heightmap_sampler: sampler;

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // Generate grid position from vertex index
    let grid_res = u32(uniforms.grid_size.x);
    let x = input.vertex_index % grid_res;
    let z = input.vertex_index / grid_res;

    // UV coordinates
    output.uv = vec2<f32>(f32(x), f32(z)) / (uniforms.grid_size - 1.0);

    // Sample heightmap
    let height = textureSampleLevel(heightmap, heightmap_sampler, output.uv, 0.0).x;

    // World position with displacement
    let local_pos = vec3<f32>(
        (output.uv.x - 0.5) * uniforms.terrain_scale.x,
        height * uniforms.terrain_scale.y,
        (output.uv.y - 0.5) * uniforms.terrain_scale.z
    );

    output.world_pos = (uniforms.model * vec4<f32>(local_pos, 1.0)).xyz;

    // Compute normal from heightmap gradient
    let texel_size = 1.0 / uniforms.grid_size;
    let h_right = textureSampleLevel(heightmap, heightmap_sampler, output.uv + vec2<f32>(texel_size.x, 0.0), 0.0).x;
    let h_left = textureSampleLevel(heightmap, heightmap_sampler, output.uv - vec2<f32>(texel_size.x, 0.0), 0.0).x;
    let h_up = textureSampleLevel(heightmap, heightmap_sampler, output.uv + vec2<f32>(0.0, texel_size.y), 0.0).x;
    let h_down = textureSampleLevel(heightmap, heightmap_sampler, output.uv - vec2<f32>(0.0, texel_size.y), 0.0).x;

    let dx = (h_right - h_left) * uniforms.terrain_scale.y;
    let dz = (h_up - h_down) * uniforms.terrain_scale.y;

    output.normal = normalize(vec3<f32>(-dx, 2.0, -dz));

    // Final position
    output.position = uniforms.projection * uniforms.view * vec4<f32>(output.world_pos, 1.0);

    return output;
}