import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, texture, smoothstep, length, abs } from 'three/tsl';

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
    opacity = 0.92,
    depthTexture,
    heightTexture,
    waterLevel = 0.14
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    roughness: 0.0,
    metalness: 0.0,
    transmission: 0.98, // Very high transmission for water
    thickness: 1.0,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    depthWrite: false, // Allow transparency to work properly
    depthTest: true,
  });

  // Animated UV for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.015), time.mul(0.008)));

  // Water colors - Lighter, more vibrant gradient
  const deepWaterColor = vec3(0.05, 0.20, 0.35);      // Lighter deep ocean blue
  const mediumDeepColor = vec3(0.08, 0.35, 0.50);     // Medium-deep water
  const mediumWaterColor = vec3(0.15, 0.50, 0.65);    // Medium depth blue
  const shallowWaterColor = vec3(0.25, 0.65, 0.75);   // Turquoise shallow water
  const veryShallowColor = vec3(0.35, 0.80, 0.85);    // Light turquoise near shore
  const foamColor = vec3(0.95, 0.98, 1.0);            // White foam at shore

  // Calculate water depth and create depth-based color
  let waterColorNode;
  let opacityNode: any = float(opacity);

  if (heightTexture && waterLevel !== undefined) {
    // For ocean: calculate depth from terrain height
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);

    // Check if we're above water
    const isAboveWater = terrainHeight.greaterThan(float(waterLevel - 0.001)); // Small threshold

    // Normalize depth with better scaling for visual appeal
    const normalizedDepth = smoothstep(float(0), float(0.08), waterDepth); // Smooth transition over 8% height range

    // Distance from center for additional color variation
    const uvCentered = uv().sub(vec2(0.5, 0.5));
    const distFromCenter = length(uvCentered).mul(2); // 0 at center, 1 at edges

    // Create more pronounced depth-based color transitions
    // Use both depth and distance for more realistic ocean coloring
    const foam = mix(foamColor, veryShallowColor, smoothstep(float(0), float(0.001), waterDepth));
    const veryShallow = mix(foam, veryShallowColor, smoothstep(float(0.001), float(0.005), waterDepth));
    const shallow = mix(veryShallow, shallowWaterColor, smoothstep(float(0.005), float(0.02), waterDepth));
    const mediumShallow = mix(shallow, mediumWaterColor, smoothstep(float(0.02), float(0.05), waterDepth));
    const medium = mix(mediumShallow, mediumDeepColor, smoothstep(float(0.05), float(0.08), waterDepth));
    const deep = mix(medium, deepWaterColor, smoothstep(float(0.08), float(0.15), waterDepth));

    // Add distance-based darkening - more aggressive for open ocean effect
    // Combine depth and distance for realistic deep ocean appearance
    const distanceFactor = smoothstep(float(0.2), float(0.8), distFromCenter);
    const depthDistanceColor = mix(deep, deepWaterColor, distanceFactor.mul(0.6));

    // Also darken based on terrain slope for more variation
    const terrainSlope = abs(texture(heightTexture, uv().add(vec2(0.01, 0))).r.sub(terrainHeight)).mul(50);
    const slopeColor = mix(depthDistanceColor, depthDistanceColor.mul(0.8), terrainSlope);

    waterColorNode = slopeColor;

    // Smooth opacity transition at shore
    const shoreDistance = waterDepth.mul(50); // Scale up for smoother transition
    const shoreOpacity = smoothstep(float(0), float(1), shoreDistance);

    // Combine shore opacity with depth opacity
    const depthOpacity = mix(float(0.4), float(opacity), normalizedDepth);
    const finalOpacity = shoreOpacity.mul(depthOpacity);

    // Make areas above water completely transparent with smooth transition
    opacityNode = mix(finalOpacity, float(0), isAboveWater);

    // Add subtle wave animation to color
    const waveAnimation = animatedUV.x.add(animatedUV.y).sin().mul(0.03).add(0.97);
    waterColorNode = waterColorNode.mul(waveAnimation);

    // Add subtle ripples near shore
    const rippleFactor = float(1).sub(normalizedDepth).pow(2);
    const ripples = time.mul(3).add(length(uvCentered).mul(10)).sin().mul(0.02).mul(rippleFactor);
    waterColorNode = waterColorNode.add(ripples);

  } else if (depthTexture) {
    // For dynamic water (rivers/lakes): use provided depth texture
    const depth = texture(depthTexture, uv()).r;
    const normalizedDepth = smoothstep(float(0), float(1), depth);

    // Mix colors based on water depth (shallow to deep)
    const shallowMix = mix(veryShallowColor, shallowWaterColor, normalizedDepth.pow(0.5));
    waterColorNode = mix(shallowMix, mediumWaterColor, normalizedDepth.pow(0.3));

    // Vary opacity based on depth with smooth transitions
    opacityNode = mix(float(0.3), float(opacity), smoothstep(float(0), float(0.1), depth));

  } else {
    // Fallback: simple animated color
    const flowVariation = animatedUV.x.add(animatedUV.y).sin().mul(0.2).add(0.8);
    waterColorNode = mix(shallowWaterColor, mediumWaterColor, flowVariation);
  }

  // Apply water color and opacity
  material.colorNode = waterColorNode;
  material.opacityNode = opacityNode;

  // Add subtle roughness variation for more realistic water surface
  const roughnessVariation = animatedUV.x.sin().mul(animatedUV.y.cos()).mul(0.02).add(0.0);
  material.roughnessNode = roughnessVariation;

  return material;
}