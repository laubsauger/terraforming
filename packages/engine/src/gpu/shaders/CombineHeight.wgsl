// CombineHeight.wgsl - Combine soil and rock into a single height texture
// Works with optimized fields structure where soil/rock/lava are packed in RGBA

@group(0) @binding(0) var fieldsTex: texture_storage_2d<rgba32float, read>; // RGBA: R=soil, G=rock, B=lava, A=unused
@group(0) @binding(1) var combinedHeightTex: texture_storage_2d<r32float, write>;

const WORKGROUP_SIZE = 8u;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(fieldsTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let coord = vec2<i32>(id.xy);

  // Load fields RGBA texture (R=soil, G=rock, B=lava, A=unused)
  let fields = textureLoad(fieldsTex, coord);
  let soil = fields.r;
  let rock = fields.g;

  // Combined height is sum of soil and rock
  let combinedHeight = soil + rock;

  // Store the combined height
  textureStore(combinedHeightTex, coord, vec4<f32>(combinedHeight, 0.0, 0.0, 0.0));
}