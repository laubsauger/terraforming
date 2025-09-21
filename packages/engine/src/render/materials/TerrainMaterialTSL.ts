import * as THREE from 'three/webgpu';
import { positionLocal, texture, uv, vec3, float, normalLocal, mix, smoothstep, clamp, fract, step, abs } from 'three/tsl';
import type { Texture } from 'three';

export interface TerrainMaterialTSLOptions {
  heightMap: Texture;
  heightScale?: number;
  terrainSize?: number;
  normalMap?: Texture;
  flowMap?: Texture;
  accumulationMap?: Texture;
  sedimentMap?: Texture;
  showContours?: boolean;
  contourInterval?: number;
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
    showContours = false,
    contourInterval = 0.05, // Contour every 5% of height (0.75m with scale 15)
  } = options;

  // Define terrain colors for different elevations
  const wetSandColor = vec3(0.55, 0.48, 0.38);  // Wet sand/mud - darker and browner
  const sandColor = vec3(0.9, 0.85, 0.7);  // Dry beach sand
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
  // Water is at 0.14 (2.1/15), so beach should be a very narrow band above that
  const wetLevel = float(0.135);   // Just below water - wet sand/mud
  const beachLevel = float(0.145); // Very narrow beach band (only 0.01 range = 15cm with 15 scale)
  const grassLevel = float(0.17);  // Grass starts quickly after beach
  const rockLevel = float(0.45);   // Rocky terrain

  // Smooth transitions between terrain types
  const wetToBeach = smoothstep(wetLevel, beachLevel, normalizedHeight);
  const beachToGrass = smoothstep(beachLevel, grassLevel, normalizedHeight);
  const grassToRock = smoothstep(grassLevel, rockLevel, normalizedHeight);
  const rockToSnow = smoothstep(rockLevel, float(0.9), normalizedHeight);

  // Mix colors based on elevation
  const color0 = mix(wetSandColor, sandColor, wetToBeach);
  const color1 = mix(color0, grassColor, beachToGrass);
  const color2 = mix(color1, rockColor, grassToRock);
  let terrainColor = mix(color2, snowColor, rockToSnow);

  // Add topographic contour lines if enabled
  if (showContours) {
    // Calculate contour lines based on height intervals
    const contourValue = heightSample.div(float(contourInterval));
    const contourFrac = fract(contourValue);

    // Create thin contour lines (0.02 width)
    const contourLine = step(float(0.98), contourFrac).add(
      step(contourFrac, float(0.02))
    );

    // Mix contour lines with terrain color (dark lines)
    const contourColor = vec3(0.2, 0.15, 0.1); // Dark brown contour
    terrainColor = mix(terrainColor, contourColor, contourLine.mul(float(0.7)));
  }

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