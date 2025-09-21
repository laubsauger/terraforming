// Debug overlay shaders for visualizing simulation data
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Full screen quad
  let x = f32(vertexIndex & 1u) * 2.0 - 1.0;
  let y = f32((vertexIndex >> 1u) & 1u) * 2.0 - 1.0;

  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

  return output;
}

struct Uniforms {
  mode: u32,  // 0: height, 1: flow, 2: accumulation, 3: erosion, 4: temperature, 5: pools
  minValue: f32,
  maxValue: f32,
  opacity: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var heightTex: texture_2d<f32>;
@group(0) @binding(3) var flowTex: texture_2d<f32>;
@group(0) @binding(4) var accumulationTex: texture_2d<f32>;
@group(0) @binding(5) var erosionTex: texture_2d<f32>;
@group(0) @binding(6) var temperatureTex: texture_2d<f32>;
@group(0) @binding(7) var poolsTex: texture_2d<f32>;

// Color ramp functions for different data types
fn heightToColor(h: f32) -> vec3<f32> {
  // Topographic color scheme
  let normalizedH = saturate((h - uniforms.minValue) / (uniforms.maxValue - uniforms.minValue));

  if (normalizedH < 0.2) {
    // Deep water to shallow: dark blue to cyan
    return mix(vec3<f32>(0.0, 0.1, 0.4), vec3<f32>(0.0, 0.5, 0.8), normalizedH * 5.0);
  } else if (normalizedH < 0.4) {
    // Beach: cyan to sandy yellow
    return mix(vec3<f32>(0.0, 0.5, 0.8), vec3<f32>(0.9, 0.8, 0.5), (normalizedH - 0.2) * 5.0);
  } else if (normalizedH < 0.7) {
    // Lowlands to highlands: green gradient
    return mix(vec3<f32>(0.2, 0.6, 0.1), vec3<f32>(0.4, 0.4, 0.2), (normalizedH - 0.4) * 3.33);
  } else if (normalizedH < 0.9) {
    // Mountains: brown to gray
    return mix(vec3<f32>(0.4, 0.3, 0.2), vec3<f32>(0.6, 0.6, 0.6), (normalizedH - 0.7) * 5.0);
  } else {
    // Peaks: gray to white
    return mix(vec3<f32>(0.6, 0.6, 0.6), vec3<f32>(1.0, 1.0, 1.0), (normalizedH - 0.9) * 10.0);
  }
}

fn flowToColor(flow: vec2<f32>) -> vec3<f32> {
  // Velocity magnitude and direction visualization
  let magnitude = length(flow);
  let normalizedMag = saturate(magnitude / uniforms.maxValue);

  // HSV to RGB conversion for direction
  let angle = atan2(flow.y, flow.x);
  let hue = (angle + 3.14159) / (2.0 * 3.14159);

  // Simple HSV to RGB
  let c = normalizedMag;
  let x = c * (1.0 - abs(((hue * 6.0) % 2.0) - 1.0));
  let m = 1.0 - c;

  var rgb: vec3<f32>;
  let h6 = hue * 6.0;
  if (h6 < 1.0) {
    rgb = vec3<f32>(c, x, 0.0);
  } else if (h6 < 2.0) {
    rgb = vec3<f32>(x, c, 0.0);
  } else if (h6 < 3.0) {
    rgb = vec3<f32>(0.0, c, x);
  } else if (h6 < 4.0) {
    rgb = vec3<f32>(0.0, x, c);
  } else if (h6 < 5.0) {
    rgb = vec3<f32>(x, 0.0, c);
  } else {
    rgb = vec3<f32>(c, 0.0, x);
  }

  return rgb + vec3<f32>(m, m, m);
}

fn accumulationToColor(acc: f32) -> vec3<f32> {
  // Water accumulation: blue gradient with logarithmic scale
  let logAcc = log2(acc + 1.0);
  let normalized = saturate(logAcc / uniforms.maxValue);

  // White to deep blue for water paths
  if (normalized < 0.1) {
    return vec3<f32>(0.95, 0.95, 0.95); // Dry areas
  } else {
    return mix(
      vec3<f32>(0.7, 0.85, 1.0),  // Light blue for small streams
      vec3<f32>(0.0, 0.2, 0.8),   // Deep blue for rivers
      pow(normalized, 0.5)
    );
  }
}

fn erosionToColor(erosion: f32) -> vec3<f32> {
  // Erosion/deposition: red for erosion, green for deposition
  let normalized = erosion / uniforms.maxValue;

  if (normalized < -0.01) {
    // Deposition: shades of green
    return vec3<f32>(0.0, -normalized * 2.0, 0.0);
  } else if (normalized > 0.01) {
    // Erosion: shades of red
    return vec3<f32>(normalized * 2.0, 0.0, 0.0);
  } else {
    // Neutral: gray
    return vec3<f32>(0.5, 0.5, 0.5);
  }
}

fn temperatureToColor(temp: f32) -> vec3<f32> {
  // Temperature for lava: black to red to yellow to white
  let normalized = saturate((temp - uniforms.minValue) / (uniforms.maxValue - uniforms.minValue));

  if (normalized < 0.25) {
    // Black to dark red
    return mix(vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(0.5, 0.0, 0.0), normalized * 4.0);
  } else if (normalized < 0.5) {
    // Dark red to bright red
    return mix(vec3<f32>(0.5, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), (normalized - 0.25) * 4.0);
  } else if (normalized < 0.75) {
    // Red to orange/yellow
    return mix(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 0.8, 0.0), (normalized - 0.5) * 4.0);
  } else {
    // Yellow to white hot
    return mix(vec3<f32>(1.0, 0.8, 0.0), vec3<f32>(1.0, 1.0, 1.0), (normalized - 0.75) * 4.0);
  }
}

fn poolsToColor(pool: f32) -> vec3<f32> {
  // Pool detection: blue tint for pooled areas
  if (pool > 0.5) {
    return vec3<f32>(0.2, 0.4, 0.8); // Pooled water
  } else {
    return vec3<f32>(0.9, 0.9, 0.9); // No pooling
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  var color: vec3<f32>;

  switch (uniforms.mode) {
    case 0u: {
      // Height visualization
      let height = textureSample(heightTex, linearSampler, input.uv).r;
      color = heightToColor(height);
    }
    case 1u: {
      // Flow visualization
      let flow = textureSample(flowTex, linearSampler, input.uv).xy;
      color = flowToColor(flow);
    }
    case 2u: {
      // Accumulation visualization
      let acc = textureSample(accumulationTex, linearSampler, input.uv).r;
      color = accumulationToColor(acc);
    }
    case 3u: {
      // Erosion visualization
      let erosion = textureSample(erosionTex, linearSampler, input.uv).r;
      color = erosionToColor(erosion);
    }
    case 4u: {
      // Temperature visualization
      let temp = textureSample(temperatureTex, linearSampler, input.uv).r;
      color = temperatureToColor(temp);
    }
    case 5u: {
      // Pools visualization
      let pool = textureSample(poolsTex, linearSampler, input.uv).r;
      color = poolsToColor(pool);
    }
    default: {
      color = vec3<f32>(1.0, 0.0, 1.0); // Magenta for invalid mode
    }
  }

  return vec4<f32>(color, uniforms.opacity);
}