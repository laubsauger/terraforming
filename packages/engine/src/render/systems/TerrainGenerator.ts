import * as THREE from 'three/webgpu';
import { TerrainConfig } from '@terraforming/types';

export interface TerrainGeneratorOptions {
  gridSize: number;
}

export class TerrainGenerator {
  private gridSize: number;

  constructor(options: TerrainGeneratorOptions) {
    this.gridSize = options.gridSize;
  }

  // Better hash function for noise
  private hash2(x: number, y: number): number {
    let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  // Smooth interpolation
  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // Extra smooth interpolation for critical areas
  private smootherstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Improved Perlin-like noise
  private noise2D(x: number, y: number, scale: number, octaves: number = 1): number {
    let value = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const sx = x * frequency;
      const sy = y * frequency;

      // Grid cell coordinates
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      // Interpolation weights
      const wx = sx - x0;
      const wy = sy - y0;

      // Random values at grid points
      const n00 = this.hash2(x0, y0);
      const n10 = this.hash2(x1, y0);
      const n01 = this.hash2(x0, y1);
      const n11 = this.hash2(x1, y1);

      // Bilinear interpolation
      const sx1 = this.smoothstep(0, 1, wx);
      const sy1 = this.smoothstep(0, 1, wy);

      const nx0 = n00 * (1 - sx1) + n10 * sx1;
      const nx1 = n01 * (1 - sx1) + n11 * sx1;
      const nxy = nx0 * (1 - sy1) + nx1 * sy1;

      value += nxy * amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }

    return value / maxValue;
  }

  // Ridge noise for mountain chains
  private ridgeNoise(x: number, y: number, scale: number, octaves: number = 1): number {
    let value = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const n = this.noise2D(x, y, frequency, 1);
      // Create ridges by inverting and taking absolute value
      const ridge = 1 - Math.abs(n * 2 - 1);
      value += ridge * ridge * amplitude;

      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.3;
    }

