import * as THREE from 'three';
import type { Texture } from 'three';

export interface TerrainMaterialOptions {
  heightMap: Texture;
  normalMap?: Texture;
  flowMap?: Texture;
  accumulationMap?: Texture;
  sedimentMap?: Texture;
  debugMode?: number;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: options.heightMap,
    roughness: 0.8,
    metalness: 0.0,
    color: new THREE.Color(0x3a7c47), // Default green terrain color
  });

  // Add displacement map for terrain height
  material.displacementMap = options.heightMap;
  material.displacementScale = 20;

  // Normal map if provided
  if (options.normalMap) {
    material.normalMap = options.normalMap;
  }

  // Store debug mode and textures in userData for shader access
  material.userData.debugMode = options.debugMode || 0;
  material.userData.flowMap = options.flowMap;
  material.userData.accumulationMap = options.accumulationMap;
  material.userData.sedimentMap = options.sedimentMap;

  // Update function for dynamic changes
  material.onBeforeRender = (_renderer: any, _scene: any, _camera: any) => {
    // Future: Update shader uniforms here if needed
  };

  return material;
}