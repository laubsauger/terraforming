import * as THREE from 'three/webgpu';
import {
  vec3,
  float,
  uv,
  texture,
  positionLocal,
  mod,
  floor,
  step,
  mix,
  clamp,
  min
} from 'three/tsl';

export interface CheckerDebugMaterialOptions {
  waterDepthTexture: THREE.Texture;
  heightTexture: THREE.Texture;
  heightScale?: number;
}

/**
 * SUPER SIMPLE CHECKERED DEBUG MATERIAL
 * Shows pink and black checkerboard pattern wherever there's ANY water
 * No fancy effects, just maximum visibility
 */
export function createCheckerDebugMaterialTSL(options: CheckerDebugMaterialOptions): THREE.MeshBasicNodeMaterial {
  const {
    waterDepthTexture,
    heightTexture,
    heightScale = 50
  } = options;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true, // Need transparency to hide where no water
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });

  // Sample textures
  const waterDepth = texture(waterDepthTexture, uv()).r;
  const terrainHeight = texture(heightTexture, uv()).r;

  // Only show water where there's meaningful depth (above noise threshold)
  const hasWater = step(float(0.01), waterDepth);  // Show water > 0.01m (1cm)

  // DEBUG: Visualize water depth with better range (0 to 1m depth)
  const waterIntensity = clamp(waterDepth.mul(float(1.0)), float(0.0), float(1.0));

  // BRIGHT COLORS for debugging
  const brightYellow = vec3(1.0, 1.0, 0.0);  // Yellow where there's water
  const brightRed = vec3(1.0, 0.0, 0.0);     // Red for high water

  // Color based on water depth - yellow to red gradient
  const debugColor = mix(brightYellow, brightRed, waterIntensity);

  // Show bright color where there's water, nothing where there isn't
  material.colorNode = debugColor;
  material.opacityNode = hasWater.mul(float(0.9));  // 90% opacity where there's water

  // Position the mesh on terrain surface
  const terrainElevation = terrainHeight.mul(float(heightScale));

  // Water depth is how deep the water is, not its absolute height
  // Place mesh at terrain + water depth (clamped to reasonable values)
  const maxWaterHeight = float(5.0);  // Cap water height at 5 meters
  const clampedWaterDepth = min(waterDepth, maxWaterHeight);
  const debugOffset = float(0.01);  // Tiny offset to avoid z-fighting

  // Final position: terrain height + water depth
  const finalY = terrainElevation.add(clampedWaterDepth).add(debugOffset);
  const finalPosition = vec3(
    positionLocal.x,
    finalY,
    positionLocal.z
  );
  material.positionNode = finalPosition;

  return material;
}