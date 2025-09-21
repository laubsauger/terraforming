import * as THREE from 'three/webgpu';
import { positionLocal, texture, uv, vec3, float, normalLocal, mix, smoothstep, clamp } from 'three/tsl';
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

  // Define terrain colors for different elevations
  const sandColor = vec3(0.9, 0.85, 0.7);  // Beach sand
  const grassColor = vec3(0.3, 0.6, 0.2);  // Green grass
  const rockColor = vec3(0.5, 0.45, 0.4);  // Gray rock
  const snowColor = vec3(0.95, 0.95, 1.0); // White snow

  // Create TSL node material
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0.0,
  });

  // Get UV coordinates properly for the plane geometry
  const uvCoords = uv();

  // Sample height from texture using proper UV coordinates
  const heightSample = texture(heightMap, uvCoords).r;
  const displacement = heightSample.mul(float(heightScale));

  // Apply displacement only to Y position (since plane is rotated, Y is up)
  const displacedPosition = positionLocal.add(normalLocal.mul(displacement));
  material.positionNode = displacedPosition;

  // Color based on height - create elevation-based terrain coloring
  const normalizedHeight = clamp(heightSample, float(0), float(1));

  // Define height thresholds for different terrain types
  const beachLevel = float(0.1);
  const grassLevel = float(0.3);
  const rockLevel = float(0.6);

  // Smooth transitions between terrain types
  const beachToGrass = smoothstep(beachLevel, grassLevel, normalizedHeight);
  const grassToRock = smoothstep(grassLevel, rockLevel, normalizedHeight);
  const rockToSnow = smoothstep(rockLevel, float(0.9), normalizedHeight);

  // Mix colors based on elevation
  const color1 = mix(sandColor, grassColor, beachToGrass);
  const color2 = mix(color1, rockColor, grassToRock);
  const terrainColor = mix(color2, snowColor, rockToSnow);

  material.colorNode = terrainColor;

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