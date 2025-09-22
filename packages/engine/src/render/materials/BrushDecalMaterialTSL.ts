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
  positionWorld,
  positionLocal,
  varyingProperty,
  min,
  max,
  mix,
  smoothstep,
  sin,
  abs,
  length,
  clamp
} from 'three/tsl';

interface BrushDecalMaterialOptions {
  brushPosition?: THREE.Vector2;
  brushRadius?: number;
  brushMode?: 'pickup' | 'deposit';
  brushMaterial?: 'soil' | 'rock' | 'lava';
  brushState?: number; // 0 = hidden, 1 = hovering, 2 = ready, 3 = active
}

export function createBrushDecalMaterialTSL(options: BrushDecalMaterialOptions = {}): any {
  const {
    brushPosition = new THREE.Vector2(0, 0),
    brushRadius = 5,
    brushMode = 'pickup',
    brushMaterial = 'soil',
    brushState = 0
  } = options;

  const material = (THREE as any).MeshStandardNodeMaterial ? new (THREE as any).MeshStandardNodeMaterial() : new THREE.MeshStandardMaterial();

  // Uniforms for dynamic updates
  const brushPosUniform = uniform(vec2(brushPosition.x, brushPosition.y));
  const brushRadiusUniform = uniform(float(brushRadius));
  const brushStateUniform = uniform(float(brushState));
  const timeUniform = uniform(float(0));
  const brushModeUniform = uniform(float(brushMode === 'pickup' ? 0 : 1));
  const brushMatUniform = uniform(float(brushMaterial === 'soil' ? 0 : brushMaterial === 'rock' ? 1 : 2));

  // Calculate distance from brush center in world space
  const distFromBrush = Fn(() => {
    const worldXZ = positionWorld.xz;
    const brushWorldPos = brushPosUniform;
    return length(worldXZ.sub(brushWorldPos));
  });

  // Create brush ring effect
  const brushRing = Fn(() => {
    const dist = distFromBrush();
    const radiusNorm = dist.div(brushRadiusUniform);

    // Ring effect - bright at edge, fading inward
    const ringWidth = float(0.15); // 15% of radius for ring thickness
    const innerRadius = float(1).sub(ringWidth);

    // Smooth ring with falloff
    const outerFalloff = smoothstep(float(1).add(ringWidth.mul(0.3)), float(1), radiusNorm);
    const innerFalloff = smoothstep(innerRadius.sub(ringWidth.mul(0.3)), innerRadius, radiusNorm);
    const ring = min(outerFalloff, float(1).sub(innerFalloff));

    // Add inner gradient for deposit mode
    const innerGradient = smoothstep(float(0), float(0.8), radiusNorm).mul(0.2);
    const depositFill = mix(float(0), innerGradient, brushModeUniform);

    return max(ring, depositFill);
  });

  // Pulsing animation
  const pulse = Fn(() => {
    const baseSpeed = float(3);
    const speed = mix(baseSpeed, baseSpeed.mul(2), brushStateUniform.div(3));
    return sin(timeUniform.mul(speed)).mul(0.15).add(0.85);
  });

  // Get material color based on type
  const getMaterialColor = Fn(() => {
    const soilColor = vec3(0.65, 0.5, 0.2);
    const rockColor = vec3(0.4, 0.4, 0.45);
    const lavaColor = vec3(1.0, 0.4, 0.1);

    return mix(
      mix(soilColor, rockColor, clamp(brushMatUniform, float(0), float(1))),
      lavaColor,
      clamp(brushMatUniform.sub(1), float(0), float(1))
    );
  });

  // Mode-based color modulation
  const getFinalColor = Fn(() => {
    const matColor = getMaterialColor();

    // Pickup mode: blue tint
    const pickupColor = mix(matColor, vec3(0.3, 0.6, 1.0), float(0.5));
    // Deposit mode: warm yellow tint
    const depositColor = mix(matColor, vec3(1.0, 0.9, 0.4), float(0.3));

    return mix(pickupColor, depositColor, brushModeUniform);
  });

  // Calculate final alpha
  const finalAlpha = Fn(() => {
    const ring = brushRing();
    const pulseMod = pulse();

    // Different alpha levels for each state
    const hoverAlpha = ring.mul(0.4);
    const readyAlpha = ring.mul(0.6).mul(pulseMod);
    const activeAlpha = ring.mul(0.9).mul(pulseMod);

    // Blend between states
    const alpha = mix(
      hoverAlpha,
      mix(readyAlpha, activeAlpha, smoothstep(float(2.5), float(3), brushStateUniform)),
      smoothstep(float(1.5), float(2), brushStateUniform)
    );

    // Only show if state > 0.5
    return alpha.mul(smoothstep(float(0), float(0.5), brushStateUniform));
  });

  // Set up material
  material.colorNode = vec4(getFinalColor(), finalAlpha());
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.depthTest = true;

  // Store uniforms for external updates
  (material as any).brushUniforms = {
    position: brushPosUniform,
    radius: brushRadiusUniform,
    state: brushStateUniform,
    time: timeUniform,
    mode: brushModeUniform,
    material: brushMatUniform
  };

  return material;
}