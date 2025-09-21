// Terrain rendering with debug visualization support
struct Uniforms {
  mvpMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  projMatrix: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  debugMode: u32,  // 0: normal, 1: wireframe, 2: normals, 3: slope, 4: curvature
  gridSize: vec2<f32>,
  heightScale: f32,
  texelSize: vec2<f32>,
};

struct VertexInput {
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) normal: vec3<f32>,
  @location(3) slope: f32,
  @location(4) curvature: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var heightTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var flowTex: texture_2d<f32>;
@group(0) @binding(5) var accumulationTex: texture_2d<f32>;
@group(0) @binding(6) var sedimentTex: texture_2d<f32>;

fn getVertexPosition(index: u32) -> vec2<f32> {
  // Generate grid vertices procedurally
  let gridWidth = u32(uniforms.gridSize.x);
  let x = f32(index % gridWidth);
  let y = f32(index / gridWidth);

  return vec2<f32>(x, y) / (uniforms.gridSize - 1.0);
}

fn sampleHeightBicubic(uv: vec2<f32>) -> f32 {
  // Bicubic interpolation for smoother terrain
  let texSize = vec2<f32>(textureDimensions(heightTex, 0));
  let coord = uv * texSize - 0.5;
  let f = fract(coord);
  let i = floor(coord);

  // Cubic interpolation weights
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);

  // Sample 4x4 neighborhood
  var result = 0.0;
  for (var y = -1; y <= 2; y++) {
    for (var x = -1; x <= 2; x++) {
      let samplePos = (i + vec2<f32>(f32(x), f32(y)) + 0.5) / texSize;
      let height = textureSampleLevel(heightTex, linearSampler, samplePos, 0.0).r;

      var weight = 1.0;
      if (x == -1) { weight *= w0.x; }
      else if (x == 0) { weight *= w1.x; }
      else if (x == 1) { weight *= w2.x; }
      else { weight *= w3.x; }

      if (y == -1) { weight *= w0.y; }
      else if (y == 0) { weight *= w1.y; }
      else if (y == 1) { weight *= w2.y; }
      else { weight *= w3.y; }

      result += height * weight;
    }
  }

  return result;
}

fn calculateNormal(uv: vec2<f32>) -> vec3<f32> {
  let h = uniforms.texelSize.x;

  // Sample neighboring heights
  let hL = sampleHeightBicubic(uv + vec2<f32>(-h, 0.0));
  let hR = sampleHeightBicubic(uv + vec2<f32>(h, 0.0));
  let hD = sampleHeightBicubic(uv + vec2<f32>(0.0, -h));
  let hU = sampleHeightBicubic(uv + vec2<f32>(0.0, h));

  // Calculate normal using central differences
  let dx = (hR - hL) * uniforms.heightScale / (2.0 * h);
  let dy = (hU - hD) * uniforms.heightScale / (2.0 * h);

  return normalize(vec3<f32>(-dx, 1.0, -dy));
}

fn calculateSlope(normal: vec3<f32>) -> f32 {
  // Calculate slope angle in radians
  return acos(dot(normal, vec3<f32>(0.0, 1.0, 0.0)));
}

fn calculateCurvature(uv: vec2<f32>) -> f32 {
  let h = uniforms.texelSize.x;

  // Sample heights in cross pattern
  let hC = sampleHeightBicubic(uv);
  let hL = sampleHeightBicubic(uv + vec2<f32>(-h, 0.0));
  let hR = sampleHeightBicubic(uv + vec2<f32>(h, 0.0));
  let hD = sampleHeightBicubic(uv + vec2<f32>(0.0, -h));
  let hU = sampleHeightBicubic(uv + vec2<f32>(0.0, h));

  // Laplacian for curvature
  let curvature = (hL + hR + hD + hU - 4.0 * hC) / (h * h);
  return curvature * uniforms.heightScale;
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Get grid position
  let gridPos = getVertexPosition(input.vertexIndex);
  output.uv = gridPos;

  // Sample height with bicubic interpolation
  let height = sampleHeightBicubic(gridPos) * uniforms.heightScale;

  // Calculate world position
  let localPos = vec3<f32>(
    gridPos.x * uniforms.gridSize.x - uniforms.gridSize.x * 0.5,
    height,
    gridPos.y * uniforms.gridSize.y - uniforms.gridSize.y * 0.5
  );

  output.worldPos = (uniforms.modelMatrix * vec4<f32>(localPos, 1.0)).xyz;
  output.position = uniforms.mvpMatrix * vec4<f32>(localPos, 1.0);

  // Calculate surface properties
  output.normal = calculateNormal(gridPos);
  output.slope = calculateSlope(output.normal);
  output.curvature = calculateCurvature(gridPos);

  return output;
}

