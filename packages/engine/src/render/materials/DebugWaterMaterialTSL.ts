import * as THREE from 'three/webgpu';
import {
  vec3,
  float,
  mix,
  uv,
  texture,
  step,
  smoothstep,
  positionLocal,
  max
} from 'three/tsl';

export interface DebugWaterMaterialOptions {
  waterDepthTexture: THREE.Texture;
  heightTexture: THREE.Texture;
  flowTexture?: THREE.Texture;
  heightScale?: number;
}

/**
 * Debug water material - EXTREMELY VISIBLE for testing
 * Shows water as bright colored surface with no transparency
 */
export function createDebugWaterMaterialTSL(options: DebugWaterMaterialOptions): THREE.MeshBasicNodeMaterial {
  const {
    waterDepthTexture,
    heightTexture,
    flowTexture,
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

  // Show any water at all for debug - EXTREMELY LOW threshold
  const hasWater = step(float(0.000001), waterDepth); // Show even microscopic amounts

  // Color based on water depth - BRIGHT COLORS
  // Adjusted for extreme depths we're seeing (up to 1000m!)
  const veryShallowColor = vec3(1.0, 0.0, 0.0);    // Bright RED
  const shallowColor = vec3(1.0, 1.0, 0.0);        // Bright YELLOW
  const mediumColor = vec3(0.0, 1.0, 0.0);         // Bright GREEN
  const deepColor = vec3(0.0, 0.0, 1.0);           // Bright BLUE
  const veryDeepColor = vec3(1.0, 0.0, 1.0);       // Bright MAGENTA for extreme depths

  // Color transitions for VERY SMALL depths (millimeters to meters)
  const color1 = mix(veryShallowColor, shallowColor, smoothstep(float(0.001), float(0.01), waterDepth));
  const color2 = mix(color1, mediumColor, smoothstep(float(0.01), float(0.1), waterDepth));
  const color3 = mix(color2, deepColor, smoothstep(float(0.1), float(0.5), waterDepth));
  const waterColor = mix(color3, veryDeepColor, smoothstep(float(0.5), float(1.0), waterDepth));

  // Add flow visualization if available
  let finalColor = waterColor;
  if (flowTexture) {
    const flow = texture(flowTexture, uv());
    const flowMagnitude = flow.r.abs().add(flow.g.abs());
    // Add white where there's strong flow
    const flowColor = vec3(1.0, 1.0, 1.0).mul(flowMagnitude.mul(10));
    finalColor = mix(waterColor, vec3(1.0, 1.0, 1.0), flowMagnitude.clamp(0, 1));
  }

  // Make water VERY visible
  material.colorNode = finalColor;
  material.opacityNode = max(hasWater.mul(float(0.9)), float(0.0)); // High opacity where there's water

  // IMPORTANT: The water mesh is a flat plane at Y=0
  // We need to REPLACE the Y with the actual terrain height, not add to it
  const terrainElevation = terrainHeight.mul(float(heightScale));

  // MASSIVELY exaggerate small water depths for visibility
  const waterSurfaceHeight = waterDepth.mul(float(100.0)); // 100x exaggeration for tiny depths

  // Add significant offset to ensure it's above terrain and visible
  const debugOffset = hasWater.mul(float(5.0)); // 5 meter offset when there's water for visibility

  // Final position: Use X,Z from plane, but REPLACE Y with terrain height + water + offset
  // This ensures water follows the displaced terrain surface, not the flat plane
  const finalY = terrainElevation.add(waterSurfaceHeight).add(debugOffset);
  const finalPosition = vec3(
    positionLocal.x,
    finalY,
    positionLocal.z
  );
  material.positionNode = finalPosition;

  return material;
}