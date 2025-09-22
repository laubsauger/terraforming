struct SmoothOp {
  center : vec2<f32>, // world meters (x,z)
  radius : f32,       // meters
  strength : f32,     // smoothing strength (0-1)
  mode : f32,         // -1 = lower only, 0 = both, 1 = raise only
  dt : f32,
};

@group(0) @binding(0) var<storage, read> ops : array<SmoothOp>;

// Input field textures (combined RGBA: soil, rock, lava, unused)
@group(0) @binding(1) var fieldsIn : texture_storage_2d<rgba32float, read>;
@group(0) @binding(2) var fieldsOut : texture_storage_2d<rgba32float, write>;

@group(0) @binding(3) var<uniform> gridSize : vec2<u32>; // (w,h)
@group(0) @binding(4) var<uniform> cellSize : f32;       // meters per texel

fn tex_index(coord:vec2<u32>)->bool {
  return coord.x < gridSize.x && coord.y < gridSize.y;
}

fn world_of(coord:vec2<u32>)->vec2<f32> {
  return (vec2<f32>(coord) + vec2<f32>(0.5,0.5)) * cellSize; // (x,z)
}

fn smooth_kernel(dist:f32, radius:f32)->f32 {
  let t = clamp(1.0 - (dist*dist)/(radius*radius), 0.0, 1.0);
  // smootherstep for softer falloff
  return t * t * (3.0 - 2.0 * t);
}

// Get total height at a position
fn getHeight(coord: vec2<u32>) -> f32 {
  if (!tex_index(coord)) { return 0.0; }
  let fields = textureLoad(fieldsIn, coord);
  return fields.r + fields.g + fields.b; // soil + rock + lava
}

// Directional Gaussian smooth that can raise, lower, or both
fn directionalGaussianSmooth(center: vec2<u32>, mode: f32) -> vec4<f32> {
  if (!tex_index(center)) { return vec4<f32>(0.0); }

  let centerFields = textureLoad(fieldsIn, center);
  let centerHeight = centerFields.r + centerFields.g + centerFields.b;

  // 5x5 Gaussian weights (normalized)
  let weights = array<array<f32, 5>, 5>(
    array<f32, 5>(1.0/256.0,  4.0/256.0,  6.0/256.0,  4.0/256.0, 1.0/256.0),
    array<f32, 5>(4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0),
    array<f32, 5>(6.0/256.0, 24.0/256.0, 36.0/256.0, 24.0/256.0, 6.0/256.0),
    array<f32, 5>(4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0),
    array<f32, 5>(1.0/256.0,  4.0/256.0,  6.0/256.0,  4.0/256.0, 1.0/256.0)
  );

  var weightedSum = vec4<f32>(0.0);
  var totalWeight = 0.0;

  // Sample 5x5 neighborhood
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let sampleCoord = vec2<i32>(center) + vec2<i32>(dx, dy);
      if (sampleCoord.x >= 0 && sampleCoord.y >= 0 &&
          u32(sampleCoord.x) < gridSize.x && u32(sampleCoord.y) < gridSize.y) {

        let weight = weights[dy + 2][dx + 2];
        let sampleFields = textureLoad(fieldsIn, vec2<u32>(sampleCoord));
        let sampleHeight = sampleFields.r + sampleFields.g + sampleFields.b;

        // Apply directional filter based on mode
        var dirWeight = 1.0;
        if (mode > 0.5) {
          // Raise mode: only use samples that are higher than center
          if (sampleHeight > centerHeight) {
            dirWeight = 1.0;
          } else {
            dirWeight = 0.0;
          }
        } else if (mode < -0.5) {
          // Lower mode: only use samples that are lower than center
          if (sampleHeight < centerHeight) {
            dirWeight = 1.0;
          } else {
            dirWeight = 0.0;
          }
        }
        // mode == 0: use all samples (normal smoothing)

        let finalWeight = weight * dirWeight;
        weightedSum += sampleFields * finalWeight;
        totalWeight += finalWeight;
      }
    }
  }

  if (totalWeight > 0.0) {
    return weightedSum / totalWeight;
  } else {
    return centerFields;
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!tex_index(coord)) { return; }

  let wpos = world_of(coord);
  var originalFields = textureLoad(fieldsIn, coord);
  var smoothedFields = originalFields;

  // Check if this pixel is affected by any smoothing operations
  var totalStrength = 0.0;
  var effectiveSmoothing = vec4<f32>(0.0);

  for (var opIdx = 0u; opIdx < arrayLength(&ops); opIdx++) {
    let op = ops[opIdx];
    let dist = distance(wpos, op.center);

    if (dist <= op.radius) {
      let kernelWeight = smooth_kernel(dist, op.radius);
      let opStrength = op.strength * kernelWeight * op.dt;

      // Apply directional Gaussian smooth
      let smoothed = directionalGaussianSmooth(coord, op.mode);

      // Accumulate smoothing effect
      effectiveSmoothing += smoothed * opStrength;
      totalStrength += opStrength;
    }
  }

  // Blend original and smoothed based on total strength
  if (totalStrength > 0.0) {
    let normalizedSmoothing = effectiveSmoothing / totalStrength;
    let blendFactor = clamp(totalStrength, 0.0, 1.0);
    smoothedFields = mix(originalFields, normalizedSmoothing, blendFactor);
  }

  // Preserve total mass - very important for terrain consistency
  let originalTotal = originalFields.r + originalFields.g + originalFields.b;
  let smoothedTotal = smoothedFields.r + smoothedFields.g + smoothedFields.b;

  if (smoothedTotal > 0.0 && originalTotal > 0.0) {
    let massRatio = originalTotal / smoothedTotal;
    smoothedFields.r *= massRatio;
    smoothedFields.g *= massRatio;
    smoothedFields.b *= massRatio;
  }

  textureStore(fieldsOut, coord, smoothedFields);
}