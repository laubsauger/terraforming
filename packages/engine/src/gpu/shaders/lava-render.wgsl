// Lava rendering with temperature-based appearance and debug modes
struct Uniforms {
  mvpMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  projMatrix: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  debugMode: u32,  // 0: normal, 1: temperature, 2: crust, 3: flow
  minTemp: f32,
  maxTemp: f32,
  emissiveStrength: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) temperature: f32,
  @location(3) crust: f32,
  @location(4) flow: vec2<f32>,
  @location(5) depth: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var heightTex: texture_2d<f32>;
@group(0) @binding(3) var lavaDepthTex: texture_2d<f32>;
@group(0) @binding(4) var temperatureTex: texture_2d<f32>;
@group(0) @binding(5) var crustTex: texture_2d<f32>;
@group(0) @binding(6) var lavaFlowTex: texture_2d<f32>;
@group(0) @binding(7) var noiseTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate full-screen quad
  let x = f32(vertexIndex & 1u) * 2.0 - 1.0;
  let y = f32((vertexIndex >> 1u) & 1u) * 2.0 - 1.0;

  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

  // Sample lava properties
  let lavaDepth = textureSampleLevel(lavaDepthTex, linearSampler, output.uv, 0.0).r;
  let temperature = textureSampleLevel(temperatureTex, linearSampler, output.uv, 0.0).r;
  let crust = textureSampleLevel(crustTex, linearSampler, output.uv, 0.0).r;
  let flow = textureSampleLevel(lavaFlowTex, linearSampler, output.uv, 0.0).xy;

  output.depth = lavaDepth;
  output.temperature = temperature;
  output.crust = crust;
  output.flow = flow;

  // Calculate lava surface position
  let terrainHeight = textureSampleLevel(heightTex, linearSampler, output.uv, 0.0).r;
  let lavaHeight = terrainHeight + lavaDepth;

  output.worldPos = vec3<f32>(
    output.uv.x * 100.0 - 50.0,
    lavaHeight,
    output.uv.y * 100.0 - 50.0
  );

  return output;
}

fn temperatureToColor(temp: f32) -> vec3<f32> {
  // Map temperature to lava color
  let normalizedTemp = saturate((temp - uniforms.minTemp) / (uniforms.maxTemp - uniforms.minTemp));

  var color: vec3<f32>;

  if (normalizedTemp < 0.2) {
    // Cool crust: black to dark red
    color = mix(
      vec3<f32>(0.05, 0.02, 0.01),
      vec3<f32>(0.3, 0.05, 0.02),
      normalizedTemp * 5.0
    );
  } else if (normalizedTemp < 0.4) {
    // Warming: dark red to red
    color = mix(
      vec3<f32>(0.3, 0.05, 0.02),
      vec3<f32>(0.8, 0.1, 0.05),
      (normalizedTemp - 0.2) * 5.0
    );
  } else if (normalizedTemp < 0.7) {
    // Hot: red to orange
    color = mix(
      vec3<f32>(0.8, 0.1, 0.05),
      vec3<f32>(1.0, 0.5, 0.1),
      (normalizedTemp - 0.4) * 3.33
    );
  } else if (normalizedTemp < 0.9) {
    // Very hot: orange to yellow-orange
    color = mix(
      vec3<f32>(1.0, 0.5, 0.1),
      vec3<f32>(1.0, 0.8, 0.3),
      (normalizedTemp - 0.7) * 5.0
    );
  } else {
    // Extreme: yellow-white
    color = mix(
      vec3<f32>(1.0, 0.8, 0.3),
      vec3<f32>(1.0, 1.0, 0.8),
      (normalizedTemp - 0.9) * 10.0
    );
  }

  return color;
}

fn sampleFlowDistortion(uv: vec2<f32>, flow: vec2<f32>) -> vec3<f32> {
  // Animated flow-based distortion
  let flowSpeed = length(flow);
  let flowDir = normalize(flow + vec2<f32>(0.001));

  // Multiple octaves for organic movement
  let uv1 = uv * 5.0 + flowDir * uniforms.time * 0.05;
  let uv2 = uv * 3.0 - flowDir * uniforms.time * 0.03;
  let uv3 = uv * 8.0 + vec2<f32>(uniforms.time * 0.02, 0.0);

  let noise1 = textureSample(noiseTex, linearSampler, uv1).r;
  let noise2 = textureSample(noiseTex, linearSampler, uv2).r;
  let noise3 = textureSample(noiseTex, linearSampler, uv3).r;

  return vec3<f32>(noise1, noise2, noise3);
}

