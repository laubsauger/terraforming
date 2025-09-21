struct FragmentInput {
    @location(0) world_pos: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) normal: vec3<f32>,
}

struct MaterialUniforms {
    base_color: vec3<f32>,
    rock_color: vec3<f32>,
    grass_color: vec3<f32>,
    sand_color: vec3<f32>,
    snow_color: vec3<f32>,
    light_dir: vec3<f32>,
    light_color: vec3<f32>,
    ambient_color: vec3<f32>,
    view_pos: vec3<f32>,
}

@group(0) @binding(3) var<uniform> material: MaterialUniforms;
@group(0) @binding(4) var accumulation_map: texture_2d<f32>;
@group(0) @binding(5) var flow_map: texture_2d<f32>;
@group(0) @binding(6) var pool_mask: texture_2d<f32>;
@group(0) @binding(7) var map_sampler: sampler;

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    // Sample simulation data
    let accumulation = textureSample(accumulation_map, map_sampler, input.uv).x;
    let flow = textureSample(flow_map, map_sampler, input.uv).xy;
    let is_pool = textureSample(pool_mask, map_sampler, input.uv).x;

    // Determine terrain type based on slope and height
    let slope = 1.0 - abs(input.normal.y);
    let height = input.world_pos.y;

    // Mix terrain colors based on conditions
    var color = material.base_color;

    // Rock on steep slopes
    if (slope > 0.5) {
        color = mix(color, material.rock_color, smoothstep(0.5, 0.8, slope));
    }
    // Snow at high altitudes
    else if (height > 50.0) {
        color = mix(color, material.snow_color, smoothstep(50.0, 70.0, height));
    }
    // Sand near water
    else if (accumulation > 5.0) {
        color = mix(color, material.sand_color, smoothstep(5.0, 10.0, accumulation));
    }
    // Grass default
    else {
        color = mix(color, material.grass_color, 0.7);
    }

    // Wetness effect from flow accumulation
    let wetness = clamp(accumulation / 20.0, 0.0, 0.8);
    color *= (1.0 - wetness * 0.3);

    // Flow visualization (subtle)
    let flow_speed = length(flow);
    if (flow_speed > 0.1) {
        color = mix(color, vec3<f32>(0.3, 0.4, 0.6), flow_speed * 0.2);
    }

    // Pool water tinting
    if (is_pool > 0.5) {
        color = mix(color, vec3<f32>(0.1, 0.3, 0.5), 0.5);
    }

    // Basic lighting
    let n = normalize(input.normal);
    let l = normalize(material.light_dir);
    let v = normalize(material.view_pos - input.world_pos);

    // Diffuse
    let n_dot_l = max(dot(n, l), 0.0);
    let diffuse = material.light_color * n_dot_l;

    // Specular (subtle for terrain)
    let h = normalize(l + v);
    let n_dot_h = max(dot(n, h), 0.0);
    let specular = material.light_color * pow(n_dot_h, 32.0) * wetness;

    // Combine lighting
    let lit_color = color * (material.ambient_color + diffuse) + specular;

    return vec4<f32>(lit_color, 1.0);
}