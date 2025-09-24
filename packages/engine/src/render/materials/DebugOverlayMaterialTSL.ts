import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  texture,
  uv,
  float,
  vec2,
  vec3,
  vec4,
  clamp,
  abs,
  length,
  positionLocal
} from 'three/tsl';

export interface DebugOverlayMaterialOptions {
  overlayTexture: THREE.Texture;
  overlayType: 'flow' | 'accumulation' | 'pools' | 'waterDepth' | 'sediment' | 'temperature' | 'height';
  opacity?: number;
  heightTexture?: THREE.Texture; // For terrain displacement
  heightScale?: number;
}

/**
 * Create a debug overlay material for visualizing simulation data
 */
export function createDebugOverlayMaterialTSL(options: DebugOverlayMaterialOptions): THREE.MeshBasicNodeMaterial {
  const {
    overlayTexture,
    overlayType,
    opacity = 0.8,
    heightTexture,
    heightScale = 50
  } = options;

  // Sample the overlay texture
  const overlayUV = uv();
  const overlayData = texture(overlayTexture, overlayUV);

  // Simple visualization: just show the data with color coding
  const material = new MeshBasicNodeMaterial();

  if (overlayType === 'waterDepth') {
    // Blue gradient for water depth
    const depth = clamp(overlayData.r.mul(10), float(0), float(1));
    material.colorNode = vec4(vec3(0, 0.5, 1).mul(depth), depth.mul(opacity));
  } else if (overlayType === 'flow') {
    // Show flow as red/green
    const flowMag = length(vec2(overlayData.r, overlayData.g)).mul(100);
    material.colorNode = vec4(abs(overlayData.r).mul(10), abs(overlayData.g).mul(10), float(0), clamp(flowMag, float(0), float(1)).mul(opacity));
  } else {
    // Default: grayscale
    const value = clamp(overlayData.r.mul(10), float(0), float(1));
    material.colorNode = vec4(vec3(value), value.mul(opacity));
  }

  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  // Apply terrain displacement if height texture is provided
  if (heightTexture) {
    const height = texture(heightTexture, overlayUV).r;
    const terrainY = height.mul(float(heightScale));

    // Offset slightly above terrain to avoid z-fighting
    const offset = float(0.5);

    // REPLACE Y coordinate with terrain height, don't add to flat plane
    material.positionNode = vec3(
      positionLocal.x,
      terrainY.add(offset),
      positionLocal.z
    );
  }

  return material;
}