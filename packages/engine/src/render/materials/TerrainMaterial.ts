import * as THREE from 'three/webgpu';
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
    roughness: 0.9,
    metalness: 0.0,
    color: new THREE.Color(0x3a7c47), // Default green terrain color
    flatShading: true, // Better performance and looks good for terrain
  });

  // Don't use displacement map - we'll modify vertices directly instead
  // material.displacementMap causes the spikes and poor performance

  // Normal map if provided
  if (options.normalMap) {
    material.normalMap = options.normalMap;
  }

  // Store debug mode and textures in userData for shader access
  material.userData.debugMode = options.debugMode || 0;
  material.userData.heightMap = options.heightMap;
  material.userData.flowMap = options.flowMap;
  material.userData.accumulationMap = options.accumulationMap;
  material.userData.sedimentMap = options.sedimentMap;

  return material;
}