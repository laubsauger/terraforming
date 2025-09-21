import * as THREE from 'three/webgpu';
import { positionLocal, texture, uv, vec3, float, normalLocal } from 'three/tsl';
import type { Texture } from 'three';

export interface TerrainMaterialTSLOptions {
  heightMap: Texture;
  heightScale?: number;
  terrainSize?: number;
  normalMap?: Texture;
  flowMap?: Texture;
  accumulationMap?: Texture;
  sedimentMap?: Texture;
}

/**
 * Creates a TSL-based terrain material that displaces vertices using a height texture.
 * This keeps all height data on the GPU, avoiding CPU-GPU roundtrips.
 */
export function createTerrainMaterialTSL(options: TerrainMaterialTSLOptions): THREE.MeshStandardNodeMaterial {
  const {
    heightMap,
    heightScale = 15,
    terrainSize = 100,
    normalMap,
    flowMap,
    accumulationMap,
    sedimentMap,
  } = options;

  // Create TSL node material
  const material = new THREE.MeshStandardNodeMaterial({
    colorNode: vec3(0.23, 0.49, 0.28), // Default green terrain color
    roughness: 0.9,
    metalness: 0.0,
  });

  // Sample height from texture and displace vertex position
  const heightSample = texture(heightMap, uv()).r;
  const displacement = heightSample.mul(float(heightScale));

  // Apply displacement to Y position
  material.positionNode = positionLocal.add(vec3(0, displacement, 0));

  // If we have a normal map, use it; otherwise compute from height gradient
  if (normalMap) {
    material.normalNode = texture(normalMap, uv()).xyz;
  } else {
    // For now, use the default normal calculation
    // TODO: Compute normals from height gradient in shader
    material.normalNode = normalLocal;
  }

  // Store additional maps for potential use in fragment shader
  material.userData = {
    heightMap,
    flowMap,
    accumulationMap,
    sedimentMap,
    heightScale,
    terrainSize,
  };

  return material;
}