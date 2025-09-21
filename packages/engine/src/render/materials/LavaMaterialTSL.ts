import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, texture, time, vec2 } from 'three/tsl';
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

  // Animated UV with proper time node for flowing lava effect
  const flowOffset = vec2(time.mul(0.05), time.mul(0.03));
  const distortedUV = uv().add(flowOffset);

  // Temperature-based color if we have a temperature map
  const lavaColorNode = temperatureMap
    ? (() => {
        const temp = texture(temperatureMap, distortedUV).r;
        const coolingFactor = float(1).sub(temp);
        const color1 = mix(hotLavaColor, coolingLavaColor, coolingFactor);
        return mix(color1, cooledLavaColor, coolingFactor.pow(2));
      })()
    : hotLavaColor;

  // Pulsing emissive intensity using time
  const pulseIntensity = time.mul(3.0).sin().mul(0.3).add(1.0);
  material.emissiveNode = lavaColorNode.mul(pulseIntensity);
  material.colorNode = lavaColorNode;

  // Store maps for potential use
  material.userData = {
    lavaDepthMap,
    temperatureMap,
    flowMap,
  };

  return material;
}