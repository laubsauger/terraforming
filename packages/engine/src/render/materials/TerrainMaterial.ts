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
  triplanarTexture,
  Fn,
  If,
} from 'three/tsl';
import {
  MeshStandardNodeMaterial
} from 'three/webgpu'
import type { Texture } from 'three';

export interface TerrainMaterialOptions {
  heightMap: Texture;
  normalMap?: Texture;
  flowMap?: Texture;
  accumulationMap?: Texture;
  sedimentMap?: Texture;
  debugMode?: number;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();

  // Uniforms
  const debugMode = uniform(options.debugMode || 0);
  const heightScale = uniform(100.0);
  const timeUniform = uniform(0.0);

  // Textures
  const heightTex = texture(options.heightMap);
  const normalTex = options.normalMap ? texture(options.normalMap) : null;
  const flowTex = options.flowMap ? texture(options.flowMap) : null;
  const accumulationTex = options.accumulationMap ? texture(options.accumulationMap) : null;
  const sedimentTex = options.sedimentMap ? texture(options.sedimentMap) : null;

  // Sample height for vertex displacement
  const height = heightTex.r.mul(heightScale);

  // Vertex displacement
  material.positionNode = Fn(() => {
    const pos = positionWorld;
    return vec3(pos.x, height, pos.z);
  })();

  // Calculate terrain colors based on height and slope
  const terrainColor = Fn(() => {
    const pos = positionWorld;
    const normal = normalWorld;

    // Height-based colors
    const sandColor = vec3(0.9, 0.85, 0.7);
    const grassColor = vec3(0.3, 0.6, 0.2);
    const rockColor = vec3(0.5, 0.45, 0.4);
    const snowColor = vec3(0.95, 0.95, 1.0);

    const h = pos.y;

    // Beach zone
    const beachMask = saturate(float(1.0).sub(h.div(5.0))) as any;

    // Grass zone
    const grassMask = saturate(h.sub(5.0).div(45.0)).mul(
      saturate(float(1.0).sub(h.sub(50.0).div(50.0)))
    ) as any;

    // Rock zone
    const rockMask = saturate(h.sub(50.0).div(50.0)).mul(
      saturate(float(1.0).sub(h.sub(100.0).div(20.0)))
    ) as any;

    // Snow zone
    const snowMask = saturate(h.sub(100.0).div(20.0)) as any;

    // Blend colors
    let color = sandColor.mul(beachMask);
    color = color.add(grassColor.mul(grassMask));
    color = color.add(rockColor.mul(rockMask));
    color = color.add(snowColor.mul(snowMask));

    // Slope-based rock exposure
    const slope = float(1.0).sub(normal.y);
    const slopeMask = saturate(slope.sub(0.5).mul(2.0));
    color = mix(color, rockColor, slopeMask);

    // Water accumulation darkening
    if (accumulationTex) {
      const accumulation = accumulationTex.r;
      const wetness = saturate(accumulation.mul(10.0));
      color = mix(color, color.mul(0.7), wetness);
    }

    // Sediment overlay
    if (sedimentTex) {
      const sediment = sedimentTex.r;
      const mudColor = vec3(0.4, 0.3, 0.2);
      color = mix(color, mudColor, saturate(sediment.mul(2.0)));
    }

    return color;
  })();

  // Debug visualizations
  const debugColor = Fn(() => {
    const mode = debugMode;

    return If(mode.equal(1), () => {
      // Normal visualization
      return normalWorld.mul(0.5).add(0.5);
    }).ElseIf(mode.equal(2), () => {
      // Slope visualization
      const slope = float(1.0).sub(normalWorld.y);
      return vec3(slope, float(1.0).sub(slope), 0.0);
    }).ElseIf(mode.equal(3), () => {
      // Flow visualization
      if (flowTex) {
        const flow = flowTex.rg;
        const flowMag = flow.length();
        return vec3(flowMag.mul(5.0), 0.0, float(1.0).sub(flowMag.mul(5.0)));
      }
      return vec3(1.0, 0.0, 1.0);
    }).ElseIf(mode.equal(4), () => {
      // Accumulation visualization
      if (accumulationTex) {
        const acc = accumulationTex.r;
        const logAcc = acc.add(1.0).log2();
        return vec3(0.0, logAcc.mul(0.2), logAcc.mul(0.3));
      }
      return vec3(1.0, 0.0, 1.0);
    }).Else(() => {
      return terrainColor;
    });
  })();

  // Set material properties
  material.colorNode = debugMode.greaterThan(0).select(debugColor, terrainColor);
  material.roughness = 0.8;
  material.metalness = 0.0;

  // Normal mapping
  if (normalTex) {
    material.normalNode = normalTex.xyz;
  }

  // Update time uniform
  material.onBeforeRender = (_renderer, _scene, _camera) => {
    timeUniform.value = performance.now() / 1000;
  };

  return material;
}