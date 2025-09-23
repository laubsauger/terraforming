import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  texture,
  uv,
  float,
  vec2,
  vec3,
  vec4,
  smoothstep,
  clamp,
  mix,
  abs,
  max,
  pow,
  normalize,
  length,
  step
} from 'three/tsl';

export interface DebugOverlayMaterialOptions {
  overlayTexture: THREE.Texture;
  overlayType: 'flow' | 'accumulation' | 'pools' | 'waterDepth' | 'sediment' | 'temperature' | 'height';
  opacity?: number;
}

/**
 * Create a debug overlay material for visualizing simulation data
 */
export function createDebugOverlayMaterialTSL(options: DebugOverlayMaterialOptions): THREE.MeshBasicNodeMaterial {
  const {
    overlayTexture,
    overlayType,
    opacity = 0.8
  } = options;

  // Sample the overlay texture
  const overlayUV = uv();
  const overlayData = texture(overlayTexture, overlayUV);

  // Create color based on overlay type
  let overlayColor;
  let overlayAlpha = float(opacity);

  switch (overlayType) {
    case 'flow':
      // Flow field visualization: direction as hue, magnitude as brightness
      const flowVelocity = vec2(overlayData.r, overlayData.g);
      const flowMagnitude = length(flowVelocity);
      const flowDirection = normalize(flowVelocity);

      // Convert direction to hue (0-1)
      const angle = flowDirection.x.mul(0.5).add(0.5); // Simple mapping, could be improved

      // Create HSV to RGB color
      const hue = angle.mul(6.0);
      const c = flowMagnitude;
      const x = c.mul(float(1).sub(abs(hue.mod(2).sub(1))));

      overlayColor = mix(
        vec3(0.1, 0.1, 0.3), // Dark blue for no flow
        vec3(c, x, 0),       // Flow color
        step(float(0.001), flowMagnitude)
      );
      overlayAlpha = overlayAlpha.mul(smoothstep(float(0), float(0.1), flowMagnitude));
      break;

    case 'accumulation':
      // Flow accumulation: blue to yellow gradient
      const accumulation = overlayData.r;
      const accNormalized = clamp(pow(accumulation.mul(10), float(0.5)), float(0), float(1));
      overlayColor = mix(
        vec3(0.0, 0.2, 0.8),  // Deep blue for low accumulation
        vec3(1.0, 0.9, 0.2),  // Yellow for high accumulation
        accNormalized
      );
      overlayAlpha = overlayAlpha.mul(smoothstep(float(0), float(0.01), accumulation));
      break;

    case 'pools':
      // Pool detection: cyan for detected pools
      const poolMask = overlayData.r;
      overlayColor = vec3(0.0, 0.8, 1.0); // Cyan
      overlayAlpha = overlayAlpha.mul(poolMask);
      break;

    case 'waterDepth':
      // Water depth: blue gradient
      const waterDepth = overlayData.r;
      const depthNormalized = clamp(waterDepth.mul(20), float(0), float(1));
      overlayColor = mix(
        vec3(0.4, 0.6, 1.0),  // Light blue for shallow
        vec3(0.0, 0.2, 0.6),  // Dark blue for deep
        depthNormalized
      );
      overlayAlpha = overlayAlpha.mul(smoothstep(float(0), float(0.001), waterDepth));
      break;

    case 'sediment':
      // Sediment: brown gradient
      const sediment = overlayData.r;
      const sedNormalized = clamp(sediment.mul(50), float(0), float(1));
      overlayColor = mix(
        vec3(0.6, 0.4, 0.2),  // Light brown
        vec3(0.3, 0.2, 0.1),  // Dark brown
        sedNormalized
      );
      overlayAlpha = overlayAlpha.mul(smoothstep(float(0), float(0.001), sediment));
      break;

    case 'temperature':
      // Temperature: black to red to yellow to white
      const temp = overlayData.r;
      const tempNormalized = clamp(temp.div(1200), float(0), float(1)); // Assuming max 1200°C

      // Create temperature gradient
      const cold = vec3(0.0, 0.0, 0.3);    // Dark blue
      const warm = vec3(0.8, 0.2, 0.0);    // Red
      const hot = vec3(1.0, 0.8, 0.0);     // Yellow
      const veryHot = vec3(1.0, 1.0, 1.0); // White

      overlayColor = mix(
        mix(cold, warm, smoothstep(float(0), float(0.3), tempNormalized)),
        mix(hot, veryHot, smoothstep(float(0.6), float(1.0), tempNormalized)),
        step(float(0.3), tempNormalized)
      );
      overlayAlpha = overlayAlpha.mul(smoothstep(float(20), float(100), temp));
      break;

    case 'height':
      // Height: grayscale
      const height = overlayData.r;
      overlayColor = vec3(height);
      overlayAlpha = float(opacity);
      break;

    default:
      // Default: show raw data as grayscale
      overlayColor = vec3(overlayData.r);
      overlayAlpha = float(opacity);
  }

  // Create the material
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(overlayColor, overlayAlpha);
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.depthTest = true;

  return material;
}

/**
 * Create a combined debug overlay that can show multiple overlays
 */
export function createMultiDebugOverlayMaterialTSL(
  overlays: Array<{ texture: THREE.Texture; type: string; opacity: number }>
): THREE.MeshBasicNodeMaterial {
  // This would combine multiple overlays - for now just use the first one
  if (overlays.length === 0) {
    const material = new MeshBasicNodeMaterial();
    material.colorNode = vec4(0, 0, 0, 0);
    material.transparent = true;
    return material;
  }

  return createDebugOverlayMaterialTSL({
    overlayTexture: overlays[0].texture,
    overlayType: overlays[0].type as any,
    opacity: overlays[0].opacity
  });
}