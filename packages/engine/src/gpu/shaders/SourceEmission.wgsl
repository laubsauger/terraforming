// SourceEmission.wgsl - Emit water and lava from placed sources
// Adds fluid to water depth and lava fields based on source positions and flow rates

struct Params {
  gravity: f32,
  evaporationRate: f32,
  rainIntensity: f32,
  resolution: f32,
  deltaTime: f32,
  time: f32,
  _padding1: f32,
  _padding2: f32,
}

struct Source {
  position: vec2<f32>,  // World position (normalized 0-1)
  rate: f32,            // Flow rate (units per second)
  sourceType: f32,      // 0 = water, 1 = lava, -1 = inactive
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> sources: array<Source, 128>;
@group(0) @binding(2) var waterDepthTex: texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var lavaDepthTex: texture_storage_2d<r32float, read_write>;  // Using lava material field
@group(0) @binding(4) var temperatureTex: texture_storage_2d<r32float, read_write>;

const WORKGROUP_SIZE = 8u;
const SOURCE_RADIUS = 3.0;        // Radius of source influence in texels
const LAVA_TEMPERATURE = 1200.0;  // Initial temperature of emitted lava (Celsius)
const GAUSSIAN_SIGMA = 1.5;       // Sigma for Gaussian falloff
const EMISSION_SCALE = 0.001;     // Scale down emission rate (L/s to m depth per texel)

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(waterDepthTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);
  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Accumulate emissions from all active sources
  var water_emission = 0.0;
  var lava_emission = 0.0;
  var temp_addition = 0.0;

  for (var i = 0u; i < 128u; i++) {
    let source = sources[i];

    // Skip inactive sources
    if (source.sourceType < 0.0) { break; }  // Assume sources are packed at beginning

    // Calculate distance from source to this texel
    let source_texel = source.position * vec2<f32>(dims);
    let distance = length(vec2<f32>(coord) - source_texel);

    // Skip if too far from source
    if (distance > SOURCE_RADIUS) { continue; }

    // Calculate Gaussian falloff
    let falloff = exp(-(distance * distance) / (2.0 * GAUSSIAN_SIGMA * GAUSSIAN_SIGMA));

    // Calculate emission amount (scaled to reasonable depth values)
    let emission_rate = source.rate * params.deltaTime * falloff * EMISSION_SCALE;

    // Add to appropriate field based on source type
    if (source.sourceType < 0.5) {
      // Water source
      water_emission += emission_rate;
    } else {
      // Lava source
      lava_emission += emission_rate;
      temp_addition += LAVA_TEMPERATURE * falloff;
    }
  }

  // Apply water emission
  if (water_emission > 0.0) {
    let current_water = textureLoad(waterDepthTex, coord).r;
    let new_water = current_water + water_emission;
    textureStore(waterDepthTex, coord, vec4<f32>(new_water, 0.0, 0.0, 0.0));
  }

  // Apply lava emission
  if (lava_emission > 0.0) {
    let current_lava = textureLoad(lavaDepthTex, coord).r;
    let new_lava = current_lava + lava_emission;
    textureStore(lavaDepthTex, coord, vec4<f32>(new_lava, 0.0, 0.0, 0.0));

    // Update temperature (weighted average with existing)
    let current_temp = textureLoad(temperatureTex, coord).r;
    let lava_weight = lava_emission / (current_lava + 0.001);  // Avoid division by zero
    let new_temp = mix(current_temp, LAVA_TEMPERATURE, lava_weight);
    textureStore(temperatureTex, coord, vec4<f32>(new_temp, 0.0, 0.0, 0.0));
  }

  // Apply evaporation to water
  if (params.evaporationRate > 0.0) {
    let current_water = textureLoad(waterDepthTex, coord).r;
    let evaporation = params.evaporationRate * params.deltaTime;
    let new_water = max(current_water - evaporation, 0.0);
    textureStore(waterDepthTex, coord, vec4<f32>(new_water, 0.0, 0.0, 0.0));
  }

  // Cool down lava temperature
  let current_temp = textureLoad(temperatureTex, coord).r;
  if (current_temp > 20.0) {  // Room temperature
    let cooling_rate = 2.0;  // Degrees per second
    let new_temp = max(current_temp - cooling_rate * params.deltaTime, 20.0);
    textureStore(temperatureTex, coord, vec4<f32>(new_temp, 0.0, 0.0, 0.0));
  }
}