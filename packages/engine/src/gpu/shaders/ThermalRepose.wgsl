@group(0) @binding(0) var rockTex : texture_storage_2d<r32float, read>;
@group(0) @binding(1) var soilTex : texture_storage_2d<r32float, read>;
@group(0) @binding(2) var soilOutTex : texture_storage_2d<r32float, write>;
@group(0) @binding(3) var<uniform> gridSize : vec2<u32>;
@group(0) @binding(4) var<uniform> cellSize : f32;
@group(0) @binding(5) var<uniform> tanPhi : f32; // tan(angle-of-repose)

fn inBounds(p:vec2<i32>)->bool {
  return p.x>=0 && p.y>=0 && u32(p.x)<gridSize.x && u32(p.y)<gridSize.y;
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = vec2<i32>(gid.xy);
  if (!inBounds(p)) { return; }

  let up = vec2<u32>(p);
  let h0 = textureLoad(rockTex, up).r + textureLoad(soilTex, up).r;
  let soilHere = textureLoad(soilTex, up).r;

  // 8-neighborhood
  let nb = array<vec2<i32>,8>(
    vec2<i32>( 1, 0), vec2<i32>(-1, 0), vec2<i32>(0, 1), vec2<i32>(0,-1),
    vec2<i32>( 1, 1), vec2<i32>( 1,-1), vec2<i32>(-1,1), vec2<i32>(-1,-1)
  );

  // Calculate net change for this cell
  // Since we can't read-accumulate into the output, we just write this cell's final value
  var soilFinal = soilHere;

  // Simplified: Just write the original value for now
  // A proper implementation would need two passes or atomic operations
  textureStore(soilOutTex, up, vec4<f32>(soilFinal, 0, 0, 0));
}