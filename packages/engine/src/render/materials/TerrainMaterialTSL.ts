import * as THREE from 'three/webgpu';
import { positionLocal, texture, uv, vec3, vec2, float, normalLocal, mix, smoothstep, clamp, fract, step, normalize, normalWorld, sin, cos, mul, add, sub, div, abs, pow, dot, length } from 'three/tsl';
import type { Texture } from 'three';
import { TerrainConfig } from '@terraforming/types';

export interface TerrainMaterialTSLOptions {
  heightMap: Texture;
  heightScale?: number;
  terrainSize?: number;
  gridSize?: number; // Size of the height map (e.g., 256 for 256x256)
  normalMap?: Texture;
  flowMap?: Texture;
  accumulationMap?: Texture;
  sedimentMap?: Texture;
  waterDepthMap?: Texture; // Dynamic water depth from fluid simulation
  showContours?: boolean;
  contourInterval?: number;
  waterLevel?: number; // Normalized water level (fallback for static water)
}

/**
 * Creates a TSL-based terrain material that displaces vertices using a height texture.
 * This keeps all height data on the GPU, avoiding CPU-GPU roundtrips.
 */
export function createTerrainMaterialTSL(options: TerrainMaterialTSLOptions): THREE.MeshStandardNodeMaterial {
  const {
    heightMap,
    heightScale = 25, // Increased from 15 for more dramatic terrain
    terrainSize = 100,
    gridSize = 256, // Default to 256x256
    normalMap,
    flowMap,
    accumulationMap,
    sedimentMap,
    waterDepthMap,
    showContours = false,
    contourInterval = 0.05, // Contour every 5% of height (0.75m with scale 15)
    waterLevel = TerrainConfig.SEA_LEVEL_NORMALIZED, // Default from config
  } = options;

  // === PROCEDURAL NOISE FUNCTIONS ===
  // Simple hash function for noise
  const hash = (p: any) => {
    const h = sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123);
    return fract(h);
  };

  // Smooth noise function
  const noise = (p: any) => {
    const i = p.floor();
    const f = p.sub(i);

    // Smooth interpolation curve
    const u = f.mul(f).mul(f.sub(2.0).mul(-1));

    // Get noise values at grid corners
    const a = hash(i);
    const b = hash(i.add(vec2(1.0, 0.0)));
    const c = hash(i.add(vec2(0.0, 1.0)));
    const d = hash(i.add(vec2(1.0, 1.0)));

    // Interpolate
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  };

  // Simplified fractal noise - manually unrolled for TSL compatibility
  const fbm = (p: any, octaves = 4) => {
    if (octaves >= 4) {
      // 4 octave noise
      const n1 = noise(p).mul(0.5);
      const n2 = noise(p.mul(2.0)).mul(0.25);
      const n3 = noise(p.mul(4.0)).mul(0.125);
      const n4 = noise(p.mul(8.0)).mul(0.0625);
      return n1.add(n2).add(n3).add(n4);
    } else if (octaves >= 3) {
      // 3 octave noise
      const n1 = noise(p).mul(0.5);
      const n2 = noise(p.mul(2.0)).mul(0.25);
      const n3 = noise(p.mul(4.0)).mul(0.125);
      return n1.add(n2).add(n3);
    } else {
      // 2 octave noise
      const n1 = noise(p).mul(0.5);
      const n2 = noise(p.mul(2.0)).mul(0.25);
      return n1.add(n2);
    }
  };

  // === BEAUTIFUL TERRAIN COLORS ===
  // Beach sand colors - highly saturated golden tones like tropical beaches
  const wetSandBase = vec3(0.8, 0.6, 0.35);        // Rich golden wet sand
  const wetSandVariation = vec3(0.9, 0.75, 0.5);   // Bright golden patches
  const drySandBase = vec3(1.0, 0.95, 0.75);       // Brilliant white-gold sand
  const drySandVariation = vec3(0.98, 0.9, 0.7);   // Pure warm sand variation

  // Grass colors - extremely vibrant tropical greens
  const grassDark = vec3(0.15, 0.7, 0.2);          // Deep emerald green
  const grassBright = vec3(0.3, 1.0, 0.25);        // Electric tropical green
  const grassDry = vec3(0.5, 0.9, 0.35);           // Bright lime green

  // Rock colors - cool gray gradient for mountain progression
  const rockDark = vec3(0.25, 0.27, 0.3);          // Dark bluish-gray base rock
  const rockMedium = vec3(0.4, 0.42, 0.45);        // Medium gray rock
  const rockLight = vec3(0.55, 0.57, 0.6);         // Lighter gray for higher elevations
  const rockPale = vec3(0.7, 0.72, 0.75);          // Pale gray approaching snow line

  // Snow and high altitude - keep pure but not gray
  const snowPure = vec3(0.98, 0.98, 1.0);          // Pure white snow
  const snowBlue = vec3(0.9, 0.95, 1.0);           // Clean blue-tinted snow

  // Create TSL node material with enhanced color vibrancy
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.7,   // Slightly smoother for better color
    metalness: 0.0,
    flatShading: false,
    side: THREE.FrontSide,
    transparent: false,
    envMapIntensity: 0.4, // More environment for richer colors
  });

  // Get UV coordinates properly for the plane geometry
  const uvCoords = uv();

  // Sample height from texture using proper UV coordinates
  const heightSample = texture(heightMap, uvCoords).r;
  const displacement = heightSample.mul(float(heightScale));

  // Apply displacement only to Y position (since plane is rotated, Y is up)
  const displacedPosition = positionLocal.add(normalLocal.mul(displacement));
  material.positionNode = displacedPosition;

  // === PROCEDURAL TEXTURING AND BIOME BLENDING ===
  const normalizedHeight = clamp(heightSample, float(0), float(1));
  const waterLevelNode = float(waterLevel);

  // Multi-scale UV coordinates with rotation to break patterns
  const worldUV1 = uvCoords.mul(float(18)).add(vec2(0.3, 0.7)); // Rotated detail
  const worldUV2 = uvCoords.mul(float(23)).add(vec2(-0.5, 0.2)); // Different scale + offset
  const coarseUV1 = uvCoords.mul(float(4.7)).add(vec2(0.1, -0.3)); // Slightly different scales
  const coarseUV2 = uvCoords.mul(float(6.3)).add(vec2(-0.2, 0.5));

  // Multiple noise layers with different scales and offsets to break repetition
  const detailNoise1 = fbm(worldUV1, 3);
  const detailNoise2 = fbm(worldUV2, 2);
  const mediumNoise1 = fbm(coarseUV1, 2);
  const mediumNoise2 = fbm(coarseUV2, 3);
  const largeNoise = noise(uvCoords.mul(float(1.7)).add(vec2(0.4, -0.1)));

  // Combine noises with different weights to create complex patterns
  const detailNoise = detailNoise1.mul(0.6).add(detailNoise2.mul(0.4));
  const mediumNoise = mediumNoise1.mul(0.7).add(mediumNoise2.mul(0.3));

  // === BIOME DEFINITIONS ===
  // Define height thresholds for different terrain types from config
  const wetLevel = float(TerrainConfig.BEACH_WET);
  const beachLevel = float(TerrainConfig.BEACH_DRY);
  const sandLevel = float(TerrainConfig.BEACH_HIGH);
  const grassLevel = float(TerrainConfig.GRASSLANDS);
  const rockLevel = float(TerrainConfig.MOUNTAINS_LOW);
  const snowLevel = float(TerrainConfig.MOUNTAINS_HIGH);

  // === SAND BIOMES (Beach & Coastal) ===
  // Create varied sand colors using multiple noise layers
  const sandNoise = detailNoise.mul(0.6).add(mediumNoise.mul(0.4));
  const wetSandColor = mix(wetSandBase, wetSandVariation, sandNoise);
  const drySandColor = mix(drySandBase, drySandVariation, sandNoise);

  // Multiple ripple patterns at different scales and orientations to break repetition
  const ripple1 = sin(worldUV1.x.mul(17.0)).add(sin(worldUV1.y.mul(13.0))).mul(0.03);
  const ripple2 = sin(worldUV2.x.mul(11.0).add(worldUV2.y.mul(7.0))).mul(0.02); // Diagonal ripples
  const ripple3 = sin(largeNoise.mul(25.0)).mul(0.01); // Noise-driven ripples
  const ripplePattern = ripple1.add(ripple2).add(ripple3);

  // Add subtle sand grain variation
  const grainPattern = detailNoise1.sub(0.5).mul(0.015);
  const texturedSand = drySandColor.add(vec3(ripplePattern)).add(vec3(grainPattern));

  // === GRASS BIOMES (Varied vegetation) ===
  // Create varied grass using multiple noise scales and offsets
  const grassNoise1 = fbm(worldUV1.mul(float(1.3)), 4);
  const grassNoise2 = fbm(worldUV2.mul(float(0.9)), 3);
  const grassVariation = fbm(coarseUV1.mul(float(0.7)), 2);

  // Mix different grass colors based on multiple noise layers
  const grassColor1 = mix(grassDark, grassBright, grassNoise1);
  const grassColor2 = mix(grassColor1, grassDry, grassVariation.mul(0.7));
  const grassColor3 = mix(grassColor2, grassBright, grassNoise2.mul(0.3));

  // Multiple grass blade textures at different scales to break patterns
  const grassDetail1 = sin(worldUV1.x.mul(73.0)).mul(sin(worldUV1.y.mul(59.0))).mul(0.015);
  const grassDetail2 = sin(worldUV2.x.mul(67.0).add(worldUV2.y.mul(41.0))).mul(0.01); // Diagonal pattern
  const grassDetail = grassDetail1.add(grassDetail2);
  const grassColor = grassColor3.add(vec3(grassDetail));

  // === ROCK BIOMES (Cliffs & Mountains) ===
  // Create varied rock colors and cliff patterns using multi-scale noise
  const rockNoise1 = fbm(worldUV1.mul(float(1.8)), 3);
  const rockNoise2 = fbm(worldUV2.mul(float(2.3)), 2);
  const cliffNoise1 = fbm(coarseUV1.mul(float(7.2)), 2);
  const cliffNoise2 = fbm(coarseUV2.mul(float(9.1)), 3);

  // Calculate elevation within rock zone for gradient
  const rockZoneProgress = smoothstep(rockLevel, snowLevel, normalizedHeight);

  // Base rock color that gets lighter with elevation
  const rockBaseColor = mix(rockDark, rockMedium, rockZoneProgress.mul(0.5));
  const rockMidColor = mix(rockBaseColor, rockLight, rockZoneProgress.mul(0.7));
  const rockHighColor = mix(rockMidColor, rockPale, rockZoneProgress);

  // Add noise variation to break up uniformity
  const rockColor1 = mix(rockHighColor, rockHighColor.mul(1.1), rockNoise1.mul(0.3));
  const rockColor2 = mix(rockColor1, rockHighColor.mul(0.9), cliffNoise1.mul(0.2));
  const rockColor3 = mix(rockColor2, rockHighColor, rockNoise2.mul(0.15));

  // Multiple striation patterns at different scales
  const striation1 = fract(normalizedHeight.mul(float(47.0)).add(detailNoise1.mul(3.0))).sub(0.5).abs().mul(2.0);
  const striation2 = fract(normalizedHeight.mul(float(83.0)).add(detailNoise2.mul(2.0))).sub(0.5).abs().mul(2.0);
  const striationMask1 = step(float(0.85), striation1);
  const striationMask2 = step(float(0.9), striation2);
  const striationMask = striationMask1.add(striationMask2.mul(0.5));
  const rockColor = mix(rockColor3, rockColor3.mul(0.8), striationMask.mul(0.2));

  // === SNOW BIOMES ===
  const snowNoise1 = noise(worldUV1.mul(float(2.8)));
  const snowNoise2 = noise(worldUV2.mul(float(4.2)));
  const snowNoise = snowNoise1.mul(0.7).add(snowNoise2.mul(0.3));
  const snowColor = mix(snowPure, snowBlue, snowNoise.mul(0.3));

  // === BIOME BLENDING ===
  // Create smooth transitions between biomes with noise-based edges
  const transitionNoise = detailNoise.mul(0.02); // Small noise for natural edges

  const wetToBeach = smoothstep(wetLevel.sub(transitionNoise), beachLevel.add(transitionNoise), normalizedHeight);
  const beachToSand = smoothstep(beachLevel.sub(transitionNoise), sandLevel.add(transitionNoise), normalizedHeight);
  const sandToGrass = smoothstep(sandLevel.sub(transitionNoise), grassLevel.add(transitionNoise), normalizedHeight);
  const grassToRock = smoothstep(grassLevel.sub(transitionNoise), rockLevel.add(transitionNoise), normalizedHeight);
  const rockToSnow = smoothstep(snowLevel.sub(transitionNoise.mul(2.0)), snowLevel.add(transitionNoise.mul(3.0)), normalizedHeight);

  // Blend biomes with natural transitions
  const color0 = mix(wetSandColor, texturedSand, wetToBeach);
  const color1 = mix(color0, texturedSand, beachToSand);
  const color2 = mix(color1, grassColor, sandToGrass);
  const color3 = mix(color2, rockColor, grassToRock);

  // Mix rock with snow at high elevations for realistic alpine appearance
  const snowRockMix = mix(rockColor, snowColor, rockToSnow.mul(0.7).add(snowNoise.mul(0.3)));
  const terrainColorBase = mix(color3, snowRockMix, rockToSnow);

  // === DYNAMIC MATERIAL PROPERTIES BY BIOME ===
  // Calculate biome weights for material property variation
  const sandWeight = clamp(smoothstep(grassLevel.sub(0.03), sandLevel, normalizedHeight), float(0), float(1));
  const grassWeight = clamp(smoothstep(rockLevel.sub(0.1), grassLevel.add(0.05), normalizedHeight).mul(smoothstep(sandLevel.sub(0.02), grassLevel.add(0.02), normalizedHeight)), float(0), float(1));
  const rockWeight = clamp(smoothstep(grassLevel.sub(0.05), rockLevel.add(0.1), normalizedHeight), float(0), float(1));
  const snowWeight = clamp(smoothstep(rockLevel, snowLevel.add(0.1), normalizedHeight), float(0), float(1));

  // Dynamic roughness based on biome
  // Sand is smooth, grass is medium, rocks are rough, snow is very smooth
  const biomeRoughness = sandWeight.mul(0.3).add(grassWeight.mul(0.8)).add(rockWeight.mul(0.95)).add(snowWeight.mul(0.1));

  // === ENHANCED UNDERWATER TERRAIN EFFECTS ===
  // Use dynamic water depth from fluid simulation if available, otherwise fallback to static water level
  const dynamicWaterLevel = waterDepthMap ? texture(waterDepthMap, uv()) : null;
  const effectiveWaterLevel = dynamicWaterLevel ?
    normalizedHeight.add(dynamicWaterLevel.r.mul(0.1)) : // Scale water depth appropriately
    waterLevelNode; // Fallback to static water level

  const isUnderwater = dynamicWaterLevel ?
    step(float(0.0001), dynamicWaterLevel.r) : // Any water depth > 0.0001 means underwater (increased sensitivity)
    step(normalizedHeight, waterLevelNode); // Static fallback

  const underwaterDepth = dynamicWaterLevel ?
    clamp(dynamicWaterLevel.r.mul(100.0), float(0), float(1)) : // Scale water depth for visual effect (increased multiplier for testing)
    clamp(waterLevelNode.sub(normalizedHeight), float(0), float(1)); // Static fallback

  // Create smooth underwater color progression from shallow to deep - more saturated
  const shallowUnderwaterTint = vec3(0.85, 0.92, 0.98);     // Very light blue tint for shallow
  const mediumUnderwaterTint = vec3(0.7, 0.85, 0.95);       // Light blue-green
  const deepUnderwaterTint = vec3(0.5, 0.75, 0.9);          // Medium blue-green

  // Smooth depth-based underwater color transitions (adjusted for 0.15 water level)
  const shallowToMedium = smoothstep(float(0), float(0.04), underwaterDepth);
  const mediumToDeep = smoothstep(float(0.04), float(0.09), underwaterDepth);
  const veryDeepEffect = smoothstep(float(0.09), float(0.15), underwaterDepth);

  // Progressive underwater tinting based on depth
  const underwaterTint1 = mix(shallowUnderwaterTint, mediumUnderwaterTint, shallowToMedium);
  const underwaterTint2 = mix(underwaterTint1, deepUnderwaterTint, mediumToDeep);
  const finalUnderwaterTint = mix(underwaterTint2, deepUnderwaterTint.mul(0.8), veryDeepEffect);

  // Apply underwater effects with progressive intensity (adjusted for 0.15 water level)
  const baseUnderwaterStrength = smoothstep(float(0), float(0.015), underwaterDepth).mul(0.4);
  const mediumUnderwaterStrength = smoothstep(float(0.015), float(0.07), underwaterDepth).mul(0.3);
  const deepUnderwaterStrength = smoothstep(float(0.07), float(0.14), underwaterDepth).mul(0.4);

  const totalUnderwaterStrength = clamp(
    baseUnderwaterStrength.add(mediumUnderwaterStrength).add(deepUnderwaterStrength),
    float(0),
    float(0.7)
  );

  // Apply underwater tinting to terrain
  const terrainColorTinted = mix(terrainColorBase, terrainColorBase.mul(finalUnderwaterTint), isUnderwater.mul(totalUnderwaterStrength));

  // Add caustic light patterns for underwater areas
  const causticsX = sin(worldUV1.x.mul(4.0).add(mediumNoise.mul(2.0))).mul(0.5).add(0.5);
  const causticsY = cos(worldUV1.y.mul(3.5).sub(mediumNoise.mul(1.8))).mul(0.5).add(0.5);
  const causticsPattern = causticsX.mul(causticsY).mul(0.15);

  // Apply caustics only to underwater areas with depth-based intensity
  const causticsStrength = isUnderwater.mul(clamp(underwaterDepth.mul(5.0), float(0), float(1))).mul(0.8);
  const causticsEffect = vec3(causticsPattern).mul(causticsStrength);

  let terrainColorWithCaustics = terrainColorTinted.add(causticsEffect);

  // === FLOW AND EROSION VISUALIZATION ===
  // Apply flow accumulation to create stream/river darkening
  if (accumulationMap) {
    const accumulation = texture(accumulationMap, uv()).r;
    // Create river mask with smoothstep for natural edges
    const riverMask = smoothstep(float(0.01), float(0.1), accumulation);
    const streamMask = smoothstep(float(0.001), float(0.01), accumulation);

    // Darken and add wetness to stream/river areas
    const riverColor = vec3(0.3, 0.35, 0.4);  // Dark wet soil/rock
    const streamColor = vec3(0.5, 0.52, 0.55); // Lighter wet areas

    // Blend based on accumulation strength
    const tempColor = mix(terrainColorWithCaustics.mul(0.7), riverColor, riverMask);
    const newColor = mix(
      terrainColorWithCaustics,
      tempColor,
      streamMask
    );
    terrainColorWithCaustics = newColor.add(vec3(0)); // Keep as OperatorNode
  }

  // Apply sediment visualization (lighter areas where sediment deposited)
  if (sedimentMap) {
    const sediment = texture(sedimentMap, uv()).r;
    const sedimentMask = smoothstep(float(0), float(0.1), sediment);
    const sedimentColor = vec3(0.8, 0.75, 0.65); // Light sandy sediment
    const newSedColor = mix(terrainColorWithCaustics, sedimentColor, sedimentMask.mul(0.3));
    terrainColorWithCaustics = newSedColor.add(vec3(0)); // Keep as OperatorNode
  }

  const terrainColorFinal = terrainColorWithCaustics;

  // Add topographic contour lines if enabled
  const finalTerrainColor = (() => {
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
      return mix(terrainColorFinal, contourColor, contourLine.mul(float(0.7)));
    }
    return terrainColorFinal;
  })();

  material.colorNode = finalTerrainColor;

  // Apply dynamic roughness based on biome
  let dynamicRoughness = biomeRoughness;

  // Reduce roughness in wet areas (streams/rivers)
  if (accumulationMap) {
    const accumulation = texture(accumulationMap, uv()).r;
    const wetnessMask = smoothstep(float(0), float(0.05), accumulation);
    // Wet areas are glossier (lower roughness)
    const newRoughness = mix(dynamicRoughness, float(0.1), wetnessMask.mul(0.8));
    dynamicRoughness = newRoughness.add(float(0)); // Keep as OperatorNode
  }

  material.roughnessNode = clamp(dynamicRoughness, float(0.1), float(1.0));

  // Compute normals from height gradient for proper lighting
  if (normalMap) {
    // Use provided normal map
    material.normalNode = texture(normalMap, uv()).xyz;
  } else {
    // Enhanced normal calculation with better sampling
    const texelSize = float(1.0 / gridSize);

    // Sample heights at neighboring points for Sobel filter
    const h00 = texture(heightMap, uv().add(vec2(texelSize.mul(-1), texelSize.mul(-1)))).r.mul(float(heightScale));
    const h10 = texture(heightMap, uv().add(vec2(texelSize.mul(0), texelSize.mul(-1)))).r.mul(float(heightScale));
    const h20 = texture(heightMap, uv().add(vec2(texelSize, texelSize.mul(-1)))).r.mul(float(heightScale));
    const h01 = texture(heightMap, uv().add(vec2(texelSize.mul(-1), texelSize.mul(0)))).r.mul(float(heightScale));
    const h11 = texture(heightMap, uv()).r.mul(float(heightScale)); // Center
    const h21 = texture(heightMap, uv().add(vec2(texelSize, texelSize.mul(0)))).r.mul(float(heightScale));
    const h02 = texture(heightMap, uv().add(vec2(texelSize.mul(-1), texelSize))).r.mul(float(heightScale));
    const h12 = texture(heightMap, uv().add(vec2(texelSize.mul(0), texelSize))).r.mul(float(heightScale));
    const h22 = texture(heightMap, uv().add(vec2(texelSize, texelSize))).r.mul(float(heightScale));

    // Sobel filter for better gradient estimation
    const sobelX = h00.mul(-1).add(h20).add(h01.mul(-2)).add(h21.mul(2)).add(h02.mul(-1)).add(h22);
    const sobelY = h00.mul(-1).add(h02).add(h10.mul(-2)).add(h12.mul(2)).add(h20.mul(-1)).add(h22);

    // Calculate the normal vector
    const worldStep = float(terrainSize).mul(texelSize);

    // Cross product of tangent vectors
    const tangentX = vec3(worldStep.mul(2), float(0), sobelX);
    const tangentY = vec3(float(0), worldStep.mul(2), sobelY);

    // For a plane in XY with Z up (before rotation), the normal calculation is:
    const nx = sobelX.div(worldStep.mul(2)).mul(-1);
    const ny = sobelY.div(worldStep.mul(2)).mul(-1);
    const nz = float(1);

    // Build and normalize the normal
    const normalRaw = vec3(nx, ny, nz);
    const normalizedNormal = normalize(normalRaw);

    // Apply normal to material
    material.normalNode = normalizedNormal;
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