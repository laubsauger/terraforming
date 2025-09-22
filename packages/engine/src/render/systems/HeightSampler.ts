import * as THREE from 'three/webgpu';
import type { BrushSystem } from '../../sim/BrushSystem';

export interface HeightSamplerOptions {
  terrainSize: number;
  gridSize: number;
  heightScale: number;
  heightTexture: THREE.DataTexture;
}

export class HeightSampler {
  private terrainSize: number;
  private gridSize: number;
  private heightScale: number;
  private heightTexture: THREE.DataTexture;
  private brushSystem?: BrushSystem;

  constructor(options: HeightSamplerOptions) {
    this.terrainSize = options.terrainSize;
    this.gridSize = options.gridSize;
    this.heightScale = options.heightScale;
    this.heightTexture = options.heightTexture;
  }

  public setBrushSystem(brushSystem: BrushSystem): void {
    this.brushSystem = brushSystem;
  }

  /**
   * Get height at world coordinates by sampling height texture and field textures
   */
  public getHeightAtWorldPos(worldX: number, worldZ: number): number {
    // Convert world coordinates to texture coordinates
    const halfSize = this.terrainSize / 2;
    const u = (worldX + halfSize) / this.terrainSize;
    const v = (worldZ + halfSize) / this.terrainSize;

    // Clamp to texture bounds
    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));

    // Sample from height texture
    const textureSize = this.gridSize;
    const x = Math.floor(clampedU * (textureSize - 1));
    const y = Math.floor(clampedV * (textureSize - 1));

    const data = this.heightTexture.image.data as Float32Array;
    const index = (y * textureSize + x) * 4; // RGBA format
    const baseHeight = data[index]; // Height is stored in R channel

    // Get field heights if brush system is available
    let fieldHeight = 0;
    if (this.brushSystem) {
      // Note: In a real implementation, we'd need to read from GPU textures
      // For now, fields are rendered via displacement in the shader
      // This is an approximation but better than ignoring fields entirely
      fieldHeight = 0; // Fields contribute additional height on top of base
    }

    // Apply height scale (matching the TerrainMaterialTSL)
    const totalHeight = baseHeight + fieldHeight;
    return totalHeight * this.heightScale;
  }

  /**
   * Get the highest point within a radius from a world position
   */
  public getHighestPointInRadius(worldX: number, worldZ: number, radius: number): number {
    // Sample multiple points in the radius to find highest
    let maxHeight = this.getHeightAtWorldPos(worldX, worldZ);

    // Sample in concentric circles
    for (let r = 0; r <= radius; r += radius / 4) {
      const angleSamples = Math.max(8, Math.floor(r * 8 / radius));
      for (let i = 0; i < angleSamples; i++) {
        const angle = (i / angleSamples) * Math.PI * 2;
        const sampleX = worldX + Math.cos(angle) * r;
        const sampleZ = worldZ + Math.sin(angle) * r;
        const height = this.getHeightAtWorldPos(sampleX, sampleZ);
        if (height > maxHeight) {
          maxHeight = height;
        }
      }
    }

    return maxHeight;
  }

  /**
   * Get normal at world position by sampling neighboring heights
   */
  public getNormalAtWorldPos(worldX: number, worldZ: number): THREE.Vector3 {
    const epsilon = this.terrainSize / this.gridSize; // One texel distance

    // Sample heights at neighboring points
    const heightCenter = this.getHeightAtWorldPos(worldX, worldZ);
    const heightLeft = this.getHeightAtWorldPos(worldX - epsilon, worldZ);
    const heightRight = this.getHeightAtWorldPos(worldX + epsilon, worldZ);
    const heightBack = this.getHeightAtWorldPos(worldX, worldZ - epsilon);
    const heightFront = this.getHeightAtWorldPos(worldX, worldZ + epsilon);

    // Calculate gradients
    const dx = (heightRight - heightLeft) / (2 * epsilon);
    const dz = (heightFront - heightBack) / (2 * epsilon);

    // Normal is perpendicular to the gradient
    const normal = new THREE.Vector3(-dx, 1, -dz);
    normal.normalize();

    return normal;
  }

  /**
   * Get slope angle at world position in degrees
   */
  public getSlopeAtWorldPos(worldX: number, worldZ: number): number {
    const normal = this.getNormalAtWorldPos(worldX, worldZ);

    // Calculate angle from vertical (y-axis)
    const dotProduct = normal.dot(new THREE.Vector3(0, 1, 0));
    const angleRadians = Math.acos(Math.min(1, Math.max(-1, dotProduct)));
    const angleDegrees = angleRadians * (180 / Math.PI);

    return angleDegrees;
  }

  /**
   * Update the height texture reference (when textures are recreated)
   */
  public updateHeightTexture(heightTexture: THREE.DataTexture): void {
    this.heightTexture = heightTexture;
  }
}