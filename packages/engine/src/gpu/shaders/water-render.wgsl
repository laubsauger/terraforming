// Water rendering with flow-based animation and debug modes
struct Uniforms {
  mvpMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  projMatrix: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  debugMode: u32,  // 0: normal, 1: flow vectors, 2: depth, 3: foam, 4: velocity magnitude
  waterLevel: f32,
  refractionStrength: f32,
  foamThreshold: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) flowUV: vec2<f32>,
  @location(3) viewVector: vec3<f32>,
  @location(4) depth: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var heightTex: texture_2d<f32>;
@group(0) @binding(3) var waterDepthTex: texture_2d<f32>;
@group(0) @binding(4) var flowTex: texture_2d<f32>;
@group(0) @binding(5) var accumulationTex: texture_2d<f32>;
@group(0) @binding(6) var normalTex1: texture_2d<f32>;
@group(0) @binding(7) var normalTex2: texture_2d<f32>;
@group(0) @binding(8) var foamTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate full-screen quad
  let x = f32(vertexIndex & 1u) * 2.0 - 1.0;
  let y = f32((vertexIndex >> 1u) & 1u) * 2.0 - 1.0;

  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

  // Sample water depth
  let waterDepth = textureSampleLevel(waterDepthTex, linearSampler, output.uv, 0.0).r;
  output.depth = waterDepth;

  // Sample terrain height and flow
  let terrainHeight = textureSampleLevel(heightTex, linearSampler, output.uv, 0.0).r;
  let flow = textureSampleLevel(flowTex, linearSampler, output.uv, 0.0).xy;

  // Calculate water surface position
  let waterHeight = terrainHeight + waterDepth;
  output.worldPos = vec3<f32>(
    output.uv.x * 100.0 - 50.0,
    waterHeight,
    output.uv.y * 100.0 - 50.0
  );

  // Calculate flow-animated UV
  let flowSpeed = length(flow);
  let flowDir = normalize(flow + vec2<f32>(0.001)); // Avoid division by zero
  output.flowUV = output.uv + flowDir * uniforms.time * flowSpeed * 0.1;

  // View vector for fresnel
  output.viewVector = normalize(uniforms.cameraPos - output.worldPos);

  return output;
}

fn sampleFlowNormal(uv: vec2<f32>, flow: vec2<f32>) -> vec3<f32> {
  // Flow-based normal mapping
  let cycle = 2.0;
  let halfCycle = cycle * 0.5;
  let offset = fract(uniforms.time / cycle);

  // Dual layer flow mapping
  let phase1 = fract(uniforms.time / cycle);
  let phase2 = fract(uniforms.time / cycle + 0.5);

  let flowUV1 = uv + flow * phase1;
  let flowUV2 = uv + flow * phase2;

  let normal1 = textureSample(normalTex1, linearSampler, flowUV1).xyz * 2.0 - 1.0;
  let normal2 = textureSample(normalTex2, linearSampler, flowUV2).xyz * 2.0 - 1.0;

  // Blend between phases
  let blend = abs(phase1 - 0.5) * 2.0;
  return normalize(mix(normal1, normal2, blend));
}

