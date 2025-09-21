@group(0) @binding(0) var soilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(1) var rockTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var lavaTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var deltaSoilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(4) var deltaRockTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(5) var deltaLavaTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(6) var<uniform> gridSize : vec2<u32>;

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = gid.xy;
  if (p.x >= gridSize.x || p.y >= gridSize.y) { return; }

  var s = textureLoad(soilTex, p).r;
  var r = textureLoad(rockTex, p).r;
  var l = textureLoad(lavaTex, p).r;

  let ds = textureLoad(deltaSoilTex, p).r;
  let dr = textureLoad(deltaRockTex, p).r;
  let dl = textureLoad(deltaLavaTex, p).r;

  s = max(0.0, s + ds);
  r = max(ROCK_MIN_HEIGHT, r + dr);
  l = max(0.0, l + dl);

  textureStore(soilTex, p, vec4<f32>(s,0,0,0));
  textureStore(rockTex, p, vec4<f32>(r,0,0,0));
  textureStore(lavaTex, p, vec4<f32>(l,0,0,0));

  // clear deltas
  textureStore(deltaSoilTex, p, vec4<f32>(0,0,0,0));
  textureStore(deltaRockTex, p, vec4<f32>(0,0,0,0));
  textureStore(deltaLavaTex, p, vec4<f32>(0,0,0,0));
}

const ROCK_MIN_HEIGHT : f32 = -1000.0; // allow deep mines (tweak)