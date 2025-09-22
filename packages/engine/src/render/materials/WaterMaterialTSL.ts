import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, texture, smoothstep, length, abs, sin, cos, normalize, positionLocal, atan, step } from 'three/tsl';

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
    waterLevel = 0.14
  } = options;

  const material = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    roughness: 0.175, // Smoother for better reflections
    metalness: 0.02,   // Very low metalness - water is not metallic
    transmission: 0.6, // More transmission for water transparency
    thickness: 1.5,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
    clearcoat: 0.8,  // Higher clearcoat for better reflections
    clearcoatRoughness: 0.2,  // Smoother clearcoat for sharper reflections
    depthWrite: false, // Allow transparency to work properly
    depthTest: true,
    envMapIntensity: 0.8, // Reduced back to more reasonable level
    specularIntensity: 1.0,  // More moderate specular highlights
    sheen: 0.1,  // Lower sheen for more natural look
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

    // Normalize depth with better scaling for visual appeal
    const normalizedDepth = smoothstep(float(0), float(0.08), waterDepth); // Smooth transition over 8% height range

    // Distance from center for additional color variation
    const uvCentered = uv().sub(vec2(0.5, 0.5));
    const distFromCenter = length(uvCentered).mul(2); // 0 at center, 1 at edges

    // Add wet sand color for areas just at/above waterline
    const wetSandColor = vec3(0.15, 0.4, 0.6); // More blue-turquoise for wet sand

    // Smooth gradient transitions from shore to deep ocean
    const wetSand = mix(wetSandColor, veryShallowColor, smoothstep(float(-0.002), float(0.002), waterDepth));
    const foam = mix(wetSand, veryShallowColor, smoothstep(float(0.002), float(0.006), waterDepth));
    const veryShallow = mix(foam, shallowWaterColor, smoothstep(float(0.006), float(0.02), waterDepth));
    const shallow = mix(veryShallow, mediumWaterColor, smoothstep(float(0.02), float(0.04), waterDepth));
    const mediumShallow = mix(shallow, mediumDeepColor, smoothstep(float(0.04), float(0.07), waterDepth));
    const medium = mix(mediumShallow, deepWaterColor, smoothstep(float(0.07), float(0.12), waterDepth));
    const deep = mix(medium, veryDeepWaterColor, smoothstep(float(0.12), float(0.25), waterDepth)); // Very deep areas

    // Add distance-based darkening - more aggressive for open ocean effect
    // Combine depth and distance for realistic deep ocean appearance
    const distanceFactor = smoothstep(float(0.2), float(0.8), distFromCenter);
    const depthDistanceColor = mix(deep, deepWaterColor, distanceFactor.mul(0.6));

    // Also darken based on terrain slope for more variation
    const terrainSlope = abs(texture(heightTexture, uv().add(vec2(0.01, 0))).r.sub(terrainHeight)).mul(50);
    const slopeColor = mix(depthDistanceColor, depthDistanceColor.mul(0.8), terrainSlope);

    waterColorNode = slopeColor;

    // Create SOFT, GRADUAL shore break like tropical beaches
    const shoreTransition = smoothstep(float(-0.01), float(0.05), waterDepth); // Much wider, softer transition

    // Progressive opacity - more opaque in deeper water to hide seafloor
    const shallowOpacity = float(0.85); // High base opacity for shallow
    const mediumOpacity = float(0.92); // Higher for medium depth
    const deepOpacity = float(0.98); // Nearly opaque for deep ocean

    // Smooth depth-based opacity transitions
    const depthOpacity = mix(
      mix(shallowOpacity, mediumOpacity, smoothstep(float(0), float(0.06), waterDepth)),
      deepOpacity,
      smoothstep(float(0.06), float(0.15), waterDepth)
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

  // Add significant roughness variation to scatter reflections realistically
  const roughnessBase = animatedUV.x.sin().mul(animatedUV.y.cos()).mul(0.15); // More variation
  const roughnessWaves = time.mul(0.5).sin().mul(0.08); // Stronger temporal variation
  const roughnessNoise = sin(uv().x.mul(50).add(time)).mul(cos(uv().y.mul(45).sub(time.mul(0.7)))).mul(0.1);

  // Create depth-based roughness - smoother in deep water, rougher near shore
  let roughnessNode: any = roughnessBase.add(roughnessWaves).add(roughnessNoise).add(float(0.25)); // Base roughness of 0.25

  if (heightTexture && waterLevel !== undefined) {
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);
    // Shore is rougher (more scattered), deep water slightly smoother
    const depthRoughness = mix(float(0.35), float(0.2), smoothstep(float(0), float(0.1), waterDepth));
    roughnessNode = roughnessNode.mul(depthRoughness.div(float(0.25))); // Scale relative to base
  }

  material.roughnessNode = roughnessNode;

  // Add physical vertex displacement for waves at shore (must be before normal calculation)
  if (heightTexture && waterLevel !== undefined) {
    // Get water depth for shore detection
    const terrainHeight = texture(heightTexture, uv()).r;
    const waterDepth = float(waterLevel).sub(terrainHeight);

    // Very narrow shore zone for wave displacement - only affects beach area
    const deepFalloff = smoothstep(float(0.03), float(0.01), waterDepth);  // Waves only at shore

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
    const veryShallowZone = smoothstep(float(0), float(0.015), waterDepth);  // Right at waterline
    const nearShoreZone = smoothstep(float(0.025), float(0.06), waterDepth);  // Near shore area
    const deepOceanFade = smoothstep(float(0.06), float(0.12), waterDepth);   // Fade in deep water

    // SHORE WAVES - Multi-layered beach break effects
    const shoreScale1 = float(25);   // Primary beach ripples
    const shoreScale2 = float(40);   // Secondary ripples
    const shoreScale3 = float(60);   // Fine detail
    const shoreUV1 = uv().mul(shoreScale1).add(vec2(time.mul(0.025), time.mul(-0.035)));
    const shoreUV2 = uv().mul(shoreScale2).add(vec2(time.mul(-0.02), time.mul(0.03)));
    const shoreUV3 = uv().mul(shoreScale3).add(vec2(time.mul(0.015), time.mul(-0.01)));

    // Calculate radial coordinates for beach waves
    const uvCenteredBeach = uv().sub(vec2(0.5, 0.5));
    const radialDist = length(uvCenteredBeach);

    // Radial beach break patterns - waves moving INWARD at 60 frequency
    const radialBeachCoord = radialDist.mul(60);  // 60 frequency
    const beachBreak1 = sin(radialBeachCoord.sub(time.mul(3.5))).mul(0.25);   // SUB time for inward
    const beachBreak2 = cos(radialBeachCoord.mul(1.1).sub(time.mul(3.0))).mul(0.22);
    const beachBreak3 = sin(radialBeachCoord.mul(0.9).sub(time.mul(2.8))).mul(0.20);

    // Circular ripples moving inward
    const shoreRipples = sin(shoreUV1.x).mul(cos(shoreUV1.y)).mul(0.22);
    const secondaryRipples = cos(shoreUV2.x).mul(sin(shoreUV2.y)).mul(0.20);
    const fineDetail = sin(shoreUV3.x.add(shoreUV3.y)).mul(0.18);

    // Breaking wave curl following radial pattern - moving inward
    const curlEffect = sin(radialBeachCoord.mul(1.5).sub(time.mul(4.0))).pow(2).mul(0.25);

    // Combine shore effects - MAXIMUM at waterline, fade quickly
    const waterlineIntensity = float(1).sub(veryShallowZone.pow(0.3));  // Sharper falloff
    const shoreWaves = beachBreak1.add(beachBreak2).add(beachBreak3).add(shoreRipples).add(secondaryRipples).add(fineDetail).add(curlEffect).mul(waterlineIntensity);

    // OCEAN WAVES - Larger swells that fade with depth
    const oceanScale1 = float(4);    // Large swells
    const oceanScale2 = float(10);   // Medium waves
    const oceanUV1 = uv().mul(oceanScale1).add(vec2(time.mul(0.01), time.mul(0.008)));
    const oceanUV2 = uv().mul(oceanScale2).add(vec2(time.mul(-0.008), time.mul(0.012)));

    const oceanHeight1 = sin(oceanUV1.x).mul(cos(oceanUV1.y)).mul(0.25);
    const oceanHeight2 = cos(oceanUV2.x).mul(sin(oceanUV2.y)).mul(0.15);

    // Ocean waves fade out in deep water
    const oceanWaves = oceanHeight1.add(oceanHeight2).mul(float(1).sub(deepOceanFade.mul(0.7)));

    // Combine shore and ocean waves
    const dx = shoreWaves.add(oceanWaves.mul(nearShoreZone));
    const dy = shoreWaves.mul(0.8).add(oceanWaves);

    // Create normal with appropriate tilt
    const normal = normalize(vec3(dx, dy, float(0.5)));
    material.normalNode = normal;
  } else {
    // Fallback - simple wave pattern for lakes/rivers
    const simpleWaves = sin(uv().x.mul(10).add(time)).mul(cos(uv().y.mul(10).sub(time))).mul(0.1);
    material.normalNode = normalize(vec3(simpleWaves, simpleWaves, float(1)));
  }

  return material;
}