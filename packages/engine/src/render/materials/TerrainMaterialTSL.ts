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

  // === RICH TERRAIN COLOR PALETTE WITH VARIANCE ===
  // Underwater mud/sand - darker, richer
  const underwaterMud = vec3(0.25, 0.2, 0.15);     // Dark underwater sediment
  const underwaterSand = vec3(0.35, 0.3, 0.22);    // Murky sand

  // Beach zone - multiple sand layers
  const wetSandBase = vec3(0.55, 0.42, 0.28);      // Dark wet sand
  const wetSandVariation = vec3(0.62, 0.48, 0.32); // Wet sand variation
  const dampSand = vec3(0.72, 0.58, 0.38);         // Damp sand transition
  const drySandBase = vec3(0.82, 0.68, 0.45);      // Dry beach sand
  const drySandVariation = vec3(0.88, 0.74, 0.52); // Light dry sand

  // Coastal transition - scrubland
  const coastalScrub = vec3(0.45, 0.48, 0.28);     // Sandy grass mix
  const dryGrass = vec3(0.52, 0.5, 0.25);          // Dry coastal grass

  // Grassland colors - varied greens
  const grassDark = vec3(0.08, 0.28, 0.06);        // Dark forest floor
  const grassMedium = vec3(0.15, 0.42, 0.1);       // Healthy grass
  const grassBright = vec3(0.25, 0.55, 0.15);      // Bright meadow grass
  const grassYellow = vec3(0.35, 0.45, 0.18);      // Yellow-green grass

  // Mountain/Rock colors - earth tones
  const soilBrown = vec3(0.28, 0.22, 0.18);        // Dark soil
  const rockDark = vec3(0.22, 0.2, 0.19);          // Dark basalt
  const rockMedium = vec3(0.38, 0.34, 0.3);        // Gray rock
  const rockLight = vec3(0.52, 0.48, 0.42);        // Weathered rock
  const rockPale = vec3(0.68, 0.64, 0.58);         // Light limestone

  // Alpine/Snow zone
  const alpineTundra = vec3(0.55, 0.52, 0.45);     // Rocky tundra
  const snowDirty = vec3(0.75, 0.75, 0.72);        // Old snow
  const snowFresh = vec3(0.92, 0.93, 0.95);        // Fresh snow
  const snowPure = vec3(0.96, 0.97, 0.99);         // Pure white snow

  // Create TSL node material with matte appearance and rich colors
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,   // Very rough for matte finish
    metalness: 0.0,
    flatShading: false,
    side: THREE.FrontSide,
    transparent: false,
    envMapIntensity: 0.05, // Minimal environment reflection
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
  // Define height thresholds with more granular zones
  const deepWaterLevel = float(0.0);                                      // Ocean floor
  const shallowWaterLevel = float(TerrainConfig.SEA_LEVEL_NORMALIZED - 0.02); // Shallow water
  const wetSandLevel = float(TerrainConfig.SEA_LEVEL_NORMALIZED - 0.003);    // Wet sand
  const beachLevel = float(TerrainConfig.SEA_LEVEL_NORMALIZED + 0.002);      // Beach line
  const dryBeachLevel = float(TerrainConfig.SEA_LEVEL_NORMALIZED + 0.008);   // Dry beach
  const coastalLevel = float(TerrainConfig.SEA_LEVEL_NORMALIZED + 0.02);     // Coastal scrub
  const lowGrassLevel = float(0.22);                                         // Low grassland
  const grassLevel = float(0.35);                                            // Main grassland
  const foothillLevel = float(0.48);                                         // Foothills
  const mountainLevel = float(0.6);                                          // Mountain
  const alpineLevel = float(0.72);                                           // Alpine zone
  const snowLevel = float(0.8);                                              // Snow line

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

  // === COASTAL TRANSITION ===
  const coastalNoise = fbm(worldUV1.mul(float(2.1)), 3);
  const coastalColor = mix(coastalScrub, dryGrass, coastalNoise);

  // === GRASS BIOMES (Varied vegetation) ===
  // Create varied grass using multiple noise scales and offsets
  const grassNoise1 = fbm(worldUV1.mul(float(1.3)), 4);
  const grassNoise2 = fbm(worldUV2.mul(float(0.9)), 3);
  const grassVariation = fbm(coarseUV1.mul(float(0.7)), 2);

  // Mix different grass colors based on multiple noise layers
  const grassColor1 = mix(grassDark, grassMedium, grassNoise1);
  const grassColor2 = mix(grassColor1, grassBright, grassVariation.mul(0.6));
  const grassColor3 = mix(grassColor2, grassYellow, grassNoise2.mul(0.4));

  // Multiple grass blade textures at different scales to break patterns
  const grassDetail1 = sin(worldUV1.x.mul(73.0)).mul(sin(worldUV1.y.mul(59.0))).mul(0.015);
  const grassDetail2 = sin(worldUV2.x.mul(67.0).add(worldUV2.y.mul(41.0))).mul(0.01); // Diagonal pattern
  const grassDetail = grassDetail1.add(grassDetail2);
  const grassColor = grassColor3.add(vec3(grassDetail));

  // === FOOTHILL/MOUNTAIN ZONES ===
  // Foothills have more soil mixed with rock
  const foothillNoise = fbm(worldUV1.mul(float(1.5)), 3);
  const foothillColor = mix(soilBrown, rockMedium, foothillNoise.mul(0.7));

  // === ROCK BIOMES (Cliffs & Mountains) ===
  // Create varied rock colors and cliff patterns using multi-scale noise
  const rockNoise1 = fbm(worldUV1.mul(float(1.8)), 3);
  const rockNoise2 = fbm(worldUV2.mul(float(2.3)), 2);
  const cliffNoise1 = fbm(coarseUV1.mul(float(7.2)), 2);
  const cliffNoise2 = fbm(coarseUV2.mul(float(9.1)), 3);

  // Calculate elevation within rock zone for gradient
  const rockZoneProgress = smoothstep(mountainLevel, alpineLevel, normalizedHeight);

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

  // === ALPINE & SNOW BIOMES ===
  // Alpine tundra zone
  const alpineNoise = fbm(worldUV1.mul(float(3.2)), 2);
  const alpineColor = mix(alpineTundra, rockPale, alpineNoise.mul(0.5));

  // Snow zones with variation
  const snowNoise1 = noise(worldUV1.mul(float(2.8)));
  const snowNoise2 = noise(worldUV2.mul(float(4.2)));
  const snowNoise = snowNoise1.mul(0.7).add(snowNoise2.mul(0.3));

  // Mix between dirty and fresh snow
  const snowBase = mix(snowDirty, snowFresh, snowNoise);
  const snowColor = mix(snowBase, snowPure, smoothstep(snowLevel, float(0.9), normalizedHeight));

  // === BIOME BLENDING ===
  // Create smooth transitions between biomes with noise-based edges
  const transitionNoise = detailNoise.mul(0.015); // Small noise for natural edges

  // Beach transitions
  const wetToBeach = smoothstep(wetSandLevel, beachLevel, normalizedHeight);
  const beachToDryBeach = smoothstep(beachLevel, dryBeachLevel, normalizedHeight);
  const dryBeachToCoastal = smoothstep(dryBeachLevel, coastalLevel, normalizedHeight);

  // Vegetation transitions
  const coastalToLowGrass = smoothstep(coastalLevel.sub(transitionNoise), lowGrassLevel.add(transitionNoise), normalizedHeight);
  const lowGrassToGrass = smoothstep(lowGrassLevel.sub(transitionNoise), grassLevel.add(transitionNoise), normalizedHeight);
  const grassToFoothill = smoothstep(grassLevel.sub(transitionNoise), foothillLevel.add(transitionNoise), normalizedHeight);

  // Mountain transitions
  const foothillToMountain = smoothstep(foothillLevel.sub(transitionNoise), mountainLevel.add(transitionNoise), normalizedHeight);
  const mountainToAlpine = smoothstep(mountainLevel.sub(transitionNoise), alpineLevel.add(transitionNoise), normalizedHeight);
  const alpineToSnow = smoothstep(alpineLevel.sub(transitionNoise.mul(2.0)), snowLevel.add(transitionNoise.mul(2.0)), normalizedHeight);

  // Build terrain color through progressive blending
  // Beach zone
  const wetSandToDamp = mix(wetSandColor, dampSand, wetToBeach);
  const dampToDry = mix(wetSandToDamp, drySandColor, beachToDryBeach);
  const beachToCoastal = mix(dampToDry, coastalColor, dryBeachToCoastal);

  // Lowland to highland
  const coastalToGrassTransition = mix(beachToCoastal, grassColor, coastalToLowGrass);
  const lowToMainGrass = mix(coastalToGrassTransition, grassColor, lowGrassToGrass);
  const grassToFoothillTransition = mix(lowToMainGrass, foothillColor, grassToFoothill);

  // Mountain zones
  const foothillToRock = mix(grassToFoothillTransition, rockColor, foothillToMountain);
  const rockToAlpine = mix(foothillToRock, alpineColor, mountainToAlpine);
  const alpineToSnowTransition = mix(rockToAlpine, snowColor, alpineToSnow);

  const terrainColorBase = alpineToSnowTransition;

  // === DYNAMIC MATERIAL PROPERTIES BY BIOME ===
  // Calculate biome weights for material property variation
  const sandWeight = clamp(smoothstep(coastalLevel.sub(0.02), dryBeachLevel, normalizedHeight), float(0), float(1));
  const grassWeight = clamp(smoothstep(foothillLevel.sub(0.1), grassLevel.add(0.05), normalizedHeight).mul(smoothstep(coastalLevel, grassLevel.add(0.02), normalizedHeight)), float(0), float(1));
  const rockWeight = clamp(smoothstep(grassLevel.sub(0.05), mountainLevel.add(0.1), normalizedHeight), float(0), float(1));
  const snowWeight = clamp(smoothstep(alpineLevel, snowLevel.add(0.1), normalizedHeight), float(0), float(1));

  // Dynamic roughness based on biome - all more matte to reduce specular
  // Sand is slightly rough, grass is rough, rocks are very rough, snow is medium rough
  const biomeRoughness = sandWeight.mul(0.7).add(grassWeight.mul(0.85)).add(rockWeight.mul(0.95)).add(snowWeight.mul(0.6));

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

  // === WET SAND EFFECT FOR BEACHES ===
  // Create wetness zones for beaches and areas affected by waves
  // Water level is at 0.15, waves can displace up to ~0.005 height
  const waveZone = float(0.155); // Water level (0.15) + max wave height (~0.005)
  const beachWetnessZone = float(0.158); // Very narrow transition zone for wet sand

  // Check if we're in the beach wetness zone based on static height
  const isInWetZone = step(normalizedHeight, waterLevelNode); // Below water is always wet
  const wetZoneGradient = smoothstep(waterLevelNode, waveZone, normalizedHeight); // Gradient up to wave peak

  // Areas below or near water are wet (including wave zone)
  let beachWetness = isInWetZone.add(
    float(1).sub(isInWetZone).mul(float(1).sub(wetZoneGradient))
  );

  // If we have dynamic water depth, use it to enhance wetness
  if (waterDepthMap) {
    const waterDepth = texture(waterDepthMap, uv()).r;
    // Any area with water on it is wet
    const hasWater = step(float(0.0001), waterDepth);
    // Areas that recently had water (wave recession) stay wet longer
    const recentlyWet = smoothstep(float(0), float(0.002), waterDepth);
    // Combine with height-based wetness - use mix with step for max-like behavior
    const waterWetness = hasWater.add(recentlyWet.mul(0.5));
    const useWaterWetness = step(beachWetness, waterWetness);
    beachWetness = mix(beachWetness, waterWetness, useWaterWetness);
  }

  // Only apply wetness to sand/beach areas below beach level top, not to grass or rock
  // Beach level is at 0.16, so cut off wetness there
  const beachLevelCutoff = float(0.16);
  const isBelowBeachLevel = float(1).sub(step(beachLevelCutoff, normalizedHeight));
  const isBeachArea = float(1).sub(step(coastalLevel, normalizedHeight));
  const beachWetnessFinal = clamp(beachWetness.mul(isBeachArea).mul(isBelowBeachLevel), float(0), float(1));

  // Wet sand is darker and glossier
  // Darken the sand color for wet areas with gradient based on wetness intensity
  const wetSandDarkening = mix(float(1.0), float(0.65), beachWetnessFinal); // Progressive darkening

  // Add subtle blue-ish tint to wet sand (like real wet beach sand)
  const wetTint = vec3(0.95, 0.97, 1.0); // Very subtle blue tint
  let wetColorTinted = mix(
    finalTerrainColor,
    finalTerrainColor.mul(wetSandDarkening).mul(wetTint),
    beachWetnessFinal
  );

  // Add foam line at water's edge (where waves break)
  const foamLine = waterLevelNode.add(float(0.002)); // Right at water surface with tiny offset for waves
  const foamWidth = float(0.002); // Very narrow foam line
  const foamIntensity = smoothstep(
    foamLine.sub(foamWidth),
    foamLine,
    normalizedHeight
  ).mul(
    float(1).sub(smoothstep(foamLine, foamLine.add(foamWidth), normalizedHeight))
  );

  // Add time-based variation to foam (simulated with noise)
  const foamNoise = noise(worldUV1.mul(float(12.0))).mul(0.4).add(0.6);
  const foamColor = vec3(0.92, 0.92, 0.88); // Subtle off-white foam
  const foamEffect = foamIntensity.mul(foamNoise).mul(isBeachArea).mul(isBelowBeachLevel);

  // Apply foam to the color
  wetColorTinted = mix(wetColorTinted, foamColor, foamEffect.mul(0.4));

  material.colorNode = wetColorTinted;

  // Make wet sand glossier (lower roughness) with variation
  // Fully wet sand is very glossy, partially wet is less so
  const wetSandRoughness = mix(float(0.4), float(0.2), beachWetnessFinal); // Variable glossiness
  dynamicRoughness = mix(dynamicRoughness, wetSandRoughness, beachWetnessFinal);

  // Add metalness to wet sand for subtle specular highlights
  const wetSandMetalness = beachWetnessFinal.mul(0.05); // Very subtle metalness for wet areas
  material.metalnessNode = wetSandMetalness;

  // Reduce roughness in wet areas (streams/rivers)
  if (accumulationMap) {
    const accumulation = texture(accumulationMap, uv()).r;
    const wetnessMask = smoothstep(float(0), float(0.05), accumulation);
    // Wet areas are glossier (lower roughness)
    const newRoughness = mix(dynamicRoughness, float(0.1), wetnessMask.mul(0.8));
    dynamicRoughness = newRoughness.add(float(0)); // Keep as OperatorNode
  }

  material.roughnessNode = clamp(dynamicRoughness, float(0.1), float(1.0)); // Allow glossier wet sand

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