import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, texture, smoothstep, length, abs, sin, cos, normalize, positionLocal, atan, step } from 'three/tsl';
import { TerrainConfig } from '@terraforming/types';

export interface WaterMaterialTSLOptions {
  color?: THREE.Color;
  opacity?: number;
  depthTexture?: THREE.Texture; // For dynamic water depth (rivers/lakes)
  heightTexture?: THREE.Texture; // For terrain height (ocean depth calculation)
  waterLevel?: number; // Normalized water level (0-1) for ocean
}

/**
 * Creates a realistic water material using TSL with depth-based coloring
 */
export function createWaterMaterialTSL(options: WaterMaterialTSLOptions = {}): THREE.MeshPhysicalNodeMaterial {
  const {
    opacity = 0.92,
    depthTexture,
    heightTexture,
    waterLevel = TerrainConfig.SEA_LEVEL_NORMALIZED
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    roughness: 0.25, // Balanced for some reflection
    metalness: 0.0,   // No metalness for water
    transmission: 0.7, // More transmission for water transparency
    thickness: 1.5,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
    clearcoat: 0.5,  // Some clearcoat for water surface
    clearcoatRoughness: 0.3,  // Moderate clearcoat roughness
    depthWrite: false, // Allow transparency to work properly
    depthTest: true,
    envMapIntensity: 1.2, // Strong environment reflections to avoid black areas
    specularIntensity: 0.8,  // Moderate specular
    sheen: 0.1,  // Some sheen for water surface
  });

  // Animated UV for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.015), time.mul(0.008)));

  // Water colors - VIVID tropical turquoise with darker deep ocean
  const veryDeepWaterColor = vec3(0.0, 0.15, 0.4);    // Very dark saturated blue
  const deepWaterColor = vec3(0.0, 0.25, 0.55);       // Dark saturated ocean blue
  const mediumDeepColor = vec3(0.0, 0.45, 0.75);      // Rich deep turquoise
  const mediumWaterColor = vec3(0.0, 0.65, 0.85);     // Medium turquoise
  const shallowWaterColor = vec3(0.15, 0.8, 0.95);    // Brilliant shallow turquoise
  const veryShallowColor = vec3(0.3, 0.85, 1.0);      // Crystal clear shallow
  const foamColor = vec3(0.98, 0.99, 1.0);            // Pure white foam

  // Calculate water depth and create depth-based color
  let waterColorNode;
  let opacityNode: any = float(opacity);

  if (heightTexture && waterLevel !== undefined) {
    // For ocean: calculate depth from terrain height
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);

    // Check if we're above water
    const isAboveWater = terrainHeight.greaterThan(float(waterLevel - 0.001)); // Small threshold

    // Normalize depth with better scaling for visual appeal (adjusted for 0.175 water level)
    const normalizedDepth = smoothstep(float(0), float(0.12), waterDepth); // Smooth transition over 12% height range

    // Distance from center for additional color variation
    const uvCentered = uv().sub(vec2(0.5, 0.5));
    const distFromCenter = length(uvCentered).mul(2); // 0 at center, 1 at edges

    // Add wet sand color for areas just at/above waterline
    const wetSandColor = vec3(0.15, 0.4, 0.6); // More blue-turquoise for wet sand

    // Clamp water depth to reasonable range to prevent weird behavior at extreme depths
    const clampedWaterDepth = waterDepth.clamp(float(0), float(TerrainConfig.SEA_LEVEL_NORMALIZED)); // Max depth at 15% of height scale

    // Smooth gradient transitions from shore to deep ocean (adjusted for max 15% depth)
    const wetSand = mix(wetSandColor, veryShallowColor, smoothstep(float(-0.001), float(0.002), clampedWaterDepth));
    const foam = mix(wetSand, veryShallowColor, smoothstep(float(0.002), float(0.005), clampedWaterDepth));
    const veryShallow = mix(foam, shallowWaterColor, smoothstep(float(0.005), float(0.02), clampedWaterDepth));
    const shallow = mix(veryShallow, mediumWaterColor, smoothstep(float(0.02), float(0.04), clampedWaterDepth));
    const mediumShallow = mix(shallow, mediumDeepColor, smoothstep(float(0.04), float(0.07), clampedWaterDepth));
    const medium = mix(mediumShallow, deepWaterColor, smoothstep(float(0.07), float(0.11), clampedWaterDepth));
    const deep = mix(medium, veryDeepWaterColor, smoothstep(float(0.11), float(0.15), clampedWaterDepth)); // Max at 15% depth

    // Add distance-based darkening - but ensure deep water stays dark
    const distanceFactor = smoothstep(float(0.3), float(0.7), distFromCenter);

    // Make sure very deep water stays very dark regardless of distance
    const depthDarkening = smoothstep(float(0.10), float(0.15), clampedWaterDepth);
    const finalColor = mix(deep, veryDeepWaterColor, depthDarkening);

    // Apply subtle distance variation without making deep areas bright
    waterColorNode = mix(finalColor, finalColor.mul(0.9), distanceFactor.mul(0.3));

    // Create SOFT, GRADUAL shore break like tropical beaches
    const shoreTransition = smoothstep(float(-0.01), float(0.05), waterDepth); // Much wider, softer transition

    // Progressive opacity - more opaque in deeper water to hide seafloor
    const shallowOpacity = float(0.85); // High base opacity for shallow
    const mediumOpacity = float(0.92); // Higher for medium depth
    const deepOpacity = float(0.98); // Nearly opaque for deep ocean

    // Smooth depth-based opacity transitions using clamped depth (adjusted for max 15% depth)
    const depthOpacity = mix(
      mix(shallowOpacity, mediumOpacity, smoothstep(float(0), float(0.05), clampedWaterDepth)),
      deepOpacity,
      smoothstep(float(0.05), float(0.15), clampedWaterDepth)
    );

    // Gentle shore foam opacity - soft transition
    const shoreWhiteIntensity = smoothstep(float(0), float(0.02), waterDepth); // Very gentle foam zone
    const finalOpacity = mix(float(0.75), depthOpacity, shoreWhiteIntensity); // Still visible even at shore

    // Minimal wet sand effect - just slight darkening, no transparency
    const wetSandDarkening = smoothstep(float(0.008), float(-0.005), waterDepth);
    const wetSandMask = float(1).sub(step(terrainHeight, float(waterLevel))).mul(wetSandDarkening); // Convert to float
    opacityNode = mix(finalOpacity, float(0.3), wetSandMask); // Light wet sand darkening

    // Add more pronounced wave animation to color
    const waveAnimation = animatedUV.x.add(animatedUV.y).sin().mul(0.05).add(0.95);
    waterColorNode = waterColorNode.mul(waveAnimation);

    // Add visible ripples near shore
    const rippleFactor = float(1).sub(normalizedDepth).pow(1.5);
    const rippleFreq = length(uvCentered).mul(20).add(time.mul(4));
    const ripples = rippleFreq.sin().mul(0.04).mul(rippleFactor);
    waterColorNode = waterColorNode.add(ripples);

    // GENTLE SOFT FOAM - like the reference image (very subtle, no harsh edges)
    const gentleFoamZone = smoothstep(float(0), float(0.015), waterDepth); // Very soft foam zone
    const veryGentleFoam = smoothstep(float(0), float(0.008), waterDepth);  // Closest to shore

    // Subtle white foam mixing - much softer than before
    const softFoamColor = vec3(0.7, 0.9, 1.0);  // Light blue-white foam, not pure white
    const gentleFoamColor = vec3(0.85, 0.95, 1.0); // Very gentle foam

    // Add just a hint of foam - no sharp white lines
    const foamIntensity = veryGentleFoam.mul(0.15); // Very low intensity
    waterColorNode = mix(waterColorNode, softFoamColor, foamIntensity);

    // Even gentler secondary foam layer
    const secondaryFoamIntensity = gentleFoamZone.mul(0.08);
    waterColorNode = mix(waterColorNode, gentleFoamColor, secondaryFoamIntensity);

  } else if (depthTexture) {
    // For dynamic water (rivers/lakes): use provided depth texture with more saturation
    const depth = texture(depthTexture, uv()).r;
    const normalizedDepth = smoothstep(float(0), float(1), depth);

    // More saturated colors for inland water
    const lakeShallowColor = vec3(0.25, 0.75, 0.85);  // Bright turquoise for shallow lakes
    const lakeMediumColor = vec3(0.15, 0.55, 0.70);   // Deeper blue-green

    // Mix colors based on water depth (shallow to deep)
    const shallowMix = mix(lakeShallowColor, shallowWaterColor, normalizedDepth.pow(0.5));
    waterColorNode = mix(shallowMix, lakeMediumColor, normalizedDepth.pow(0.3));

    // Higher opacity for lakes to make them more visible
    opacityNode = mix(float(0.7), float(opacity), smoothstep(float(0), float(0.1), depth));

    // Add ripple effects for lakes
    const lakeRipples = animatedUV.x.mul(8).add(animatedUV.y.mul(8)).sin();
    const rippleEffect = lakeRipples.mul(0.03).mul(float(1).sub(normalizedDepth));
    waterColorNode = waterColorNode.add(rippleEffect);

  } else {
    // Fallback: simple animated color
    const flowVariation = animatedUV.x.add(animatedUV.y).sin().mul(0.2).add(0.8);
    waterColorNode = mix(shallowWaterColor, mediumWaterColor, flowVariation);
  }

  // Apply water color and opacity
  material.colorNode = waterColorNode;
  material.opacityNode = opacityNode;

  // Improved noise for roughness - avoid regular grid patterns
  // Use prime numbers for better distribution
  const uvRotated1 = vec2(
    uv().x.mul(0.707).sub(uv().y.mul(0.707)),
    uv().x.mul(0.707).add(uv().y.mul(0.707))
  );
  const uvRotated2 = vec2(
    uv().x.mul(0.866).sub(uv().y.mul(0.5)),
    uv().x.mul(0.5).add(uv().y.mul(0.866))
  );

  // Multi-scale noise with non-repeating frequencies
  const roughnessNoise1 = sin(uvRotated1.x.mul(127).add(time.mul(1.3)))
    .mul(cos(uvRotated1.y.mul(113).sub(time.mul(0.9))))
    .mul(0.15);
  const roughnessNoise2 = cos(uvRotated2.x.mul(97).sub(time.mul(0.7)))
    .mul(sin(uvRotated2.y.mul(89).add(time.mul(1.1))))
    .mul(0.12);
  const roughnessNoise3 = sin(uv().x.mul(163).add(uv().y.mul(151)).add(time.mul(1.7)))
    .mul(0.08);

  // Combine noises with phase offsets to break up patterns
  const roughnessBase = roughnessNoise1.add(roughnessNoise2).add(roughnessNoise3);
  const roughnessWaves = sin(time.mul(0.41).add(float(2.1))).mul(0.06)
    .add(cos(time.mul(0.67).sub(float(1.3))).mul(0.04));

  // High-frequency sparkles with irregular distribution
  const sparkleUV = uv().mul(197); // Prime number for good distribution
  const glintNoise1 = sin(sparkleUV.x.add(time.mul(2.3).add(sparkleUV.y.mul(0.37))))
    .mul(cos(sparkleUV.y.mul(1.13).sub(time.mul(1.7))));
  const glintNoise2 = cos(sparkleUV.x.mul(1.41).sub(time.mul(2.1)))
    .mul(sin(sparkleUV.y.mul(1.27).add(time.mul(1.9))));
  const glintPattern = glintNoise1.mul(glintNoise2).pow(3).mul(0.5).clamp(0, 1);

  // Add more noise variation for roughness
  const roughnessNoise4 = sin(uv().x.mul(251).add(time.mul(0.31))).mul(cos(uv().y.mul(269).sub(time.mul(0.47)))).mul(0.2);
  const roughnessVariation = roughnessBase.add(roughnessWaves).add(roughnessNoise4);

  // Create depth-based roughness - balanced for natural reflections
  let roughnessNode: any = roughnessVariation.add(float(0.2)); // Moderate base

  if (heightTexture && waterLevel !== undefined) {
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);
    const clampedWaterDepth = waterDepth.clamp(float(0), float(TerrainConfig.SEA_LEVEL_NORMALIZED));

    // Natural variation between shore and deep water
    const depthRoughness = mix(float(0.5), float(0.25), smoothstep(float(0), float(0.10), clampedWaterDepth));
    roughnessNode = roughnessNode.mul(depthRoughness.div(float(0.2))); // Scale relative to base

    // Add subtle glints for sparkle
    roughnessNode = roughnessNode.sub(glintPattern.mul(0.2).mul(float(1).sub(smoothstep(float(0), float(0.02), clampedWaterDepth))));
  }

  material.roughnessNode = roughnessNode.clamp(0.15, 0.7); // Balanced range for natural water

  // Add metalness variation for sparkles on wave crests
  const metalnessBase = float(0.02);
  const metalnessSparkle = glintPattern.mul(0.15); // Slight metalness on glints for sparkle
  material.metalnessNode = metalnessBase.add(metalnessSparkle).clamp(0, 0.2);

  // Add physical vertex displacement for waves at shore (must be before normal calculation)
  if (heightTexture && waterLevel !== undefined) {
    // Get water depth for shore detection
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);

    // Very narrow shore zone for wave displacement - only affects beach area
    const deepFalloff = smoothstep(float(0.02), float(0.005), waterDepth);  // Waves only at shore

    // Calculate radial direction for waves moving toward center
    const uvCentered = uv().sub(vec2(0.5, 0.5));
    const distFromCenter = length(uvCentered);

    // PRIMARY WAVE SET - Radial waves moving INWARD (from outside to center)
    // For inward movement: phase should DECREASE as distance increases
    const radialCoord = distFromCenter.mul(60);  // 60 frequency as requested
    const primaryPhase = radialCoord.sub(time.mul(2.2));  // SUB time for inward movement
    const primaryWave1 = sin(primaryPhase).mul(0.25);  // Restored amplitude since direction was the issue
    const primaryWave2 = sin(primaryPhase.mul(1.5).add(float(2.1))).mul(0.18);
    const primaryWave3 = cos(primaryPhase.mul(0.7).sub(float(1.0))).mul(0.15);

    // SECONDARY WAVE SET - Tangential waves for variation
    const tangentCoord = atan(uvCentered.y, uvCentered.x).mul(10).add(radialCoord.mul(0.5));
    const secondaryPhase = tangentCoord.sub(time.mul(1.8));  // SUB time for proper movement
    const secondaryWave1 = sin(secondaryPhase).mul(0.15);
    const secondaryWave2 = cos(secondaryPhase.mul(1.8)).mul(0.12);

    // TERTIARY WAVE SET - Fine detail ripples
    const tertiaryPhase = radialCoord.mul(1.2).sub(time.mul(3.0));  // SUB time for inward
    const tertiaryWave = sin(tertiaryPhase).mul(cos(tertiaryPhase.mul(0.5))).mul(0.10);

    // Very high frequency noise for sharp detail and chaos
    const noiseWave = sin(uv().x.mul(100).add(time.mul(1.5))).mul(cos(uv().y.mul(95).sub(time.mul(1.2))));
    const chaosWave = sin(uv().x.mul(150).sub(uv().y.mul(130)).add(time.mul(2.0))).mul(0.08);

    // Combine waves with more complex interaction
    const primaryHeight = primaryWave1.add(primaryWave2).add(primaryWave3);
    const secondaryHeight = secondaryWave1.add(secondaryWave2);
    const tertiaryHeight = tertiaryWave.add(noiseWave.mul(0.1)).add(chaosWave);

    // Create breaking wave effect - waves get steeper as they approach shore
    const breakingFactor = float(1).sub(deepFalloff.pow(0.5));  // Steeper waves at shore
    const waveSkew = primaryHeight.mul(float(1).add(breakingFactor.mul(0.5)));  // Skew waves forward

    const combinedWaves = waveSkew.add(secondaryHeight.mul(0.7)).add(tertiaryHeight.mul(0.5));

    // Apply displacement ONLY at shore with moderate amplitude
    const shoreDisplacement = combinedWaves.mul(deepFalloff).mul(0.15);  // Moderate amplitude now that direction is fixed

    // Apply vertical displacement at shore
    material.positionNode = positionLocal.add(vec3(0, shoreDisplacement, 0));
  }

  // Create wave normals with proper shore effects
  if (heightTexture && waterLevel !== undefined) {
    // Get water depth to control wave behavior
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);

    // Different zones for different wave behaviors - bring ripples closer to shore
    const veryShallowZone = smoothstep(float(0), float(0.01), waterDepth);   // Right at waterline
    const nearShoreZone = smoothstep(float(0.015), float(0.04), waterDepth);  // Near shore area
    const deepOceanFade = smoothstep(float(0.04), float(0.10), waterDepth);  // Fade in deep water

    // Add Perlin-style noise for organic patterns
    const noiseScale1 = float(23.7);
    const noiseScale2 = float(37.3);
    const noiseScale3 = float(53.9);

    // Create rotating UV coordinates to break up patterns
    const angle1 = time.mul(0.07);
    const angle2 = time.mul(-0.11);
    const cosA1 = cos(angle1);
    const sinA1 = sin(angle1);
    const cosA2 = cos(angle2);
    const sinA2 = sin(angle2);

    const rotatedUV1 = vec2(
      uv().x.mul(cosA1).sub(uv().y.mul(sinA1)),
      uv().x.mul(sinA1).add(uv().y.mul(cosA1))
    );
    const rotatedUV2 = vec2(
      uv().x.mul(cosA2).sub(uv().y.mul(sinA2)),
      uv().x.mul(sinA2).add(uv().y.mul(cosA2))
    );

    // SHORE WAVES - Multi-layered beach break with Perlin-like noise
    const shoreUV1 = rotatedUV1.mul(noiseScale1).add(vec2(time.mul(0.023), time.mul(-0.037)));
    const shoreUV2 = rotatedUV2.mul(noiseScale2).add(vec2(time.mul(-0.019), time.mul(0.031)));
    const shoreUV3 = uv().mul(noiseScale3).add(vec2(time.mul(0.017), time.mul(-0.013)));

    // Calculate radial coordinates for beach waves
    const uvCenteredBeach = uv().sub(vec2(0.5, 0.5));
    const radialDist = length(uvCenteredBeach);

    // Radial beach break patterns - waves moving INWARD at 60 frequency
    const radialBeachCoord = radialDist.mul(60);  // 60 frequency
    const beachBreak1 = sin(radialBeachCoord.sub(time.mul(3.5))).mul(0.35);   // Moderate strength
    const beachBreak2 = cos(radialBeachCoord.mul(1.1).sub(time.mul(3.0))).mul(0.30);
    const beachBreak3 = sin(radialBeachCoord.mul(0.9).sub(time.mul(2.8))).mul(0.28);

    // Better wave patterns using phase-shifted combinations
    const shoreRipples = sin(shoreUV1.x.mul(1.13)).mul(cos(shoreUV1.y.mul(0.87))).mul(0.22);
    const secondaryRipples = cos(shoreUV2.x.mul(0.93)).mul(sin(shoreUV2.y.mul(1.07))).mul(0.20);
    const fineDetail = sin(shoreUV3.x.mul(1.17).add(shoreUV3.y.mul(0.83))).mul(0.18);

    // Breaking wave curl following radial pattern - moving inward
    const curlEffect = sin(radialBeachCoord.mul(1.5).sub(time.mul(4.0))).pow(2).mul(0.25);

    // Combine shore effects - MAXIMUM at waterline, fade quickly
    const waterlineIntensity = float(1).sub(veryShallowZone.pow(0.3));  // Sharper falloff
    const shoreWaves = beachBreak1.add(beachBreak2).add(beachBreak3).add(shoreRipples).add(secondaryRipples).add(fineDetail).add(curlEffect).mul(waterlineIntensity);

    // OCEAN WAVES - Voronoi-based cellular noise for organic patterns
    const oceanScale1 = float(2.9);
    const oceanScale2 = float(7.1);
    const oceanScale3 = float(13.7);

    // Create flowing ocean patterns with Voronoi-like cells
    const oceanTime = time.mul(0.03);
    const cellUV1 = uv().mul(oceanScale1).add(oceanTime);
    const cellUV2 = uv().mul(oceanScale2).sub(oceanTime.mul(0.7));
    const cellUV3 = uv().mul(oceanScale3).add(oceanTime.mul(1.3));

    // Generate organic wave patterns using smooth noise combinations
    const wave1X = sin(cellUV1.x.mul(3.14159)).mul(cos(cellUV1.y.mul(2.71828)));
    const wave1Y = cos(cellUV1.x.mul(2.71828)).mul(sin(cellUV1.y.mul(3.14159)));
    const oceanHeight1 = wave1X.add(wave1Y).mul(0.25);

    const wave2X = sin(cellUV2.x.mul(1.41421)).mul(sin(cellUV2.y.mul(1.73205)));
    const wave2Y = cos(cellUV2.x.mul(1.73205)).mul(cos(cellUV2.y.mul(1.41421)));
    const oceanHeight2 = wave2X.mul(wave2Y).mul(0.15);

    const wave3 = sin(cellUV3.x.add(cellUV3.y)).mul(cos(cellUV3.x.sub(cellUV3.y)));
    const oceanHeight3 = wave3.mul(0.1);

    // Ocean waves fade out in deep water
    const oceanWaves = oceanHeight1.add(oceanHeight2).add(oceanHeight3).mul(float(1).sub(deepOceanFade.mul(0.7)));

    // Add turbulent noise for irregular surface
    const turbScale1 = float(41.3);
    const turbScale2 = float(67.9);

    // Create swirling patterns
    const swirl = time.mul(0.1);
    const turbUV1 = vec2(
      uv().x.add(sin(uv().y.mul(turbScale1).add(swirl)).mul(0.02)),
      uv().y.add(cos(uv().x.mul(turbScale1).sub(swirl)).mul(0.02))
    );
    const turbUV2 = vec2(
      uv().x.add(cos(uv().y.mul(turbScale2).sub(swirl.mul(1.3))).mul(0.015)),
      uv().y.add(sin(uv().x.mul(turbScale2).add(swirl.mul(1.3))).mul(0.015))
    );

    // Generate turbulent surface using distorted coordinates
    const turb1 = sin(turbUV1.x.mul(61).add(time.mul(0.23)))
      .mul(cos(turbUV1.y.mul(53).sub(time.mul(0.31))))
      .mul(0.12);
    const turb2 = cos(turbUV2.x.mul(79).sub(time.mul(0.19)))
      .mul(sin(turbUV2.y.mul(83).add(time.mul(0.27))))
      .mul(0.08);

    // Create Perlin-like noise by combining multiple octaves
    const noise1 = sin(turbUV1.x.mul(17).add(turbUV1.y.mul(19))).mul(0.1);
    const noise2 = cos(turbUV2.x.mul(23).sub(turbUV2.y.mul(29))).mul(0.07);
    const microWaves = turb1.add(turb2).add(noise1).add(noise2);

    // Combine all wave components with moderate amplitude for natural look
    const dx = shoreWaves.add(oceanWaves.mul(nearShoreZone)).add(microWaves).mul(1.2);
    const dy = shoreWaves.mul(0.8).add(oceanWaves).add(microWaves.mul(0.7)).mul(1.2);

    // Create normal with balanced perturbation
    const normal = normalize(vec3(dx, dy, float(0.5)));  // Balanced Z component
    material.normalNode = normal;
  } else {
    // Fallback - simple wave pattern for lakes/rivers
    const simpleWaves = sin(uv().x.mul(10).add(time)).mul(cos(uv().y.mul(10).sub(time))).mul(0.1);
    material.normalNode = normalize(vec3(simpleWaves, simpleWaves, float(1)));
  }

  return material;
}