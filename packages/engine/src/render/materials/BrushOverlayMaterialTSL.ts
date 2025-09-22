import * as THREE from 'three';
import {
  texture,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  uniform,
  positionLocal,
  normalLocal,
  varyingProperty,
  min,
  max,
  mix,
  smoothstep,
  sin,
  cos,
  abs,
  pow,
  length,
  normalize,
  dot,
  step,
  clamp
} from 'three/tsl';

interface BrushOverlayMaterialOptions {
  heightMap: THREE.DataTexture;
  soilMap?: THREE.Texture;
  rockMap?: THREE.Texture;
  lavaMap?: THREE.Texture;
  brushPosition?: THREE.Vector2;
  brushRadius?: number;
  brushMode?: 'pickup' | 'deposit';
  brushMaterial?: 'soil' | 'rock' | 'lava';
}

export function createBrushOverlayMaterialTSL(options: BrushOverlayMaterialOptions): any {
  const {
    heightMap,
    soilMap,
    rockMap,
    lavaMap,
    brushPosition = new THREE.Vector2(0, 0),
    brushRadius = 5,
    brushMode = 'pickup',
    brushMaterial = 'soil'
  } = options;

  const material = new THREE.MeshPhysicalMaterial() as any; // Will be replaced with TSL nodes

  // Uniforms for dynamic updates
  const brushPosUniform = uniform(vec2(brushPosition.x, brushPosition.y));
  const brushRadiusUniform = uniform(float(brushRadius));
  const brushActiveUniform = uniform(float(0)); // 0 = hidden, 1 = hovering, 2 = ready, 3 = active
  const timeUniform = uniform(float(0));

  // Height scale matching TerrainMaterialTSL
  const heightScale = 25;

  // Sample height including all field contributions
  const getDisplacedHeight = Fn(() => {
    const baseHeight = texture(heightMap, uv()).r;

    const soilHeight = soilMap ? texture(soilMap, uv()).r : float(0);
    const rockHeight = rockMap ? texture(rockMap, uv()).r : float(0);
    const lavaHeight = lavaMap ? texture(lavaMap, uv()).r : float(0);
    const fieldHeight = soilHeight.add(rockHeight).add(lavaHeight);

    return baseHeight.add(fieldHeight).mul(float(heightScale));
  });

  // Calculate world position with displacement
  const worldPos = Fn(() => {
    const localPos = positionLocal.xyz;
    const height = getDisplacedHeight();

    // Apply displacement to Y coordinate
    return vec3(
      localPos.x,
      height,
      localPos.z
    );
  });

  // Calculate distance from brush center in world space
  const distFromBrush = Fn(() => {
    const wp = worldPos();
    const brushWorldPos = vec3(brushPosUniform.x, wp.y, brushPosUniform.y);
    return length(wp.sub(brushWorldPos).xz);
  });

  // Create brush ring/circle effect
  const brushEffect = Fn(() => {
    const dist = distFromBrush();
    const radiusNorm = dist.div(brushRadiusUniform);

    // Ring effect - bright at edge, transparent in middle
    const ringWidth = float(0.1); // 10% of radius
    const innerEdge = float(1).sub(ringWidth);
    const ring = smoothstep(innerEdge, float(1), radiusNorm)
      .mul(smoothstep(float(1).add(ringWidth.mul(0.5)), float(1), radiusNorm));

    // Pulsing animation for active states
    const pulse = sin(timeUniform.mul(float(4))).mul(0.2).add(0.8);

    // Combine effects based on brush state
    const hoverAlpha = ring.mul(0.5);
    const readyAlpha = ring.mul(0.8).mul(pulse);
    const activeAlpha = ring.mul(pulse);

    // Select alpha based on state
    const stateAlpha = mix(
      hoverAlpha,
      mix(readyAlpha, activeAlpha, step(float(2.5), brushActiveUniform)),
      step(float(1.5), brushActiveUniform)
    );

    return stateAlpha.mul(step(float(0.5), brushActiveUniform)); // Only show if active > 0
  });

  // Material colors based on brush material type
  const getMaterialColor = Fn(() => {
    const soilColor = vec3(0.545, 0.411, 0.078); // Sandy brown
    const rockColor = vec3(0.35, 0.35, 0.35); // Dark gray
    const lavaColor = vec3(1.0, 0.3, 0.0); // Orange-red

    // For now, return soil color - can be extended with uniforms
    return brushMaterial === 'rock' ? rockColor :
           brushMaterial === 'lava' ? lavaColor : soilColor;
  });

  // Mode-based color modulation
  const modeColor = Fn(() => {
    const matColor = getMaterialColor();
    const pickupTint = vec3(0.2, 0.5, 1.0); // Blue tint for pickup
    const depositTint = vec3(1.0, 0.8, 0.2); // Yellow tint for deposit

    return brushMode === 'pickup' ?
      mix(matColor, pickupTint, float(0.3)) :
      mix(matColor, depositTint, float(0.3));
  });

  // Apply vertex displacement
  material.positionNode = worldPos();

  // Set up material properties
  material.colorNode = vec4(modeColor(), brushEffect());
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false; // Don't write to depth buffer for overlay
  material.metalness = 0.0;
  material.roughness = 0.7;

  // Store uniforms for external updates
  (material as any).uniforms = {
    brushPosition: brushPosUniform,
    brushRadius: brushRadiusUniform,
    brushActive: brushActiveUniform,
    time: timeUniform
  };

  return material;
}