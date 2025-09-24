import * as THREE from 'three/webgpu';
import {
  vec3,
  vec4,
  float,
  uv,
  texture,
  positionLocal,
  normalize,
  length,
  max,
  min,
  abs
} from 'three/tsl';

export interface FlowFieldDebugMaterialOptions {
  flowTexture: THREE.Texture;
  heightTexture: THREE.Texture;
  heightScale?: number;
}

/**
 * Debug material to visualize the flow field vectors
 * Shows flow direction as color and magnitude as brightness
 */
export function createFlowFieldDebugMaterialTSL(options: FlowFieldDebugMaterialOptions): THREE.MeshBasicNodeMaterial {
  const {
    flowTexture,
    heightTexture,
    heightScale = 50
  } = options;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });

  // Sample textures
  const flowVec = texture(flowTexture, uv()).rg;  // RG channels contain flow velocity
  const terrainHeight = texture(heightTexture, uv()).r;

  // Calculate flow magnitude and direction
  const flowMagnitude = length(flowVec);

  // AMPLIFY small values for visualization
  const amplifiedFlow = flowVec.mul(float(100.0));  // Amplify by 100x
  const amplifiedMag = length(amplifiedFlow);

  // Normalize for direction visualization
  const flowDir = amplifiedFlow.div(max(amplifiedMag, float(0.001)));

  // Map flow direction to color with better contrast
  // Red = rightward flow, Green = downward flow (in texture space)
  // Make it more dramatic: full red/green for any flow
  const flowColor = vec3(
    max(float(0), flowDir.x),  // Red for rightward flow
    max(float(0), flowDir.y),  // Green for downward flow
    min(amplifiedMag.mul(float(0.1)), float(1.0))  // Blue shows magnitude
  );

  // Alternative: Show slope steepness as grayscale
  const slopeColor = vec3(amplifiedMag.mul(float(0.5)));

  material.colorNode = flowColor;

  // Set opacity based on flow magnitude - always show some opacity
  const baseOpacity = float(0.3);
  const flowOpacity = min(flowMagnitude.mul(float(0.1)), float(0.5));
  material.opacityNode = baseOpacity.add(flowOpacity);  // 30% to 80% opacity

  // Position the mesh on terrain surface with small offset
  const terrainElevation = terrainHeight.mul(float(heightScale));
  const debugOffset = float(0.1);  // Small offset to avoid z-fighting

  const finalPosition = vec3(
    positionLocal.x,
    terrainElevation.add(debugOffset),
    positionLocal.z
  );
  material.positionNode = finalPosition;

  return material;
}