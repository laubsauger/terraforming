import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, normalMap } from 'three/tsl';
export interface WaterMaterialTSLOptions {
  color?: THREE.Color;
  opacity?: number;
}

/**
 * Creates a simple water material using TSL
 */
export function createWaterMaterialTSL(options: WaterMaterialTSLOptions = {}): THREE.MeshPhysicalNodeMaterial {
  const {
    color = new THREE.Color(0x0077be),
    opacity = 0.8
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.0,
    metalness: 0.0,
    transmission: 0.5,
    thickness: 0.1,
    ior: 1.33,
    side: THREE.DoubleSide,
  });

  // Animated UV using proper time node for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.02), time.mul(0.01)));

  // Simple wave-like normal perturbation for water surface
  const waterColor = vec3(0.0, 0.3, 0.5);
  const shallowColor = vec3(0.0, 0.5, 0.7);

  // Use animated UV for color variation to simulate flowing water
  const flowVariation = animatedUV.x.add(animatedUV.y).sin().mul(0.3).add(0.7);
  material.colorNode = mix(waterColor, shallowColor, flowVariation);

  return material;
}