import * as THREE from 'three';
import type { Texture } from 'three';

export interface LavaMaterialOptions {
  lavaDepthMap: Texture;
  temperatureMap: Texture;
  crustMap?: Texture;
  flowMap?: Texture;
  noiseTexture?: Texture;
  debugMode?: number;
}

export function createLavaMaterial(options: LavaMaterialOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xff4500), // Orange-red lava color
    emissive: new THREE.Color(0xff2200),
    emissiveIntensity: 1.0,
    roughness: 0.9,
    metalness: 0.0,
  });

  // Store textures in userData for shader access
  material.userData.lavaDepthMap = options.lavaDepthMap;
  material.userData.temperatureMap = options.temperatureMap;
  material.userData.crustMap = options.crustMap;
  material.userData.flowMap = options.flowMap;
  material.userData.noiseTexture = options.noiseTexture;
  material.userData.debugMode = options.debugMode || 0;

  // Use temperature map as emissive map if available
  if (options.temperatureMap) {
    material.emissiveMap = options.temperatureMap;
  }

  // Update function for dynamic changes
  material.onBeforeRender = (_renderer: any, _scene: any, _camera: any) => {
    // Future: Update time-based animations here
  };

  return material;
}