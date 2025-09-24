import * as THREE from 'three/webgpu';
import {
  vec3,
  float,
  mix,
  uv,
  vec2,
  vec4,
  time,
  texture,
  smoothstep,
  length,
  sin,
  cos,
  normalize,
  positionLocal,
  step,
  clamp,
  max
} from 'three/tsl';

export interface DynamicWaterMaterialOptions {
  waterDepthTexture: THREE.Texture;  // Water depth from simulation
  heightTexture: THREE.Texture;      // Terrain height for positioning
  heightScale?: number;               // Terrain height scale
  opacity?: number;
}

/**
 * Creates a water material for dynamic water (rivers/lakes) that can exist at any elevation
 * This renders water at the actual terrain height + water depth
 */
export function createDynamicWaterMaterialTSL(options: DynamicWaterMaterialOptions): THREE.MeshPhysicalNodeMaterial {
  const {
    waterDepthTexture,
    heightTexture,
    heightScale = 50,
    opacity = 0.85
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    roughness: 0.25,
    metalness: 0.0,
    transmission: 0.7,
    thickness: 1.5,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    depthWrite: false,
    depthTest: true,
    envMapIntensity: 1.2,
    specularIntensity: 0.8,
    sheen: 0.1,
  });

  // Sample textures
  const waterDepth = texture(waterDepthTexture, uv()).r;
  const terrainHeight = texture(heightTexture, uv()).r;

  // Check if there's water at this location
  const hasWater = step(float(0.001), waterDepth);

  // Animated UV for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.015), time.mul(0.008)));

  // Water colors for rivers/lakes
  const veryShallowColor = vec3(0.3, 0.85, 1.0);      // Crystal clear shallow
  const shallowWaterColor = vec3(0.15, 0.8, 0.95);    // Brilliant shallow turquoise
  const mediumWaterColor = vec3(0.0, 0.65, 0.85);     // Medium turquoise
  const deepWaterColor = vec3(0.0, 0.45, 0.75);       // Rich deep turquoise

  // Normalize depth for color mixing
  const normalizedDepth = smoothstep(float(0), float(0.5), waterDepth);

  // Mix colors based on water depth
  const color1 = mix(veryShallowColor, shallowWaterColor, smoothstep(float(0), float(0.05), waterDepth));
  const color2 = mix(color1, mediumWaterColor, smoothstep(float(0.05), float(0.2), waterDepth));
  const waterColor = mix(color2, deepWaterColor, smoothstep(float(0.2), float(0.5), waterDepth));

  // Add ripple effects
  const rippleFreq = length(uv().sub(vec2(0.5, 0.5))).mul(20).add(time.mul(4));
  const ripples = rippleFreq.sin().mul(0.04).mul(float(1).sub(normalizedDepth));
  const finalColor = waterColor.add(ripples);

  // Apply color and opacity (only visible where there's water)
  material.colorNode = finalColor;
  material.opacityNode = hasWater.mul(mix(float(0.7), float(opacity), smoothstep(float(0), float(0.1), waterDepth)));

  // IMPORTANT: Water mesh is a flat plane - we must REPLACE Y, not add to it
  // This ensures water follows the actual displaced terrain surface
  const terrainElevation = terrainHeight.mul(float(heightScale));
  const waterSurfaceHeight = waterDepth.mul(float(heightScale * 0.5)); // Scale water depth appropriately

  // Add small offset to avoid z-fighting with terrain
  const verticalOffset = hasWater.mul(float(0.1));

  // Simple wave displacement for performance
  const waveTime = time.mul(1.5);
  const simpleWave = sin(uv().x.mul(15).add(waveTime)).mul(0.01).mul(hasWater);

  // Final position: Use X,Z from plane, REPLACE Y with terrain + water
  const finalY = terrainElevation.add(waterSurfaceHeight).add(verticalOffset).add(simpleWave);
  const finalPosition = vec3(
    positionLocal.x,
    finalY,
    positionLocal.z
  );
  material.positionNode = finalPosition;

  // Simplified wave normals for performance
  // For Y-up coordinate system: Normal = (dx, 1, dz)
  const waveNormalX = sin(animatedUV.x.mul(8)).mul(0.2);
  const waveNormalZ = cos(animatedUV.y.mul(8)).mul(0.2);

  material.normalNode = normalize(vec3(waveNormalX, float(1), waveNormalZ));

  // Simple roughness for performance
  const baseRoughness = mix(float(0.35), float(0.25), normalizedDepth);
  material.roughnessNode = baseRoughness;

  return material;
}