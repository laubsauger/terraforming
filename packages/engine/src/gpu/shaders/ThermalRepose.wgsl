@group(0) @binding(0) var rockTex : texture_storage_2d<r32float, read>;
@group(0) @binding(1) var soilTex : texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var soilOutTex : texture_storage_2d<r32float, read_write>;
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
  var soilHere = textureLoad(soilTex, up).r;
  var delta = 0.0;

  // 8-neighborhood
  let nb = array<vec2<i32>,8>(
    vec2<i32>( 1, 0), vec2<i32>(-1, 0), vec2<i32>(0, 1), vec2<i32>(0,-1),
    vec2<i32>( 1, 1), vec2<i32>( 1,-1), vec2<i32>(-1,1), vec2<i32>(-1,-1)
  );

  for (var k=0; k<8; k++) {
    let q = p + nb[k];
    if (!inBounds(q)) { continue; }
    let uq = vec2<u32>(q);
    let dist = length(vec2<f32>(nb[k])) * cellSize;
    let hq = textureLoad(rockTex, uq).r + textureLoad(soilTex, uq).r;
    let drop = h0 - hq;
    let maxDrop = tanPhi * dist;
    if (drop > maxDrop && soilHere > 0.0) {
      let move = 0.5 * (drop - maxDrop); // split difference
      let moveClamped = min(move, soilHere);
      soilHere -= moveClamped;
      // accumulate into neighbor in out texture
      let so = textureLoad(soilOutTex, uq).r;
      textureStore(soilOutTex, uq, vec4<f32>(so + moveClamped,0,0,0));
      delta -= moveClamped;
    }
  }

  // write self
  let selfOut = textureLoad(soilOutTex, up).r;
  textureStore(soilOutTex, up, vec4<f32>(selfOut + soilHere + delta, 0,0,0));
}