import {
  texture,
  uv,
  float,
  vec2,
  vec3,
  vec4,
  positionWorld,
  normalWorld,
  cameraPosition,
  uniform,
  mix,
  saturate,
  pow,
  max,
  sin,
  step,
  Fn,
  If,
  triplanarTexture,
} from 'three/tsl';
import {
  MeshStandardNodeMaterial
} from 'three/webgpu'
import type { Texture } from 'three';

export interface LavaMaterialOptions {
  lavaDepthMap: Texture;
  temperatureMap: Texture;
  crustMap?: Texture;
  flowMap?: Texture;
  noiseTexture?: Texture;
  debugMode?: number;
}

export function createLavaMaterial(options: LavaMaterialOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();

  // Uniforms
  const debugMode = uniform(options.debugMode || 0);
  const timeUniform = uniform(0.0);
  const minTemp = uniform(500.0);
  const maxTemp = uniform(2000.0);
  const emissiveStrength = uniform(2.0);

  // Textures
  const depthTex = texture(options.lavaDepthMap);
  const tempTex = texture(options.temperatureMap);
  const crustTex = options.crustMap ? texture(options.crustMap) : null;
  const flowTex = options.flowMap ? texture(options.flowMap) : null;
  const noiseTex = options.noiseTexture ? texture(options.noiseTexture) : null;

  // Temperature to color mapping
  const temperatureColor = Fn(([temp]: any) => {
    const normalized = saturate(temp.sub(minTemp).div(maxTemp.sub(minTemp)));

    return If(normalized.lessThan(0.2), () => {
      // Cool crust: black to dark red
      return mix(
        vec3(0.05, 0.02, 0.01),
        vec3(0.3, 0.05, 0.02),
        normalized.mul(5.0)
      );
    }).ElseIf(normalized.lessThan(0.4), () => {
      // Warming: dark red to red
      return mix(
        vec3(0.3, 0.05, 0.02),
        vec3(0.8, 0.1, 0.05),
        normalized.sub(0.2).mul(5.0)
      );
    }).ElseIf(normalized.lessThan(0.7), () => {
      // Hot: red to orange
      return mix(
        vec3(0.8, 0.1, 0.05),
        vec3(1.0, 0.5, 0.1),
        normalized.sub(0.4).mul(3.33)
      );
    }).ElseIf(normalized.lessThan(0.9), () => {
      // Very hot: orange to yellow-orange
      return mix(
        vec3(1.0, 0.5, 0.1),
        vec3(1.0, 0.8, 0.3),
        normalized.sub(0.7).mul(5.0)
      );
    }).Else(() => {
      // Extreme: yellow-white
      return mix(
        vec3(1.0, 0.8, 0.3),
        vec3(1.0, 1.0, 0.8),
        normalized.sub(0.9).mul(10.0)
      );
    });
  });

  // Flow distortion for organic movement
  const flowDistortion = Fn(() => {
    if (!flowTex || !noiseTex) return float(0.0);

    const flow = flowTex.rg;
    const flowSpeed = flow.length();
    const flowDir = flow.normalize();

    // Animated noise sampling
    const uv1 = uv().mul(5.0).add(flowDir.mul(timeUniform.mul(0.05)));
    const uv2 = uv().mul(3.0).sub(flowDir.mul(timeUniform.mul(0.03)));

    const noise1 = texture(options.noiseTexture!, uv1).r;
    const noise2 = texture(options.noiseTexture!, uv2).r;

    return noise1.mul(noise2).mul(flowSpeed.mul(2.0));
  })();

  // Lava surface appearance
  const lavaColor = Fn(() => {
    const temp = tempTex.r;
    const depth = depthTex.r;
    const crust = crustTex ? crustTex.r : float(0.0);

    // Base temperature color
    const baseColor = temperatureColor(temp);

    // Crust darkening
    const crustDarkening = mix(float(0.2), float(1.0), float(1.0).sub(crust));

    // Cracks in the crust
    if (noiseTex) {
      const crackPattern = flowDistortion;
      const crackThreshold = mix(float(0.3), float(0.8), crust);
      const showCracks = step(crackThreshold, crackPattern).mul(crust);

      // Hot lava showing through cracks
      const hotColor = temperatureColor(temp.mul(1.2));
      const crackedColor = mix(baseColor.mul(crustDarkening), hotColor, showCracks);

      // Add flow lines
      const flowLines = sin(crackPattern.mul(20.0).add(timeUniform.mul(2.0))).mul(0.5).add(0.5);
      const withFlowLines = mix(
        crackedColor,
        crackedColor.mul(1.2),
        flowLines.mul(0.3).mul(float(1.0).sub(crust))
      );

      return withFlowLines;
    }

    return baseColor.mul(crustDarkening);
  })();

  // Calculate emissive glow
  const emissiveGlow = Fn(() => {
    const temp = tempTex.r;
    const crust = crustTex ? crustTex.r : float(0.0);

    const tempFactor = saturate(temp.sub(minTemp).div(maxTemp.sub(minTemp)));
    const crustFactor = float(1.0).sub(crust);

    return tempFactor.mul(crustFactor).mul(emissiveStrength);
  })();

  // Debug visualizations
  const debugColor = Fn(() => {
    const mode = debugMode;

    return If(mode.equal(1), () => {
      // Temperature visualization
      const temp = tempTex.r;
      const normalized = saturate(temp.sub(minTemp).div(maxTemp.sub(minTemp)));
      return vec3(normalized, float(0.0), float(1.0).sub(normalized));
    }).ElseIf(mode.equal(2), () => {
      // Crust visualization
      if (crustTex) {
        const crust = crustTex.r;
        return vec3(crust, crust.mul(0.5), float(0.0));
      }
      return vec3(1.0, 0.0, 1.0);
    }).ElseIf(mode.equal(3), () => {
      // Flow visualization
      if (flowTex) {
        const flow = flowTex.rg;
        const flowMag = flow.length();
        return vec3(flowMag.mul(5.0), float(0.0), float(1.0).sub(flowMag.mul(5.0)));
      }
      return vec3(1.0, 0.0, 1.0);
    }).Else(() => {
      return lavaColor;
    });
  })();

  // Set material properties
  material.colorNode = debugMode.greaterThan(0).select(debugColor, lavaColor);

  // Emissive for glow effect
  material.emissiveNode = lavaColor.mul(emissiveGlow);
  material.emissiveIntensity = 1.0;

  // Surface properties
  material.roughness = 0.9;
  material.metalness = 0.0;

  // Opacity based on depth (fully opaque)
  material.opacityNode = step(float(0.01), depthTex.r);
  material.transparent = false;

  // Update time uniform
  material.onBeforeRender = (_renderer, _scene, _camera) => {
    timeUniform.value = performance.now() / 1000;
  };

  return material;
}