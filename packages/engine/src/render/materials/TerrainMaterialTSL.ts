import * as THREE from 'three/webgpu';
import { positionLocal, texture, uv, vec3, float, normalLocal, mix, smoothstep, clamp, fract, step } from 'three/tsl';
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
  // Water is at 0.15 (2.25/15), so beach should be a smooth transition
  const wetLevel = float(0.145);   // Just below water - wet sand/mud
  const beachLevel = float(0.152); // Beach at water line
  const sandLevel = float(0.165);  // Sand extends above beach
  const grassLevel = float(0.185);  // Grass starts higher for smooth transition
  const rockLevel = float(0.45);   // Rocky terrain

  // Smooth transitions between terrain types
  const wetToBeach = smoothstep(wetLevel, beachLevel, normalizedHeight);
  const beachToSand = smoothstep(beachLevel, sandLevel, normalizedHeight);
  const sandToGrass = smoothstep(sandLevel, grassLevel, normalizedHeight);
  const grassToRock = smoothstep(grassLevel, rockLevel, normalizedHeight);
  const rockToSnow = smoothstep(rockLevel, float(0.9), normalizedHeight);

  // Mix colors based on elevation - add extra sand buffer
  const color0 = mix(wetSandColor, sandColor, wetToBeach);
  const color1 = mix(color0, sandColor, beachToSand); // Keep sand color longer
  const color2 = mix(color1, grassColor, sandToGrass);
  const color3 = mix(color2, rockColor, grassToRock);
  let terrainColor = mix(color3, snowColor, rockToSnow);

  // Add underwater coloring for terrain below water level
  const waterLevel = float(0.15); // Water level at 2.25/15
  const isUnderwater = step(normalizedHeight, waterLevel);
  const underwaterDepth = clamp(waterLevel.sub(normalizedHeight), float(0), float(1));

  // Define underwater tint colors based on depth
  const shallowWaterTint = vec3(0.4, 0.7, 0.8);   // Light blue-green for shallow
  const mediumWaterTint = vec3(0.2, 0.4, 0.6);    // Medium blue
  const deepWaterTint = vec3(0.05, 0.15, 0.3);    // Dark blue for deep

  // Create smooth depth-based underwater color transitions
  const shallowToMedium = smoothstep(float(0), float(0.04), underwaterDepth);
  const mediumToDeep = smoothstep(float(0.04), float(0.10), underwaterDepth);

  // Mix underwater tint colors based on depth
  const underwaterTint = mix(
    mix(shallowWaterTint, mediumWaterTint, shallowToMedium),
    deepWaterTint,
    mediumToDeep
  );

  // Apply underwater tint to terrain color
  // Mix more strongly with depth (from 30% at surface to 70% at depth)
  const tintStrength = mix(float(0.3), float(0.7), underwaterDepth);
  terrainColor = mix(terrainColor, terrainColor.mul(underwaterTint), isUnderwater.mul(tintStrength));

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