import * as THREE from 'three';
import type { Texture } from 'three';

export interface WaterMaterialOptions {
  waterDepthMap: Texture;
  flowMap?: Texture;
  normalMap1?: Texture;
  normalMap2?: Texture;
  foamTexture?: Texture;
  debugMode?: number;
}

export function createWaterMaterial(options: WaterMaterialOptions): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x1e90ff), // Dodger blue
    transparent: true,
    opacity: 0.7,
    transmission: 0.9,
    thickness: 1.0,
    roughness: 0.0,
    metalness: 0.0,
    ior: 1.33, // Water index of refraction
    side: THREE.DoubleSide,
  });

  // Store textures in userData for shader access
  material.userData.waterDepthMap = options.waterDepthMap;
  material.userData.flowMap = options.flowMap;
  material.userData.normalMap1 = options.normalMap1;
  material.userData.normalMap2 = options.normalMap2;
  material.userData.foamTexture = options.foamTexture;
  material.userData.debugMode = options.debugMode || 0;

  // Add normal map if provided
  if (options.normalMap1) {
    material.normalMap = options.normalMap1;
  }

  // Update function for dynamic changes
  material.onBeforeRender = (_renderer: any, _scene: any, _camera: any) => {
    // Future: Update time-based animations here
  };

  return material;
}