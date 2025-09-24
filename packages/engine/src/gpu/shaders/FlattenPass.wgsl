struct FlattenOp {
  center : vec2<f32>, // world meters (x,z) - sample point for target height
  radius : f32,       // meters - area to flatten
  strength : f32,     // flattening strength (0-1)
  dt : f32,
  mode : u32,         // 0=flatten, 1=flatten+raise, 2=flatten+lower
};

@group(0) @binding(0) var<storage, read> ops : array<FlattenOp>;

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

fn coord_of(world_pos:vec2<f32>)->vec2<u32> {
  let texel = world_pos / cellSize;
  return vec2<u32>(u32(clamp(texel.x, 0.0, f32(gridSize.x - 1u))),
                   u32(clamp(texel.y, 0.0, f32(gridSize.y - 1u))));
}

fn flatten_kernel(dist:f32, radius:f32)->f32 {
  let t = clamp(1.0 - (dist*dist)/(radius*radius), 0.0, 1.0);
  // smootherstep for softer falloff at edges
  return t * t * (3.0 - 2.0 * t);
}

// Get total height at a position
fn getHeight(coord: vec2<u32>) -> f32 {
  if (!tex_index(coord)) { return 0.0; }
  let fields = textureLoad(fieldsIn, coord);
  return fields.r + fields.g + fields.b; // soil + rock + lava
}

// Sample average height in neighborhood
fn getNeighborhoodAverage(center: vec2<u32>, radius: i32) -> vec4<f32> {
  var sumFields = vec4<f32>(0.0);
  var count = 0.0;

  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let sampleCoord = vec2<i32>(center) + vec2<i32>(dx, dy);
      if (sampleCoord.x >= 0 && sampleCoord.y >= 0 &&
          u32(sampleCoord.x) < gridSize.x && u32(sampleCoord.y) < gridSize.y) {
        let dist = length(vec2<f32>(f32(dx), f32(dy)));
        if (dist <= f32(radius)) {
          let fields = textureLoad(fieldsIn, vec2<u32>(sampleCoord));
          sumFields += fields;
          count += 1.0;
        }
      }
    }
  }

  if (count > 0.0) {
    return sumFields / count;
  }
  return vec4<f32>(0.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coord = gid.xy;
  if (!tex_index(coord)) { return; }

  let wpos = world_of(coord);
  var originalFields = textureLoad(fieldsIn, coord);
  var flattenedFields = originalFields;

  // Check if this pixel is affected by any flattening operations
  var totalStrength = 0.0;
  var targetHeight = 0.0;
  var accumulatedWeight = 0.0;

  for (var opIdx = 0u; opIdx < arrayLength(&ops); opIdx++) {
    let op = ops[opIdx];
    let dist = distance(wpos, op.center);

    if (dist <= op.radius) {
      // Get the target height from the center point of the brush
      let centerCoord = coord_of(op.center);
      var centerHeight = getHeight(centerCoord);

      // Adjust target height based on mode
      if (op.mode == 1u) { // flatten + raise
        centerHeight += 0.5; // Bias upward by 0.5 meters
      } else if (op.mode == 2u) { // flatten + lower
        centerHeight -= 0.5; // Bias downward by 0.5 meters
      }

      // Calculate falloff weight
      let kernelWeight = flatten_kernel(dist, op.radius);
      let opStrength = op.strength * kernelWeight * op.dt;

      // Accumulate target height weighted by strength
      targetHeight += centerHeight * opStrength;
      accumulatedWeight += opStrength;
      totalStrength += opStrength;
    }
  }

  // Apply flattening through material redistribution
  if (totalStrength > 0.0) {
    // Calculate target height
    let avgTargetHeight = targetHeight / accumulatedWeight;
    let currentHeight = originalFields.r + originalFields.g + originalFields.b;

    // Calculate neighborhood average for material redistribution
    let neighborhoodSize = 3; // Sample 7x7 area
    let neighborAvg = getNeighborhoodAverage(coord, neighborhoodSize);
    let neighborHeight = neighborAvg.r + neighborAvg.g + neighborAvg.b;

    // Blend between current, target, and neighborhood based on operation strength
    let blendFactor = clamp(totalStrength, 0.0, 1.0);

    // Move toward target height by redistributing from neighborhood
    if (abs(avgTargetHeight - currentHeight) > 0.001) {
      let heightDiff = avgTargetHeight - currentHeight;

      // Blend toward target using neighborhood material distribution
      if (heightDiff > 0.0 && neighborHeight > 0.001) {
        // Need to raise: pull material from neighborhood proportions
        let raiseAmount = min(heightDiff * blendFactor, neighborHeight * 0.5);
        let soilRatio = neighborAvg.r / max(neighborHeight, 0.001);
        let rockRatio = neighborAvg.g / max(neighborHeight, 0.001);
        let lavaRatio = neighborAvg.b / max(neighborHeight, 0.001);

        flattenedFields.r = mix(originalFields.r, originalFields.r + raiseAmount * soilRatio, blendFactor);
        flattenedFields.g = mix(originalFields.g, originalFields.g + raiseAmount * rockRatio, blendFactor);
        flattenedFields.b = mix(originalFields.b, originalFields.b + raiseAmount * lavaRatio, blendFactor);
      } else if (heightDiff < 0.0 && currentHeight > 0.001) {
        // Need to lower: remove material proportionally
        let lowerAmount = min(abs(heightDiff) * blendFactor, currentHeight * 0.9);
        let removalRatio = 1.0 - (lowerAmount / currentHeight);

        flattenedFields.r = originalFields.r * removalRatio;
        flattenedFields.g = originalFields.g * removalRatio;
        flattenedFields.b = originalFields.b * removalRatio;
      }
    }

    // Clamp to reasonable values
    flattenedFields.r = clamp(flattenedFields.r, 0.0, 10.0);
    flattenedFields.g = clamp(flattenedFields.g, 0.0, 10.0);
    flattenedFields.b = clamp(flattenedFields.b, 0.0, 10.0);
  }

  textureStore(fieldsOut, coord, flattenedFields);
}