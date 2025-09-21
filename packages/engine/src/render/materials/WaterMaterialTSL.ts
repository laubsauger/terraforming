import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, texture } from 'three/tsl';
export interface WaterMaterialTSLOptions {
  color?: THREE.Color;
  opacity?: number;
  depthTexture?: THREE.Texture;
}

/**
 * Creates a simple water material using TSL
 */
export function createWaterMaterialTSL(options: WaterMaterialTSLOptions = {}): THREE.MeshPhysicalNodeMaterial {
  const {
    color = new THREE.Color(0x0099cc),
    opacity = 0.4,
    depthTexture
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    roughness: 0.0,
    metalness: 0.0,
    transmission: 0.9, // High transmission for realistic water
    thickness: 0.2,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
  });

  // Animated UV using proper time node for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.02), time.mul(0.01)));

  // Water colors for different depths
  const deepWaterColor = vec3(0.0, 0.2, 0.4);   // Deep blue
  const shallowWaterColor = vec3(0.0, 0.6, 0.8); // Light blue
  const veryShallowColor = vec3(0.2, 0.8, 0.9);  // Almost clear

  // Create depth-based color variation
  const waterColorNode = depthTexture
    ? (() => {
        // Use depth texture to vary color - shallow areas are lighter
        const depth = texture(depthTexture, uv()).r;
        const shallowFactor = float(1.0).sub(depth); // Invert depth for shallow areas

        // Mix colors based on depth
        const deepToShallow = mix(deepWaterColor, shallowWaterColor, shallowFactor.pow(0.5));
        return mix(deepToShallow, veryShallowColor, shallowFactor.pow(2.0));
      })()
    : (() => {
        // Without depth texture, use flow variation for some color change
        const flowVariation = animatedUV.x.add(animatedUV.y).sin().mul(0.3).add(0.7);
        return mix(deepWaterColor, shallowWaterColor, flowVariation);
      })();

  // Apply animated water color
  material.colorNode = waterColorNode;

  // Set base opacity lower for more transparency
  material.opacityNode = float(opacity);

  return material;
}