    return value / maxValue;
  }

  // Voronoi-like cellular noise for interesting features
  private cellularNoise(x: number, y: number, scale: number): number {
    const cellX = Math.floor(x * scale);
    const cellY = Math.floor(y * scale);

    let minDist = 1;
    let secondDist = 1;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = cellX + dx;
        const cy = cellY + dy;

        // Random point in cell
        const hash = Math.sin(cx * 127.3 + cy * 311.7) * 43758.5453;
        const px = cx + (hash - Math.floor(hash));
        const hash2 = Math.sin(hash * 127.3) * 43758.5453;
        const py = cy + (hash2 - Math.floor(hash2));

        const dist = Math.sqrt(Math.pow(x * scale - px, 2) + Math.pow(y * scale - py, 2));

        if (dist < minDist) {
          secondDist = minDist;
          minDist = dist;
        } else if (dist < secondDist) {
          secondDist = dist;
        }
      }
    }

    // Return difference for more interesting patterns
    return secondDist - minDist;
  }

  public generateTestTerrain(heightTexture: THREE.DataTexture): void {
    const size = this.gridSize;
    const data = heightTexture.image.data as Float32Array;

    // Debug: Track min/max heights
    let minHeight = 1.0;
    let maxHeight = 0.0;
    let belowWaterCount = 0;
    let totalCount = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Normalized coordinates (-1 to 1)
        const nx = (x / size) * 2 - 1;
        const ny = (y / size) * 2 - 1;

        // Distance from center with asymmetry
        const distX = nx * 1.1;
        const distY = ny * 0.9;
        const dist = Math.sqrt(distX * distX + distY * distY);

        // Create main island shape - adjusted for more land above water
        const shapeNoise = this.noise2D(nx * 0.5, ny * 0.5, 1.5, 2);
        // Larger island to ensure more terrain above water
        const islandShape = Math.max(0, 1 - dist * (0.8 + shapeNoise * 0.15));
        const islandNoise = this.noise2D(nx, ny, 2, 2);
        // Boost island mask to push more terrain above water threshold
        const islandMask = Math.pow(islandShape, 0.7) * (0.8 + islandNoise * 0.2);

        // Initialize height based on whether we're in island or ocean
        let height = 0;

        // For pure ocean areas (far from island), create varied ocean floor
        // Ocean should only be 15% of height range (0 to 0.15)
        if (islandMask < 0.01) {  // Only true ocean far from island
          const oceanNoise = this.noise2D(nx * 3, ny * 3, 6, 3);
          const deepNoise = this.noise2D(nx * 1.5, ny * 1.5, 3, 2);

          // Ocean varies from absolute floor (0) to just below sea level (0.15)
          // Most ocean should be deep (closer to 0) with some shallow areas
          const depthFactor = Math.pow(deepNoise * 0.5 + 0.5, 2); // Bias towards deeper

          // Ocean floor between 0 (deepest) and 0.14 (shallow)
          height = depthFactor * (TerrainConfig.SEA_LEVEL_NORMALIZED * 0.93);

          // Add subtle variation
          height += oceanNoise * 0.01;

          // Ensure we stay in ocean range
          height = Math.max(0.001, Math.min(height, TerrainConfig.SEA_LEVEL_NORMALIZED * 0.95));
        }

        if (islandMask > 0.01) {
          // CRITICAL: We want most terrain ABOVE water (0.15)
          // Only the edges should be underwater
          if (islandMask < 0.03) {
            // Very edge - deep water
            const progress = islandMask / 0.03;
            const smoothProgress = this.smootherstep(0, 1, progress);
            height = 0.02 + smoothProgress * (TerrainConfig.OCEAN_SHALLOW - 0.02);
          } else if (islandMask < 0.08) {
            // Shallow water to beach - quick transition through water
            const progress = (islandMask - 0.03) / 0.05;
            const smoothProgress = this.smootherstep(0, 1, progress);
            // Go from shallow ocean (0.12) to above water (0.16)
            height = TerrainConfig.OCEAN_SHALLOW + smoothProgress * (0.16 - TerrainConfig.OCEAN_SHALLOW);
          } else if (islandMask < 0.25) {
            // Coastal plains to grasslands - most common elevation
            const progress = (islandMask - 0.08) / 0.17;
            const smoothProgress = this.smootherstep(0, 1, progress);
            // Start at 0.16 (just above water) and go to grasslands
            height = 0.16 + smoothProgress * (TerrainConfig.GRASSLANDS - 0.16);
          } else if (islandMask < 0.5) {
            // Foothills to mountains - mid-range heights
            const progress = (islandMask - 0.25) / 0.25;
            const smoothProgress = this.smootherstep(0, 1, progress);
            height = TerrainConfig.GRASSLANDS + smoothProgress * (TerrainConfig.MOUNTAINS_LOW - TerrainConfig.GRASSLANDS);
          } else if (islandMask < 0.75) {
            // Mountains - significant elevation
            const progress = (islandMask - 0.5) / 0.25;
            const smoothProgress = this.smootherstep(0, 1, progress);
            height = TerrainConfig.MOUNTAINS_LOW + smoothProgress * (TerrainConfig.MOUNTAINS_HIGH - TerrainConfig.MOUNTAINS_LOW);
          } else {
            // Peaks - utilize full height range up to 1.0
            const progress = Math.min(1, (islandMask - 0.75) / 0.25);
            const smoothProgress = this.smootherstep(0, 1, progress);
            height = TerrainConfig.MOUNTAINS_HIGH + smoothProgress * (TerrainConfig.PEAKS - TerrainConfig.MOUNTAINS_HIGH);
          }

          // Add terrain features based on zones
          const cellNoise = this.cellularNoise(nx + 0.5, ny + 0.5, 5);

          // Completely reworked mountain system with no harsh cutoffs
          const mountainZone = Math.max(0, islandMask - 0.35);
          if (mountainZone > 0) {
            // Create smooth mountain distribution across the island
            const mountainNoise = this.noise2D(nx * 0.8, ny * 0.8, 2, 3);
            const ridgeStrength = mountainNoise * 0.5 + 0.5; // 0 to 1

            // Multiple mountain ridges with smooth falloff
            const ridge1 = this.ridgeNoise(nx * 1.0 + 0.1, ny * 1.0 + 0.2, 3, 2);
            const ridge2 = this.ridgeNoise(nx * 0.8 - 0.1, ny * 0.8 - 0.1, 4, 2);
            const ridge3 = this.ridgeNoise(nx * 1.2 + 0.2, ny * 1.2 + 0.3, 2, 3);

            // Combine ridges with varying strengths
            const combinedRidges = (ridge1 * 0.4 + ridge2 * 0.3 + ridge3 * 0.3) * ridgeStrength;

            // Create multiple peaks with smooth transitions
            const peak1 = Math.exp(-((nx - 0.1) * (nx - 0.1) + (ny - 0.15) * (ny - 0.15)) * 8);
            const peak2 = Math.exp(-((nx + 0.15) * (nx + 0.15) + (ny + 0.05) * (ny + 0.05)) * 10);
            const peak3 = Math.exp(-((nx - 0.2) * (nx - 0.2) + (ny - 0.3) * (ny - 0.3)) * 6);
            const peak4 = Math.exp(-((nx + 0.05) * (nx + 0.05) + (ny - 0.25) * (ny - 0.25)) * 9);

            // Smooth peak distribution
            const peakFactor = this.noise2D(nx * 2, ny * 2, 3, 2) * 0.3 + 0.7;
            const allPeaks = (peak1 + peak2 * 0.8 + peak3 * 0.6 + peak4 * 0.7) * peakFactor;

            // Combine mountains with very smooth transitions - scale up to use full range
            // Increase multipliers to ensure we can reach close to 1.0
            const mountainHeight = (combinedRidges * 0.6 + allPeaks * 0.8) * mountainZone * 1.5;

            // Apply ultra-smooth transition based on distance from center
            const centerDist = Math.sqrt(nx * nx + ny * ny);
            const falloffFactor = this.smootherstep(0.8, 0.3, centerDist);

            // Add mountain height, potentially pushing terrain to full height (1.0)
            height = Math.min(1.0, height + mountainHeight * falloffFactor);

            // Add subtle rocky texture only on steep areas
            const steepness = mountainHeight * falloffFactor;
            if (cellNoise > 0.3 && steepness > 0.1) {
              height += cellNoise * steepness * 0.02;
            }
          }

          // Create flat meadow areas and plateaus
          const meadowZone1 = islandMask > 0.25 && islandMask < 0.4 &&
                             Math.abs(nx + 0.2) < 0.3 && Math.abs(ny + 0.1) < 0.2;
          const meadowZone2 = islandMask > 0.3 && islandMask < 0.45 &&
                             Math.abs(nx - 0.25) < 0.2 && Math.abs(ny + 0.3) < 0.15;

          if (meadowZone1 || meadowZone2) {
            // Flatten these areas for meadows with slight undulation
            const meadowBase = meadowZone1 ? TerrainConfig.GRASSLANDS : TerrainConfig.FOOTHILLS;
            const gentleNoise = this.noise2D(nx * 8, ny * 8, 15, 1);
            height = meadowBase + gentleNoise * 0.015;
          }

          // Create organic lagoon with varied depth
          const lagoonX = 0.15;
          const lagoonY = -0.05;
          const lagoonDist = Math.sqrt(Math.pow(nx - lagoonX, 2) + Math.pow(ny - lagoonY, 2));
          const lagoonAngle = Math.atan2(ny - lagoonY, nx - lagoonX);
          const lagoonRadius = 0.12 + Math.sin(lagoonAngle * 2.5) * 0.04 + Math.cos(lagoonAngle * 4) * 0.02;

          if (lagoonDist < lagoonRadius && islandMask > 0.15) {
            const lagoonDepth = this.smoothstep(lagoonRadius, 0, lagoonDist);
            const depthVariation = this.noise2D(nx * 10, ny * 10, 20, 1);
            height -= lagoonDepth * (0.06 + depthVariation * 0.02);

            // Ensure lagoon stays slightly below water but not too deep
            height = Math.max(height, TerrainConfig.OCEAN_MID);
            height = Math.min(height, TerrainConfig.UNDERWATER_BEACH);  // Keep it as a shallow lagoon
          }

          // Gentler elevated areas instead of harsh cliffs
          if (nx < -0.2 && islandMask > 0.3) {
            const elevationStrength = this.smootherstep(-0.2, -0.5, nx);
            const elevationNoise = this.noise2D(ny * 3, nx * 3, 6, 2);

            // Gentle elevation increase
            if (elevationStrength > 0.05) {
              const additionalHeight = elevationStrength * (0.08 + elevationNoise * 0.03);
              height += additionalHeight * this.smootherstep(0.05, 0.3, elevationStrength);
            }
          }

          // Add erosion-like details
          const erosionNoise = this.noise2D(nx * 12, ny * 12, 25, 3);
          const erosionStrength = Math.max(0, islandMask - 0.2) * (1 - mountainZone);
          height += erosionNoise * 0.015 * erosionStrength;

          // Create river valleys
          const valley1 = Math.exp(-Math.pow((nx - ny * 0.3 + 0.1), 2) * 30) * islandMask;
          const valley2 = Math.exp(-Math.pow((nx * 0.5 + ny - 0.2), 2) * 25) * islandMask;

          if ((valley1 > 0.1 || valley2 > 0.1) && height > TerrainConfig.COASTAL_PLAINS) {
            const valleyDepth = Math.max(valley1, valley2);
            height -= valleyDepth * 0.04;
            height = Math.max(height, TerrainConfig.BEACH_HIGH);  // Don't go below beach level
          }
        }

        // Small island in front of camera view (southeast from new camera position)
        const frontIslandX = -0.3;
        const frontIslandY = -0.4;
        const frontIslandDist = Math.sqrt(Math.pow(nx - frontIslandX, 2) + Math.pow(ny - frontIslandY, 2));
        if (frontIslandDist < 0.12) {
          const islandFactor = Math.pow(1 - frontIslandDist / 0.12, 1.5);
          const islandNoise = this.noise2D((nx - frontIslandX) * 8, (ny - frontIslandY) * 8, 6, 2);
          const islandHeight = TerrainConfig.BEACH_DRY + islandFactor * (0.10 + islandNoise * 0.05);
          // Smooth transition to avoid harsh edges
          const smoothFactor = this.smootherstep(0.1, 0.12, frontIslandDist);
          const finalHeight = islandHeight * (1 - smoothFactor);
          height = Math.max(height, finalHeight);
        }

        // Sandy atoll chain to the southwest
        const atoll1X = -0.45;
        const atoll1Y = -0.2;
        const atoll2X = -0.38;
        const atoll2Y = -0.32;

        const atoll1Dist = Math.sqrt(Math.pow(nx - atoll1X, 2) + Math.pow(ny - atoll1Y, 2));
        const atoll2Dist = Math.sqrt(Math.pow(nx - atoll2X, 2) + Math.pow(ny - atoll2Y, 2));

        if (atoll1Dist < 0.06) {
          const atollFactor = this.smoothstep(0.06, 0, atoll1Dist);
          const sandNoise = this.noise2D(nx * 15, ny * 15, 30, 1);
          height = Math.max(height, TerrainConfig.BEACH_WATER_LINE - 0.005 + atollFactor * 0.025 + sandNoise * 0.005);
        }

        if (atoll2Dist < 0.05) {
          const atollFactor = this.smoothstep(0.05, 0, atoll2Dist);
          height = Math.max(height, TerrainConfig.BEACH_WATER_LINE - 0.002 + atollFactor * 0.022);
        }

        // Add ocean features like ridges and trenches
        if (islandMask < 0.01 && height < TerrainConfig.SEA_LEVEL_NORMALIZED) {
          const underwaterRidge = this.ridgeNoise(nx * 2, ny * 2, 5, 2);

          // Add underwater ridges
          if (underwaterRidge > 0.6) {
            height += underwaterRidge * 0.2 * TerrainConfig.SEA_LEVEL_NORMALIZED;
          }

          // Deep ocean trenches - make them more prominent
          const trenchX = Math.sin(ny * 3) * 0.1;
          const trenchDist = Math.abs(nx - 0.7 - trenchX);
          if (trenchDist < 0.08 && dist > 0.5) {
            // Create deep trenches that go down to 0
            const trenchDepth = this.smoothstep(0.08, 0, trenchDist);
            height = height * (1 - trenchDepth) + (TerrainConfig.OCEAN_FLOOR + Math.random() * 0.02) * trenchDepth;
          }

          // Add another trench for variety
          const trench2Y = Math.cos(nx * 2.5) * 0.1;
          const trench2Dist = Math.abs(ny - 0.6 - trench2Y);
          if (trench2Dist < 0.06 && dist > 0.4) {
            const trenchDepth = this.smoothstep(0.06, 0, trench2Dist);
            height = height * (1 - trenchDepth) + (TerrainConfig.OCEAN_FLOOR + Math.random() * 0.015) * trenchDepth;
          }

          // Clamp to valid ocean range
          height = Math.max(TerrainConfig.OCEAN_FLOOR, Math.min(height, TerrainConfig.SEA_LEVEL_NORMALIZED * 0.95));
        }

        // Final clamping
        height = Math.max(0, Math.min(1, height));

        // Track statistics
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        if (height < TerrainConfig.SEA_LEVEL_NORMALIZED) {
          belowWaterCount++;
        }
        totalCount++;

        // Set all channels to the same height value
        data[idx] = height;
        data[idx + 1] = height;
        data[idx + 2] = height;
        data[idx + 3] = 1;
      }
    }

    // Apply smoothing pass to eliminate rough edges
    this.applySmoothingPass(data, size);

    // Debug output
    const waterPercentage = (belowWaterCount / totalCount) * 100;
    console.log(`Terrain Generation Stats (updated):
      Min Height: ${minHeight.toFixed(4)} (${(minHeight * 64).toFixed(2)}m)
      Max Height: ${maxHeight.toFixed(4)} (${(maxHeight * 64).toFixed(2)}m)
      Sea Level: ${TerrainConfig.SEA_LEVEL_NORMALIZED} (${TerrainConfig.WATER_LEVEL_ABSOLUTE}m)
      Below Water: ${waterPercentage.toFixed(1)}% of terrain
      Ocean should be: ${(TerrainConfig.SEA_LEVEL_NORMALIZED * 100).toFixed(1)}% of height range`);

    heightTexture.needsUpdate = true;
  }

  private applySmoothingPass(data: Float32Array, size: number): void {
    const smoothedData = new Float32Array(size * size * 4);

    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = (y * size + x) * 4;

        // Sample surrounding heights
        const center = data[idx];
        const neighbors = [
          data[((y-1) * size + x) * 4],     // top
          data[((y+1) * size + x) * 4],     // bottom
          data[(y * size + (x-1)) * 4],     // left
          data[(y * size + (x+1)) * 4],     // right
          data[((y-1) * size + (x-1)) * 4], // top-left
          data[((y-1) * size + (x+1)) * 4], // top-right
          data[((y+1) * size + (x-1)) * 4], // bottom-left
          data[((y+1) * size + (x+1)) * 4]  // bottom-right
        ];

        // Weighted average for smoothing - heavier weight on center
        let smoothedHeight = center * 0.5;
        for (let i = 0; i < 8; i++) {
          smoothedHeight += neighbors[i] * 0.0625; // 0.5/8
        }

        // Apply targeted smoothing to eliminate harsh edges
        const nx = (x / size) * 2 - 1;
        const ny = (y / size) * 2 - 1;
        const dist = Math.sqrt(nx * nx + ny * ny);

        // Check for large height differences with neighbors that indicate harsh edges
        let maxDiff = 0;
        for (const neighbor of neighbors) {
          maxDiff = Math.max(maxDiff, Math.abs(center - neighbor));
        }

        // Only smooth areas with significant height differences (harsh edges)
        if (maxDiff > 0.02 && center > TerrainConfig.OCEAN_SHALLOW && center < TerrainConfig.MOUNTAINS_HIGH && dist < 1.0) {
          // Smooth more aggressively where harsh edges are detected
          const smoothingFactor = Math.min(maxDiff * 10, 0.8); // 0 to 0.8
          smoothedHeight = center * (1 - smoothingFactor) + smoothedHeight * smoothingFactor;
        }

        smoothedData[idx] = smoothedHeight;
        smoothedData[idx + 1] = smoothedHeight;
        smoothedData[idx + 2] = smoothedHeight;
        smoothedData[idx + 3] = 1;
      }
    }

    // Copy smoothed data back, preserving edges
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = (y * size + x) * 4;
        data[idx] = smoothedData[idx];
        data[idx + 1] = smoothedData[idx + 1];
        data[idx + 2] = smoothedData[idx + 2];
        data[idx + 3] = smoothedData[idx + 3];
      }
    }
  }
}