fn calculateFoam(uv: vec2<f32>, flow: vec2<f32>, depth: f32) -> f32 {
  // Foam generation based on flow convergence and shallow depth
  let h = 0.01;

  // Sample neighboring flow
  let flowL = textureSample(flowTex, linearSampler, uv + vec2<f32>(-h, 0.0)).xy;
  let flowR = textureSample(flowTex, linearSampler, uv + vec2<f32>(h, 0.0)).xy;
  let flowD = textureSample(flowTex, linearSampler, uv + vec2<f32>(0.0, -h)).xy;
  let flowU = textureSample(flowTex, linearSampler, uv + vec2<f32>(0.0, h)).xy;

  // Calculate divergence
  let divergence = (flowR.x - flowL.x) / (2.0 * h) + (flowU.y - flowD.y) / (2.0 * h);

  // Calculate curl for turbulence
  let curl = abs((flowR.y - flowL.y) / (2.0 * h) - (flowU.x - flowD.x) / (2.0 * h));

  // Foam factors
  let shallowFoam = saturate(1.0 - depth / 2.0);
  let convergenceFoam = saturate(-divergence * 10.0);
  let turbulenceFoam = saturate(curl * 5.0);

  // Sample foam texture with flow animation
  let foamUV = uv * 10.0 + flow * uniforms.time * 0.2;
  let foamPattern = textureSample(foamTex, linearSampler, foamUV).r;

  return saturate((shallowFoam + convergenceFoam + turbulenceFoam) * foamPattern);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Early discard for no water
  if (input.depth < 0.01) {
    discard;
  }

  let flow = textureSample(flowTex, linearSampler, input.uv).xy;
  var color: vec3<f32>;

  switch (uniforms.debugMode) {
    case 1u: {
      // Flow vectors visualization
      let flowMag = length(flow);
      let flowAngle = atan2(flow.y, flow.x);

      // HSV to RGB for direction
      let h = (flowAngle + 3.14159) / (2.0 * 3.14159);
      let s = saturate(flowMag * 10.0);
      let v = 1.0;

      // Convert HSV to RGB
      let c = v * s;
      let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
      let m = v - c;

      if (h < 1.0/6.0) {
        color = vec3<f32>(c, x, 0.0);
      } else if (h < 2.0/6.0) {
        color = vec3<f32>(x, c, 0.0);
      } else if (h < 3.0/6.0) {
        color = vec3<f32>(0.0, c, x);
      } else if (h < 4.0/6.0) {
        color = vec3<f32>(0.0, x, c);
      } else if (h < 5.0/6.0) {
        color = vec3<f32>(x, 0.0, c);
      } else {
        color = vec3<f32>(c, 0.0, x);
      }
      color += vec3<f32>(m, m, m);
    }
    case 2u: {
      // Depth visualization
      let depthNorm = saturate(input.depth / 5.0);
      color = vec3<f32>(0.0, depthNorm, depthNorm * 0.5);
    }
    case 3u: {
      // Foam visualization
      let foam = calculateFoam(input.uv, flow, input.depth);
      color = vec3<f32>(foam, foam, foam);
    }
    case 4u: {
      // Velocity magnitude
      let speed = length(flow);
      color = vec3<f32>(speed * 5.0, 0.0, 1.0 - speed * 5.0);
    }
    default: {
      // Normal water rendering

      // Sample flow-animated normal
      let normal = sampleFlowNormal(input.flowUV, flow * 0.1);

      // Water colors
      let shallowColor = vec3<f32>(0.1, 0.5, 0.6);
      let deepColor = vec3<f32>(0.0, 0.2, 0.4);
      let depthFactor = saturate(input.depth / 3.0);

      // Base water color
      let waterColor = mix(shallowColor, deepColor, depthFactor);

      // Fresnel effect
      let fresnel = pow(1.0 - max(dot(normal, input.viewVector), 0.0), 2.0);

      // Reflections (simple sky color)
      let skyColor = vec3<f32>(0.7, 0.85, 1.0);
      color = mix(waterColor, skyColor, fresnel * 0.5);

      // Add foam
      let foam = calculateFoam(input.uv, flow, input.depth);
      let foamColor = vec3<f32>(0.95, 0.95, 0.95);
      color = mix(color, foamColor, foam * 0.8);

      // Transparency based on depth
      let alpha = saturate(input.depth * 2.0 + 0.3);
    }
  }

  // Opacity calculation
  var opacity = 1.0;
  if (uniforms.debugMode == 0u) {
    // Varying opacity for normal rendering
    opacity = saturate(input.depth * 2.0 + 0.3);
  }

  return vec4<f32>(color, opacity);
}