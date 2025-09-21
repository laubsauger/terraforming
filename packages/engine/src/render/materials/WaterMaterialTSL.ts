import * as THREE from 'three/webgpu';
import { vec3, vec2, float, mix, uv, sin, uniform } from 'three/tsl';

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

  // Add some subtle animation using a time uniform
  const timeUniform = uniform(0);
  const animatedUV = uv().add(vec2(timeUniform.mul(0.02), timeUniform.mul(0.01)));

  // Simple wave-like normal perturbation for water surface
  const waterColor = vec3(0.0, 0.3, 0.5);
  const shallowColor = vec3(0.0, 0.5, 0.7);

  material.colorNode = mix(waterColor, shallowColor, float(0.5));

  // Update time uniform in animation loop
  material.onBeforeRender = () => {
    timeUniform.value = performance.now() / 1000;
  };

  return material;
}