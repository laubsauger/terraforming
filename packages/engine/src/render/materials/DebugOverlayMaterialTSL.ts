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
    // Show flow magnitude as color gradient (blue=flat, yellow=moderate, red=steep)
    // Flow velocity is in units/second, typical values 0-500
    const flowVec = vec2(overlayData.r, overlayData.g);
    const flowMag = length(flowVec).div(100); // Normalize to 0-5 range

    // Create gradient: blue (flat) -> green -> yellow -> red (steep)
    const lowColor = vec3(0, 0, 1);     // Blue for flat/slow
    const midColor = vec3(0, 1, 0);     // Green for moderate
    const highColor = vec3(1, 1, 0);    // Yellow for fast
    const maxColor = vec3(1, 0, 0);     // Red for very fast

    // Interpolate between colors based on flow magnitude
    const t1 = clamp(flowMag.mul(3), float(0), float(1));        // 0-0.33 -> 0-1
    const t2 = clamp(flowMag.sub(0.33).mul(3), float(0), float(1)); // 0.33-0.66 -> 0-1
    const t3 = clamp(flowMag.sub(0.66).mul(3), float(0), float(1)); // 0.66-1 -> 0-1

    const color = lowColor.mul(float(1).sub(t1))
      .add(midColor.mul(t1).mul(float(1).sub(t2)))
      .add(highColor.mul(t2).mul(float(1).sub(t3)))
      .add(maxColor.mul(t3));

    // Show color with opacity based on magnitude (always show some color even for flat areas)
    const minOpacity = float(0.3); // Always show at least 30% opacity
    const visOpacity = minOpacity.add(clamp(flowMag, float(0), float(1)).mul(float(1).sub(minOpacity)));
    material.colorNode = vec4(color, visOpacity.mul(opacity));
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