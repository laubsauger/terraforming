// ApplyDeltas_optimized.wgsl - Apply accumulated deltas to fields using combined RGBA textures

// Combined fields input: R=soil, G=rock, B=lava, A=unused (read-only)
@group(0) @binding(0) var fieldsInTex : texture_storage_2d<rgba32float, read>;

// Combined fields output: R=soil, G=rock, B=lava, A=unused (write-only)
@group(0) @binding(1) var fieldsOutTex : texture_storage_2d<rgba32float, write>;

// Combined deltas: R=Δsoil, G=Δrock, B=Δlava, A=unused (read-only)
@group(0) @binding(2) var deltasTex : texture_storage_2d<rgba32float, read>;

@group(0) @binding(3) var<uniform> gridSize : vec2<u32>;

// Auto-generated terrain constants - DO NOT EDIT MANUALLY
const SEA_LEVEL_NORMALIZED: f32 = 0.15;
const HEIGHT_SCALE: f32 = 64.0;
const WATER_LEVEL_ABSOLUTE: f32 = 9.6;
const MAX_HEIGHT_ABSOLUTE: f32 = 64.0;
const OCEAN_DEPTH_RANGE: f32 = 9.6;

// Ocean zones (normalized)
const OCEAN_FLOOR: f32 = 0;
const OCEAN_DEEP: f32 = 0.03;
const OCEAN_MID: f32 = 0.075;
const OCEAN_SHALLOW: f32 = 0.12;

// Beach zones (normalized)
const BEACH_WATER_LINE: f32 = 0.15;
const BEACH_DRY: f32 = 0.155;
const BEACH_HIGH: f32 = 0.17;

// Land zones (normalized)
const COASTAL_PLAINS: f32 = 0.1925;
const GRASSLANDS: f32 = 0.2775;
const FOOTHILLS: f32 = 0.405;
const MOUNTAINS_LOW: f32 = 0.575;
const MOUNTAINS_MID: f32 = 0.745;
const MOUNTAINS_HIGH: f32 = 0.8725;
const PEAKS: f32 = 1;

const ROCK_MIN_HEIGHT = 0.0; // Minimum rock height (allow ocean floor at 0)
const MAX_TOTAL_HEIGHT = MAX_HEIGHT_ABSOLUTE; // Maximum total height in meters
const SEA_LEVEL_HEIGHT = WATER_LEVEL_ABSOLUTE; // Sea level in meters

@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
  let coord = gid.xy;
  if (coord.x >= gridSize.x || coord.y >= gridSize.y) { return; }

  // Load current values and deltas
  let fields = textureLoad(fieldsInTex, coord);
  let deltas = textureLoad(deltasTex, coord);

  // Apply deltas with individual clamping
  var newFields = fields;
  newFields.r = max(0.0, fields.r + deltas.r);  // soil
  newFields.g = max(ROCK_MIN_HEIGHT, fields.g + deltas.g);  // rock
  newFields.b = max(0.0, fields.b + deltas.b);  // lava

  // Enforce maximum total height constraint
  let totalHeight = newFields.r + newFields.g + newFields.b;
  if (totalHeight > MAX_TOTAL_HEIGHT) {
    // Scale all components proportionally to maintain ratios
    let scale = MAX_TOTAL_HEIGHT / totalHeight;
    newFields.r *= scale;
    newFields.g *= scale;
    newFields.b *= scale;
  }

  // Write updated fields to output texture
  textureStore(fieldsOutTex, coord, newFields);

  // Note: Delta clearing needs to be done separately since deltasTex is read-only here
}