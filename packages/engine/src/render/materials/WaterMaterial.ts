import {
  texture,
  uv,
  float,
  vec2,
  vec3,
  normalWorld,
  uniform,
  mix,
  saturate,
  Fn,
  If,
} from 'three/tsl';
import {
  MeshPhysicalNodeMaterial,
} from 'three/webgpu';
import type { Texture } from 'three';

export interface WaterMaterialOptions {
  waterDepthMap: Texture;
  flowMap?: Texture;
  normalMap1?: Texture;
  normalMap2?: Texture;
  foamTexture?: Texture;
  debugMode?: number;
}

export function createWaterMaterial(options: WaterMaterialOptions): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial();

  // Uniforms
  const debugMode = uniform(options.debugMode || 0);
  const timeUniform = uniform(0.0);
  const flowSpeed = uniform(0.1);

  // Textures
  const depthTex = texture(options.waterDepthMap);
  const flowTex = options.flowMap ? texture(options.flowMap) : null;
  const normalTex1 = options.normalMap1 ? texture(options.normalMap1) : null;
  const normalTex2 = options.normalMap2 ? texture(options.normalMap2) : null;
  const foamTex = options.foamTexture ? texture(options.foamTexture) : null;

  // Flow-based UV animation
  const flowUV = Fn(() => {
    if (!flowTex) return uv();

    const flow = flowTex.rg;
    const phase = timeUniform.mul(flowSpeed).fract();

    // Dual-phase flow mapping for seamless animation
    const phase1 = phase;
    const phase2 = phase.add(0.5).fract();

    const uv1 = uv().add(flow.mul(phase1));
    const uv2 = uv().add(flow.mul(phase2));

    const blend = phase.sub(0.5).abs().mul(2.0);

    return mix(uv1, uv2, blend);
  })();

  // Calculate foam
  const foamFactor = Fn(() => {
    if (!flowTex || !foamTex) return float(0.0);

    const flow = flowTex.rg;
    const depth = depthTex.r;

    // Calculate flow divergence
    const flowL = texture(options.flowMap!, uv().add(vec2(-0.01, 0))).rg;
    const flowR = texture(options.flowMap!, uv().add(vec2(0.01, 0))).rg;
    const flowU = texture(options.flowMap!, uv().add(vec2(0, 0.01))).rg;
    const flowD = texture(options.flowMap!, uv().add(vec2(0, -0.01))).rg;

    const divergence = flowR.x.sub(flowL.x).add(flowU.y.sub(flowD.y)).mul(50.0);
    const curl = flowR.y.sub(flowL.y).sub(flowU.x.sub(flowD.x)).abs().mul(25.0);

    // Shallow water foam
    const shallowFoam = saturate(float(1.0).sub(depth.mul(0.5)));

    // Turbulence foam
    const turbulenceFoam = saturate(divergence.mul(-1).add(curl));

    // Sample foam texture
    const foamPattern = texture(options.foamTexture!, flowUV.mul(10.0)).r;

    return saturate(shallowFoam.add(turbulenceFoam).mul(foamPattern));
  })();

  // Water color based on depth
  const waterColor = Fn(() => {
    const depth = depthTex.r;

    const shallowColor = vec3(0.1, 0.5, 0.6);
    const deepColor = vec3(0.0, 0.2, 0.4);

    const depthFactor = saturate(depth.div(3.0));

    return mix(shallowColor, deepColor, depthFactor);
  })();

  // Flow-animated normal mapping
  const flowNormal = Fn(() => {
    if (!normalTex1 || !normalTex2) return normalWorld;

    const phase = timeUniform.mul(flowSpeed).fract();

    const normal1 = texture(options.normalMap1!, flowUV);
    const normal2 = texture(options.normalMap2!, flowUV.add(vec2(0.5)));

    const blend = phase.sub(0.5).abs().mul(2.0);
    const blendedNormal = mix(normal1, normal2, blend);

    return blendedNormal.xyz.mul(2.0).sub(1.0).normalize();
  })();

  // Debug visualizations
  const debugColor = Fn(() => {
    const mode = debugMode;

    return If(mode.equal(1), () => {
      // Flow vectors
      if (flowTex) {
        const flow = flowTex.rg;
        const flowMag = flow.length();
        const flowAngle = flow.y.atan2(flow.x);

        // HSV to RGB for direction
        const h = flowAngle.add(3.14159).div(6.28318);
        const s = saturate(flowMag.mul(10.0));

        return vec3(h, s, 1.0); // Simplified HSV representation
      }
      return vec3(1.0, 0.0, 1.0);
    }).ElseIf(mode.equal(2), () => {
      // Depth visualization
      const depth = depthTex.r;
      const depthNorm = saturate(depth.div(5.0));
      return vec3(0.0, depthNorm, depthNorm.mul(0.5));
    }).ElseIf(mode.equal(3), () => {
      // Foam visualization
      return vec3(foamFactor);
    }).Else(() => {
      // Normal rendering
      const color = waterColor;

      // Add foam
      const foamColor = vec3(0.95, 0.95, 0.95);
      const withFoam = mix(color, foamColor, foamFactor.mul(0.8));

      return withFoam;
    });
  })();

  // Set material properties
  material.colorNode = debugMode.greaterThan(0).select(debugColor, waterColor);

  // Water-specific properties
  material.transmission = 0.9;
  material.thickness = 1.0;
  material.roughness = 0.0;
  material.metalness = 0.0;
  material.ior = 1.33; // Water index of refraction

  // Add foam to emissive for brightness
  material.emissiveNode = vec3(1.0, 1.0, 1.0).mul(foamFactor.mul(0.2));

  // Animated normals
  if (normalTex1 && normalTex2) {
    material.normalNode = flowNormal;
  }

  // Opacity based on depth
  material.opacityNode = saturate(depthTex.r.mul(2.0).add(0.3));
  material.transparent = true;
  material.side = 2; // DoubleSide

  // Update time uniform
  material.onBeforeRender = (_renderer, _scene, _camera) => {
    timeUniform.value = performance.now() / 1000;
  };

  return material;
}