// Material functions
fn getTerrainColor(worldPos: vec3<f32>, normal: vec3<f32>, slope: f32, uv: vec2<f32>) -> vec3<f32> {
  // Sample flow accumulation for moisture
  let accumulation = textureSample(accumulationTex, linearSampler, uv).r;
  let flow = length(textureSample(flowTex, linearSampler, uv).xy);
  let sediment = textureSample(sedimentTex, linearSampler, uv).r;

  // Base terrain colors
  let sandColor = vec3<f32>(0.9, 0.85, 0.7);
  let grassColor = vec3<f32>(0.3, 0.6, 0.2);
  let rockColor = vec3<f32>(0.5, 0.45, 0.4);
  let snowColor = vec3<f32>(0.95, 0.95, 1.0);

  // Height-based color selection
  let height = worldPos.y;
  var baseColor: vec3<f32>;

  if (height < 5.0) {
    // Beach/sand zone
    baseColor = sandColor;
  } else if (height < 50.0) {
    // Grass/vegetation zone
    let t = (height - 5.0) / 45.0;
    baseColor = mix(sandColor, grassColor, t);
  } else if (height < 100.0) {
    // Rock zone
    let t = (height - 50.0) / 50.0;
    baseColor = mix(grassColor, rockColor, t);
  } else {
    // Snow zone
    let t = saturate((height - 100.0) / 20.0);
    baseColor = mix(rockColor, snowColor, t);
  }

  // Slope-based modulation
  if (slope > 0.7) {
    baseColor = mix(baseColor, rockColor, saturate((slope - 0.7) / 0.3));
  }

  // Moisture/accumulation modulation
  if (accumulation > 0.01) {
    let wetness = saturate(log2(accumulation + 1.0) / 5.0);
    baseColor = mix(baseColor, baseColor * 0.7, wetness);
  }

  // Sediment tinting
  if (sediment > 0.01) {
    let mudColor = vec3<f32>(0.4, 0.3, 0.2);
    baseColor = mix(baseColor, mudColor, saturate(sediment));
  }

  return baseColor;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  var color: vec3<f32>;

  switch (uniforms.debugMode) {
    case 1u: {
      // Wireframe mode - handled by pipeline state
      color = vec3<f32>(0.0, 1.0, 0.0);
    }
    case 2u: {
      // Normal visualization
      color = input.normal * 0.5 + 0.5;
    }
    case 3u: {
      // Slope visualization
      let slopeNorm = saturate(input.slope / 1.57); // Normalize to 0-90 degrees
      color = vec3<f32>(slopeNorm, 1.0 - slopeNorm, 0.0);
    }
    case 4u: {
      // Curvature visualization
      let curv = input.curvature * 10.0;
      if (curv < 0.0) {
        // Concave - blue
        color = vec3<f32>(0.0, 0.0, saturate(-curv));
      } else {
        // Convex - red
        color = vec3<f32>(saturate(curv), 0.0, 0.0);
      }
    }
    default: {
      // Normal terrain rendering
      color = getTerrainColor(input.worldPos, input.normal, input.slope, input.uv);

      // Simple lighting
      let lightDir = normalize(vec3<f32>(1.0, 2.0, 1.0));
      let ndotl = max(dot(input.normal, lightDir), 0.0);
      let ambient = 0.3;
      let diffuse = ndotl * 0.7;

      color = color * (ambient + diffuse);
    }
  }

  // Distance fog
  let dist = distance(input.worldPos, uniforms.cameraPos);
  let fogFactor = saturate((dist - 100.0) / 400.0);
  let fogColor = vec3<f32>(0.7, 0.8, 0.9);
  color = mix(color, fogColor, fogFactor);

  return vec4<f32>(color, 1.0);
}