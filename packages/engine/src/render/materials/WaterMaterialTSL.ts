import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, texture, max, clamp } from 'three/tsl';

export interface WaterMaterialTSLOptions {
  color?: THREE.Color;
  opacity?: number;
  depthTexture?: THREE.Texture; // For dynamic water depth (rivers/lakes)
  heightTexture?: THREE.Texture; // For terrain height (ocean depth calculation)
  waterLevel?: number; // Normalized water level (0-1) for ocean
}

/**
 * Creates a realistic water material using TSL with depth-based coloring
 */
export function createWaterMaterialTSL(options: WaterMaterialTSLOptions = {}): THREE.MeshPhysicalNodeMaterial {
  const {
    opacity = 0.85,
    depthTexture,
    heightTexture,
    waterLevel = 0.14
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    roughness: 0.1,
    metalness: 0.0,
    transmission: 0.95, // High transmission for realistic water
    thickness: 0.5,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
  });

  // Animated UV for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.02), time.mul(0.01)));

  // Water colors for different depths
  const deepWaterColor = vec3(0.004, 0.16, 0.32);    // Very deep ocean blue
  const mediumWaterColor = vec3(0.01, 0.35, 0.55);   // Medium depth blue
  const shallowWaterColor = vec3(0.02, 0.5, 0.65);   // Shallow water
  const veryShallowColor = vec3(0.15, 0.65, 0.75);   // Very shallow/beach water
  const foamColor = vec3(0.9, 0.95, 1.0);             // Foam/white caps

  // Calculate water depth and create depth-based color
  let waterColorNode;
  let opacityNode: any = float(opacity);

  if (heightTexture && waterLevel !== undefined) {
    // For ocean: calculate depth from terrain height
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);
    const normalizedDepth = clamp(waterDepth.mul(6), float(0), float(1)); // Scale depth for better gradients

    // Create smooth depth-based color transitions
    const veryShallowMix = mix(foamColor, veryShallowColor, clamp(normalizedDepth.mul(10), float(0), float(1)));
    const shallowMix = mix(veryShallowMix, shallowWaterColor, clamp(normalizedDepth.sub(0.05).mul(5), float(0), float(1)));
    const mediumMix = mix(shallowMix, mediumWaterColor, clamp(normalizedDepth.sub(0.2).mul(2), float(0), float(1)));
    waterColorNode = mix(mediumMix, deepWaterColor, clamp(normalizedDepth.sub(0.5).mul(2), float(0), float(1)));

    // Vary opacity based on depth - shallower water is more transparent
    const depthOpacity = mix(float(0.3), float(opacity), normalizedDepth.pow(0.5));
    opacityNode = max(depthOpacity, float(0.3)); // Minimum opacity for visibility

    // Add subtle wave animation to color
    const waveAnimation = animatedUV.x.add(animatedUV.y).sin().mul(0.05).add(0.95);
    waterColorNode = waterColorNode.mul(waveAnimation);

  } else if (depthTexture) {
    // For dynamic water (rivers/lakes): use provided depth texture
    const depth = texture(depthTexture, uv()).r;
    const normalizedDepth = clamp(depth, float(0), float(1));

    // Mix colors based on water depth
    const shallowMix = mix(veryShallowColor, shallowWaterColor, normalizedDepth.pow(0.5));
    waterColorNode = mix(shallowMix, mediumWaterColor, normalizedDepth.pow(0.3));

    // Vary opacity based on depth
    opacityNode = mix(float(0.2), float(opacity), normalizedDepth);

  } else {
    // Fallback: simple animated color
    const flowVariation = animatedUV.x.add(animatedUV.y).sin().mul(0.2).add(0.8);
    waterColorNode = mix(shallowWaterColor, mediumWaterColor, flowVariation);
  }

  // Apply water color and opacity
  material.colorNode = waterColorNode;
  material.opacityNode = opacityNode;

  // Add some roughness variation for wave surfaces
  const roughnessVariation = animatedUV.x.sin().mul(animatedUV.y.cos()).mul(0.05).add(0.1);
  material.roughnessNode = roughnessVariation;

  return material;
}