struct FlattenOp {
  center : vec2<f32>, // world meters (x,z) - sample point for target height
  radius : f32,       // meters - area to flatten
  strength : f32,     // flattening strength (0-1)
  dt : f32,
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
      // Get the target height from the center point
      let centerCoord = coord_of(op.center);
      let centerHeight = getHeight(centerCoord);

      // Calculate falloff weight
      let kernelWeight = flatten_kernel(dist, op.radius);
      let opStrength = op.strength * kernelWeight * op.dt;

      // Accumulate target height weighted by strength
      targetHeight += centerHeight * opStrength;
      accumulatedWeight += opStrength;
      totalStrength += opStrength;
    }
  }

  // Apply flattening if within range of any operation
  if (totalStrength > 0.0) {
    // Calculate average target height
    let avgTargetHeight = targetHeight / accumulatedWeight;
    let currentHeight = originalFields.r + originalFields.g + originalFields.b;

    // Calculate height difference
    let heightDiff = avgTargetHeight - currentHeight;

    // Apply the height change proportionally to each material
    let blendFactor = clamp(totalStrength, 0.0, 1.0);
    let adjustmentFactor = heightDiff * blendFactor;

    // Distribute the adjustment proportionally among materials
    let totalMaterial = originalFields.r + originalFields.g + originalFields.b;
    if (totalMaterial > 0.0) {
      let soilRatio = originalFields.r / totalMaterial;
      let rockRatio = originalFields.g / totalMaterial;
      let lavaRatio = originalFields.b / totalMaterial;

      // Apply adjustment
      flattenedFields.r = max(0.0, originalFields.r + adjustmentFactor * soilRatio);
      flattenedFields.g = max(0.0, originalFields.g + adjustmentFactor * rockRatio);
      flattenedFields.b = max(0.0, originalFields.b + adjustmentFactor * lavaRatio);
    } else if (adjustmentFactor > 0.0) {
      // If we're raising from zero, add as soil by default
      flattenedFields.r = adjustmentFactor;
    }

    // Clamp to reasonable values
    flattenedFields.r = clamp(flattenedFields.r, 0.0, 10.0);
    flattenedFields.g = clamp(flattenedFields.g, 0.0, 10.0);
    flattenedFields.b = clamp(flattenedFields.b, 0.0, 10.0);
  }

  textureStore(fieldsOut, coord, flattenedFields);
}