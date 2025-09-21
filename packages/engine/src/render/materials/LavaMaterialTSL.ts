import * as THREE from 'three/webgpu';
import { vec3, vec2, float, mix, uv, sin, cos, texture, uniform } from 'three/tsl';
import type { Texture } from 'three';

export interface LavaMaterialTSLOptions {
  lavaDepthMap?: Texture;
  temperatureMap?: Texture;
  flowMap?: Texture;
}

/**
 * Creates a TSL-based lava material with emissive glow and flow animation.
 * This keeps all rendering on the GPU using TSL.
 */
export function createLavaMaterialTSL(options: LavaMaterialTSLOptions = {}): THREE.MeshPhysicalNodeMaterial {
  const {
    lavaDepthMap,
    temperatureMap,
    flowMap,
  } = options;

  // Lava colors from hot to cooling
  const hotLavaColor = vec3(1.0, 0.3, 0.0);  // Bright orange
  const coolingLavaColor = vec3(0.8, 0.1, 0.0);  // Dark red
  const cooledLavaColor = vec3(0.2, 0.05, 0.0);  // Almost black

  const material = new THREE.MeshPhysicalNodeMaterial({
    emissive: new THREE.Color(0xff3300),
    emissiveIntensity: 2,
    roughness: 0.8,
    metalness: 0.0,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });

  // Animate lava flow using a time uniform
  const timeUniform = uniform(0);

  // Create flowing UV distortion
  const flowSpeed = float(0.1);
  const distortion1 = sin(uv().x.mul(10).add(timeUniform.mul(flowSpeed)));
  const distortion2 = cos(uv().y.mul(8).add(timeUniform.mul(flowSpeed.mul(0.7))));

  const distortedUV = uv().add(vec2(
    distortion1.mul(0.01),
    distortion2.mul(0.01)
  ));

  // Temperature-based color if we have a temperature map
  const lavaColorNode = temperatureMap
    ? (() => {
        const temp = texture(temperatureMap, distortedUV).r;
        const coolingFactor = float(1).sub(temp);
        const color1 = mix(hotLavaColor, coolingLavaColor, coolingFactor);
        return mix(color1, cooledLavaColor, coolingFactor.pow(2));
      })()
    : hotLavaColor;

  // Pulsing emissive effect
  const pulse = sin(timeUniform.mul(2)).mul(0.2).add(0.8);

  material.emissiveNode = lavaColorNode.mul(pulse);
  material.colorNode = lavaColorNode;

  // Store maps for potential use
  material.userData = {
    lavaDepthMap,
    temperatureMap,
    flowMap,
  };

  // Update time uniform in animation loop
  material.onBeforeRender = () => {
    timeUniform.value = performance.now() / 1000;
  };

  return material;
}