fn calculateEmissive(temp: f32, crust: f32) -> f32 {
  // Emissive strength based on temperature and crust
  let tempFactor = saturate((temp - uniforms.minTemp) / (uniforms.maxTemp - uniforms.minTemp));
  let crustFactor = 1.0 - crust;

  return tempFactor * crustFactor * uniforms.emissiveStrength;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Early discard for no lava
  if (input.depth < 0.01) {
    discard;
  }

  var color: vec3<f32>;
  var emissive = 0.0;

  switch (uniforms.debugMode) {
    case 1u: {
      // Temperature visualization
      let normalizedTemp = saturate(
        (input.temperature - uniforms.minTemp) / (uniforms.maxTemp - uniforms.minTemp)
      );
      color = vec3<f32>(normalizedTemp, 0.0, 1.0 - normalizedTemp);
    }
    case 2u: {
      // Crust visualization
      color = vec3<f32>(input.crust, input.crust * 0.5, 0.0);
    }
    case 3u: {
      // Flow visualization
      let flowMag = length(input.flow);
      let flowAngle = atan2(input.flow.y, input.flow.x);
      let hue = (flowAngle + 3.14159) / (2.0 * 3.14159);

      // Simple HSV to RGB
      let c = saturate(flowMag * 10.0);
      let x = c * (1.0 - abs(((hue * 6.0) % 2.0) - 1.0));

      if (hue < 1.0/6.0) {
        color = vec3<f32>(c, x, 0.0);
      } else if (hue < 2.0/6.0) {
        color = vec3<f32>(x, c, 0.0);
      } else if (hue < 3.0/6.0) {
        color = vec3<f32>(0.0, c, x);
      } else if (hue < 4.0/6.0) {
        color = vec3<f32>(0.0, x, c);
      } else if (hue < 5.0/6.0) {
        color = vec3<f32>(x, 0.0, c);
      } else {
        color = vec3<f32>(c, 0.0, x);
      }
    }
    default: {
      // Normal lava rendering

      // Get base temperature color
      let baseColor = temperatureToColor(input.temperature);

      // Sample flow distortion
      let distortion = sampleFlowDistortion(input.uv, input.flow);

      // Apply crust darkening
      let crustDarkening = mix(0.2, 1.0, 1.0 - input.crust);

      // Cracks in the crust showing hot lava beneath
      let crackPattern = distortion.x * distortion.y;
      let crackThreshold = mix(0.3, 0.8, input.crust);
      let showCracks = step(crackThreshold, crackPattern) * input.crust;

      // Mix crust and hot lava
      color = baseColor * crustDarkening;
      if (showCracks > 0.5) {
        let hotColor = temperatureToColor(input.temperature * 1.2);
        color = mix(color, hotColor, showCracks);
      }

      // Add flow lines
      let flowLines = sin(distortion.z * 20.0 + uniforms.time * 2.0) * 0.5 + 0.5;
      color = mix(color, color * 1.2, flowLines * 0.3 * (1.0 - input.crust));

      // Calculate emissive glow
      emissive = calculateEmissive(input.temperature, input.crust);

      // Add bright spots for very hot areas
      let hotSpots = pow(distortion.x * distortion.y * distortion.z, 3.0);
      if (input.temperature > uniforms.maxTemp * 0.8 && input.crust < 0.3) {
        color = mix(color, vec3<f32>(1.0, 0.9, 0.7), hotSpots * 0.5);
        emissive = mix(emissive, 1.0, hotSpots * 0.5);
      }

      // Apply emissive glow
      color = color * (1.0 + emissive * 2.0);
    }
  }

  // Heat haze distortion (subtle)
  let heatDistortion = sin(input.worldPos.x * 0.1 + uniforms.time) *
                       sin(input.worldPos.z * 0.1 - uniforms.time) * 0.02;

  return vec4<f32>(color, 1.0);
}