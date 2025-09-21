import * as THREE from 'three/webgpu';
import { vec3, float, mix, uv, vec2, time, texture, smoothstep, length, abs, sin, cos, normalize } from 'three/tsl';

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
    roughness: 0.08,
    metalness: 0.02, // Tiny bit of metalness for water shimmer
    transmission: 0.92, // Less transmission for more visible water
    thickness: 1.5,
    ior: 1.33, // Water's index of refraction
    side: THREE.DoubleSide,
    clearcoat: 1.0,
    clearcoatRoughness: 0.15,
    depthWrite: false, // Allow transparency to work properly
    depthTest: true,
    envMapIntensity: 1.5, // Enhance reflections if environment map available
  });

  // Animated UV for flowing water effect
  const animatedUV = uv().add(vec2(time.mul(0.015), time.mul(0.008)));

  // Water colors - More saturated and visible gradient
  const deepWaterColor = vec3(0.05, 0.20, 0.35);      // Lighter deep ocean blue
  const mediumDeepColor = vec3(0.08, 0.35, 0.50);     // Medium-deep water
  const mediumWaterColor = vec3(0.15, 0.50, 0.65);    // Medium depth blue
  const shallowWaterColor = vec3(0.20, 0.70, 0.80);   // Saturated turquoise shallow water
  const veryShallowColor = vec3(0.25, 0.85, 0.90);    // Bright turquoise near shore
  const foamColor = vec3(0.95, 0.98, 1.0);            // White foam at shore

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

    // Create more pronounced depth-based color transitions with visible foam
    // Use both depth and distance for more realistic ocean coloring
    const foam = mix(foamColor, veryShallowColor, smoothstep(float(0), float(0.002), waterDepth));
    const veryShallow = mix(foam, veryShallowColor, smoothstep(float(0.002), float(0.008), waterDepth));
    const shallow = mix(veryShallow, shallowWaterColor, smoothstep(float(0.008), float(0.025), waterDepth));
    const mediumShallow = mix(shallow, mediumWaterColor, smoothstep(float(0.025), float(0.05), waterDepth));
    const medium = mix(mediumShallow, mediumDeepColor, smoothstep(float(0.05), float(0.08), waterDepth));
    const deep = mix(medium, deepWaterColor, smoothstep(float(0.08), float(0.15), waterDepth));

    // Add distance-based darkening - more aggressive for open ocean effect
    // Combine depth and distance for realistic deep ocean appearance
    const distanceFactor = smoothstep(float(0.2), float(0.8), distFromCenter);
    const depthDistanceColor = mix(deep, deepWaterColor, distanceFactor.mul(0.6));

    // Also darken based on terrain slope for more variation
    const terrainSlope = abs(texture(heightTexture, uv().add(vec2(0.01, 0))).r.sub(terrainHeight)).mul(50);
    const slopeColor = mix(depthDistanceColor, depthDistanceColor.mul(0.8), terrainSlope);

    waterColorNode = slopeColor;

    // More visible opacity especially in shallow areas
    const shoreDistance = waterDepth.mul(100); // Scale up for smoother transition
    const shoreOpacity = smoothstep(float(0), float(1), shoreDistance);

    // Higher base opacity for shallow water to make it more visible
    const depthOpacity = mix(float(0.65), float(opacity), normalizedDepth);
    const finalOpacity = shoreOpacity.mul(depthOpacity);

    // Make areas above water completely transparent with smooth transition
    opacityNode = mix(finalOpacity, float(0), isAboveWater);

    // Add more pronounced wave animation to color
    const waveAnimation = animatedUV.x.add(animatedUV.y).sin().mul(0.05).add(0.95);
    waterColorNode = waterColorNode.mul(waveAnimation);

    // Add visible ripples near shore
    const rippleFactor = float(1).sub(normalizedDepth).pow(1.5);
    const rippleFreq = length(uvCentered).mul(20).add(time.mul(4));
    const ripples = rippleFreq.sin().mul(0.04).mul(rippleFactor);
    waterColorNode = waterColorNode.add(ripples);

    // Add foam animation at very shallow depths
    const foamZone = smoothstep(float(0.003), float(0), waterDepth);
    const foamPattern = animatedUV.x.mul(10).add(animatedUV.y.mul(10)).sin();
    const animatedFoam = foamPattern.mul(time.sin().mul(0.2).add(0.8));
    const foamIntensity = foamZone.mul(animatedFoam).mul(0.3);
    waterColorNode = mix(waterColorNode, foamColor, foamIntensity);

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

  // Add more roughness variation for visible water surface detail
  const roughnessBase = animatedUV.x.sin().mul(animatedUV.y.cos()).mul(0.05);
  const roughnessWaves = time.mul(0.5).sin().mul(0.02);
  material.roughnessNode = roughnessBase.add(roughnessWaves).add(float(0.05));

  // Create procedural normal map for water surface waves
  const waveScale1 = float(15);
  const waveScale2 = float(25);
  const waveScale3 = float(40);

  // Three layers of waves at different scales and speeds
  const wave1UV = uv().mul(waveScale1).add(vec2(time.mul(0.02), time.mul(0.015)));
  const wave2UV = uv().mul(waveScale2).add(vec2(time.mul(-0.015), time.mul(0.025)));
  const wave3UV = uv().mul(waveScale3).add(vec2(time.mul(0.01), time.mul(-0.01)));

  // Generate wave heights using sine/cosine combinations
  const height1 = sin(wave1UV.x).mul(cos(wave1UV.y)).mul(0.15);
  const height2 = cos(wave2UV.x).mul(sin(wave2UV.y)).mul(0.1);
  const height3 = sin(wave3UV.x.add(wave3UV.y)).mul(0.05);

  // Calculate normal from height derivatives (simplified)
  const dx = height1.add(height2).add(height3).mul(0.3);
  const dy = height1.add(height2).add(height3).mul(0.3).add(float(0.1));

  // Create normal vector and normalize it
  const normal = normalize(vec3(dx, dy, float(1)));
  material.normalNode = normal;

  return material;
}