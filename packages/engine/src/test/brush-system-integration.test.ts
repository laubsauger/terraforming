import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainConfig } from '@terraforming/types';

/**
 * This test replicates the actual issue where the brush system
 * allows digging below the generated terrain's 0 point.
 *
 * The problem: Terrain generates correctly with ocean floor at 0m,
 * but brush tools can dig to -0.5 or -1.0 (in normalized units).
 */

// Simulate the actual brush system field initialization
class BrushSystemFields {
  private rockField: Float32Array;
  private soilField: Float32Array;
  private size: number;

  constructor(size: number = 256) {
    this.size = size;
    this.rockField = new Float32Array(size * size);
    this.soilField = new Float32Array(size * size);
  }

  // This simulates TerrainRenderer.initializeBrushSystemWithTerrain()
  initializeFromTerrain(heightData: Float32Array) {
    for (let i = 0; i < this.size * this.size; i++) {
      const heightNormalized = heightData[i]; // 0-1
      const heightMeters = heightNormalized * TerrainConfig.HEIGHT_SCALE;
      const waterLevelMeters = TerrainConfig.WATER_LEVEL_ABSOLUTE;

      // This is how TerrainRenderer splits rock/soil
      if (heightMeters > waterLevelMeters) {
        // Above water: most is rock with thin soil layer
        const soilDepth = Math.min(2.0, (heightMeters - waterLevelMeters) * 0.2);
        this.rockField[i] = heightMeters - soilDepth;
        this.soilField[i] = soilDepth;
      } else {
        // Below water: all rock, no soil
        this.rockField[i] = heightMeters;
        this.soilField[i] = 0;
      }
    }
  }

  // Simulate brush pickup operation (digging)
  applyPickup(index: number, amountMeters: number): number {
    const currentSoil = this.soilField[index];
    const currentRock = this.rockField[index];
    const totalHeight = currentSoil + currentRock;

    // First try to remove soil
    if (currentSoil > 0) {
      const soilToRemove = Math.min(currentSoil, amountMeters);
      this.soilField[index] -= soilToRemove;
      return totalHeight - soilToRemove;
    }

    // Then remove rock if no soil left
    const rockToRemove = Math.min(currentRock, amountMeters);
    this.rockField[index] -= rockToRemove;

    return this.soilField[index] + this.rockField[index];
  }

  getTotalHeightAt(index: number): number {
    return this.rockField[index] + this.soilField[index];
  }

  getRockAt(index: number): number {
    return this.rockField[index];
  }

  getSoilAt(index: number): number {
    return this.soilField[index];
  }
}

describe('Brush System Integration - Digging Below Zero Issue', () => {
  let fields: BrushSystemFields;
  let terrainHeights: Float32Array;

  beforeEach(() => {
    fields = new BrushSystemFields(256);
    terrainHeights = new Float32Array(256 * 256);
  });

  describe('Reproducing the actual issue', () => {
    it('should NOT allow digging below ocean floor (0m) but currently does', () => {
      // Setup: Create terrain at shallow ocean depth
      const testIdx = 100;
      terrainHeights[testIdx] = 0.05; // 3.2m depth (below water)
      fields.initializeFromTerrain(terrainHeights);

      // Initial state: all rock, no soil (underwater)
      expect(fields.getSoilAt(testIdx)).toBe(0);
      expect(fields.getRockAt(testIdx)).toBeCloseTo(3.2);
      expect(fields.getTotalHeightAt(testIdx)).toBeCloseTo(3.2);

      // Try to dig 5 meters down
      let newHeight = fields.applyPickup(testIdx, 5);

      // ACTUAL ISSUE: This goes negative!
      expect(newHeight).toBeCloseTo(-1.8); // 3.2 - 5 = -1.8m

      // This is the problem - we can dig below 0
      expect(fields.getRockAt(testIdx)).toBeCloseTo(-1.8);

      // THIS TEST CURRENTLY SHOWS THE BUG:
      // We should never have negative heights, but we do!
    });

    it('demonstrates the normalized coordinate issue', () => {
      // When height is 0.05 normalized (3.2m), and we remove all of it
      // plus more, we get negative values
      const testIdx = 100;
      terrainHeights[testIdx] = 0.01; // 0.64m - very shallow
      fields.initializeFromTerrain(terrainHeights);

      // Remove 2 meters worth
      const newHeight = fields.applyPickup(testIdx, 2);

      // This goes negative in normalized space
      const normalizedHeight = newHeight / TerrainConfig.HEIGHT_SCALE;

      expect(normalizedHeight).toBeLessThan(0); // Bug: goes below 0!
      expect(normalizedHeight).toBeCloseTo(-0.021875); // -1.36 / 64
    });
  });

  describe('What the fix should enforce', () => {
    it('should clamp to ocean floor (0m) when digging', () => {
      const testIdx = 100;
      terrainHeights[testIdx] = 0.05; // 3.2m depth
      fields.initializeFromTerrain(terrainHeights);

      // This is what ApplyDeltas.wgsl SHOULD do:
      let newHeight = fields.applyPickup(testIdx, 5);

      // Fix: Clamp to ocean floor
      if (newHeight < 0) {
        // Add the deficit back to rock
        const deficit = 0 - newHeight;
        fields.rockField[testIdx] += deficit;
        newHeight = 0;
      }

      expect(newHeight).toBe(0); // Should be clamped
      expect(fields.getTotalHeightAt(testIdx)).toBe(0); // Total should be 0
      expect(fields.getRockAt(testIdx)).toBeGreaterThanOrEqual(0); // No negative rock
    });

    it('should maintain the 15/85 height distribution', () => {
      // Ocean floor to sea level: 0-9.6m (15% of 64m)
      // Sea level to peak: 9.6-64m (85% of 64m)

      const oceanDepthRange = TerrainConfig.WATER_LEVEL_ABSOLUTE;
      const landHeightRange = TerrainConfig.HEIGHT_SCALE - TerrainConfig.WATER_LEVEL_ABSOLUTE;

      expect(oceanDepthRange).toBeCloseTo(9.6);
      expect(landHeightRange).toBeCloseTo(54.4);

      // The issue is that by allowing negative values,
      // we're effectively making the ocean range much larger
      // than the intended 15%!
    });
  });

  describe('Rock/Soil split initialization issues', () => {
    it('should properly initialize underwater terrain', () => {
      // Underwater terrain should be all rock, no soil
      const testIdx = 100;
      terrainHeights[testIdx] = 0.1; // 6.4m depth (underwater)
      fields.initializeFromTerrain(terrainHeights);

      expect(fields.getSoilAt(testIdx)).toBe(0);
      expect(fields.getRockAt(testIdx)).toBeCloseTo(6.4);
      expect(fields.getTotalHeightAt(testIdx)).toBeCloseTo(6.4);
    });

    it('should properly initialize above-water terrain', () => {
      // Above water should have mostly rock with thin soil layer
      const testIdx = 100;
      terrainHeights[testIdx] = 0.3; // 19.2m (above water)
      fields.initializeFromTerrain(terrainHeights);

      const heightMeters = 19.2;
      const aboveWater = heightMeters - TerrainConfig.WATER_LEVEL_ABSOLUTE;
      const expectedSoil = Math.min(2.0, aboveWater * 0.2);

      expect(fields.getSoilAt(testIdx)).toBeCloseTo(expectedSoil);
      expect(fields.getRockAt(testIdx)).toBeCloseTo(heightMeters - expectedSoil);
      expect(fields.getTotalHeightAt(testIdx)).toBeCloseTo(19.2);
    });
  });
});