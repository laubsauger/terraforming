// ApplyDeltas_optimized.wgsl - Apply accumulated deltas to fields using combined RGBA textures

// Combined fields input: R=soil, G=rock, B=lava, A=unused (read-only)
@group(0) @binding(0) var fieldsInTex : texture_storage_2d<rgba32float, read>;

// Combined fields output: R=soil, G=rock, B=lava, A=unused (write-only)
@group(0) @binding(1) var fieldsOutTex : texture_storage_2d<rgba32float, write>;

// Combined deltas: R=Δsoil, G=Δrock, B=Δlava, A=unused (read-only)
@group(0) @binding(2) var deltasTex : texture_storage_2d<rgba32float, read>;

@group(0) @binding(3) var<uniform> gridSize : vec2<u32>;

const ROCK_MIN_HEIGHT = 0.1; // Minimum rock height (meters)

@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
  let coord = gid.xy;
  if (coord.x >= gridSize.x || coord.y >= gridSize.y) { return; }

  // Load current values and deltas
  let fields = textureLoad(fieldsInTex, coord);
  let deltas = textureLoad(deltasTex, coord);

  // Apply deltas with clamping
  var newFields = fields;
  newFields.r = max(0.0, fields.r + deltas.r);  // soil
  newFields.g = max(ROCK_MIN_HEIGHT, fields.g + deltas.g);  // rock
  newFields.b = max(0.0, fields.b + deltas.b);  // lava

  // Write updated fields to output texture
  textureStore(fieldsOutTex, coord, newFields);

  // Note: Delta clearing needs to be done separately since deltasTex is read-only here
}