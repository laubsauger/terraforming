import * as THREE from 'three/webgpu';
import {
  vec2,
  vec3,
  vec4,
  float,
  texture,
  uv,
  normalize,
  abs,
  positionLocal
} from 'three/tsl';

export interface NormalVisualizationOptions {
  heightTexture: THREE.Texture;
  heightScale?: number;
  terrainSize?: number;
  gridSize?: number;
}

/**
 * Creates a material that visualizes terrain normals as colors
 * Red = X component, Green = Y component, Blue = Z component
 */
export function createNormalVisualizationMaterial(options: NormalVisualizationOptions): THREE.MeshBasicNodeMaterial {
  const {
    heightTexture,
    heightScale = 50,
    terrainSize = 100,
    gridSize = 256
  } = options;

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: false
  });

  const uvCoords = uv();

  // Calculate normals from height map using Sobel filter
  const texelSize = float(1.0 / gridSize);

  // Sample heights at neighboring points for Sobel filter
  const h00 = texture(heightTexture, uvCoords.add(vec2(texelSize.mul(-1), texelSize.mul(-1)))).r.mul(float(heightScale));
  const h10 = texture(heightTexture, uvCoords.add(vec2(texelSize.mul(0), texelSize.mul(-1)))).r.mul(float(heightScale));
  const h20 = texture(heightTexture, uvCoords.add(vec2(texelSize, texelSize.mul(-1)))).r.mul(float(heightScale));
  const h01 = texture(heightTexture, uvCoords.add(vec2(texelSize.mul(-1), texelSize.mul(0)))).r.mul(float(heightScale));
  const h11 = texture(heightTexture, uvCoords).r.mul(float(heightScale));
  const h21 = texture(heightTexture, uvCoords.add(vec2(texelSize, texelSize.mul(0)))).r.mul(float(heightScale));
  const h02 = texture(heightTexture, uvCoords.add(vec2(texelSize.mul(-1), texelSize))).r.mul(float(heightScale));
  const h12 = texture(heightTexture, uvCoords.add(vec2(texelSize.mul(0), texelSize))).r.mul(float(heightScale));
  const h22 = texture(heightTexture, uvCoords.add(vec2(texelSize, texelSize))).r.mul(float(heightScale));

  // Sobel filter for gradient estimation
  const sobelX = h00.mul(-1).add(h20).add(h01.mul(-2)).add(h21.mul(2)).add(h02.mul(-1)).add(h22);
  const sobelY = h00.mul(-1).add(h02).add(h10.mul(-2)).add(h12.mul(2)).add(h20.mul(-1)).add(h22);

  // Calculate normal for Y-up coordinate system
  const worldStep = float(terrainSize).mul(texelSize);
  const gradientScale = worldStep.mul(2);

  // For Y-up system after rotation: Normal = (-dh/dx, 1, -dh/dy)
  const nx = sobelX.div(gradientScale).mul(-1);
  const ny = float(1);
  const nz = sobelY.div(gradientScale).mul(-1);

  const normalRaw = vec3(nx, ny, nz);
  const normal = normalize(normalRaw);

  // Map normal components to RGB colors
  // Convert from [-1, 1] range to [0, 1] for visualization
  // Standard normal map visualization: R=X, G=Y, B=Z
  const visualColor = vec3(
    normal.x.mul(0.5).add(0.5),  // Red for X: -1 to 1 → 0 to 1
    normal.y.mul(0.5).add(0.5),  // Green for Y: -1 to 1 → 0 to 1 (though Y is mostly positive)
    normal.z.mul(0.5).add(0.5)   // Blue for Z: -1 to 1 → 0 to 1
  );

  material.colorNode = vec4(visualColor, float(1));

  // Apply height displacement
  const heightSample = texture(heightTexture, uvCoords).r;
  const displacement = heightSample.mul(float(heightScale));

  // Offset slightly above terrain to avoid z-fighting
  const offset = float(0.1);
  material.positionNode = positionLocal.add(vec3(float(0), displacement.add(offset), float(0)));

  return material;
}