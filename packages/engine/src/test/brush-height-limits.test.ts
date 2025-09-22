import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainConfig } from '@terraforming/types';

// Mock terrain heights for testing
class MockTerrain {
  private heights: Float32Array;
  private size: number;

  constructor(size: number = 256) {
    this.size = size;
    this.heights = new Float32Array(size * size);
  }

  setHeightAt(x: number, y: number, heightNormalized: number) {
    const idx = y * this.size + x;
    this.heights[idx] = heightNormalized;
  }

  getHeightAt(x: number, y: number): number {
    const idx = y * this.size + x;
    return this.heights[idx];
  }

  getHeightMetersAt(x: number, y: number): number {
    return this.getHeightAt(x, y) * TerrainConfig.HEIGHT_SCALE;
  }

  // Simulate brush operation constraints
  applyBrushOp(x: number, y: number, deltaMeters: number): number {
    const currentHeight = this.getHeightMetersAt(x, y);
    let newHeight = currentHeight + deltaMeters;

    // Enforce height limits (this simulates what ApplyDeltas.wgsl should do)
    if (newHeight < 0) {
      newHeight = 0; // Ocean floor is absolute minimum
    }
    if (newHeight > TerrainConfig.HEIGHT_SCALE) {
      newHeight = TerrainConfig.HEIGHT_SCALE; // Peak is absolute maximum
    }

    const newHeightNormalized = newHeight / TerrainConfig.HEIGHT_SCALE;
    this.setHeightAt(x, y, newHeightNormalized);
    return newHeight;
  }
}

describe('Brush System Height Limits', () => {
  let terrain: MockTerrain;

  beforeEach(() => {
    terrain = new MockTerrain();
  });

  describe('Ocean Floor Limit', () => {
    it('should not allow digging below ocean floor (0m)', () => {
      // Start at shallow water
      terrain.setHeightAt(10, 10, 0.05); // 3.2m depth

      // Try to dig down by 10m
      const newHeight = terrain.applyBrushOp(10, 10, -10);

      expect(newHeight).toBe(0); // Should be clamped to ocean floor
      expect(terrain.getHeightMetersAt(10, 10)).toBe(0);
    });

    it('should allow digging exactly to ocean floor', () => {
      // Start at beach level
      terrain.setHeightAt(10, 10, 0.16); // Just above water

      // Dig down to ocean floor
      const newHeight = terrain.applyBrushOp(10, 10, -10.24); // 0.16 * 64 = 10.24m

      expect(newHeight).toBe(0);
      expect(terrain.getHeightMetersAt(10, 10)).toBe(0);
    });

    it('should not allow any negative heights', () => {
      terrain.setHeightAt(10, 10, 0.01);

      // Try to dig way below ocean floor
      const newHeight = terrain.applyBrushOp(10, 10, -100);

      expect(newHeight).toBe(0);
      expect(newHeight).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Peak Height Limit', () => {
    it('should not allow building above peak (64m)', () => {
      // Start at high mountain
      terrain.setHeightAt(10, 10, 0.9); // 57.6m

      // Try to add 20m
      const newHeight = terrain.applyBrushOp(10, 10, 20);

      expect(newHeight).toBe(64); // Should be clamped to peak
      expect(terrain.getHeightMetersAt(10, 10)).toBe(64);
    });

    it('should allow building exactly to peak', () => {
      // Start below peak
      terrain.setHeightAt(10, 10, 0.8); // 51.2m

      // Build up to peak
      const newHeight = terrain.applyBrushOp(10, 10, 12.8);

      expect(newHeight).toBe(64);
      expect(terrain.getHeightNormalized(10, 10)).toBe(1.0);
    });
  });

  describe('Height Range Validation', () => {
    it('should maintain 15/85 split for water/land', () => {
      const waterlineMeters = TerrainConfig.WATER_LEVEL_ABSOLUTE;
      const totalRange = TerrainConfig.HEIGHT_SCALE;

      const underwaterRange = waterlineMeters - 0; // Ocean floor to waterline
      const aboveWaterRange = totalRange - waterlineMeters; // Waterline to peak

      expect(underwaterRange).toBe(9.6);
      expect(aboveWaterRange).toBe(54.4);
      expect(underwaterRange / totalRange).toBeCloseTo(0.15);
      expect(aboveWaterRange / totalRange).toBeCloseTo(0.85);
    });

    it('should correctly identify terrain zones', () => {
      // Test ocean zones
      terrain.setHeightAt(0, 0, 0.02);
      expect(terrain.getHeightMetersAt(0, 0)).toBeLessThan(TerrainConfig.WATER_LEVEL_ABSOLUTE);

      // Test beach zone
      terrain.setHeightAt(1, 1, 0.15);
      expect(terrain.getHeightMetersAt(1, 1)).toBeCloseTo(TerrainConfig.WATER_LEVEL_ABSOLUTE, 5);

      // Test grasslands
      terrain.setHeightAt(2, 2, TerrainConfig.GRASSLANDS);
      expect(terrain.getHeightMetersAt(2, 2)).toBeGreaterThan(TerrainConfig.WATER_LEVEL_ABSOLUTE);

      // Test peaks
      terrain.setHeightAt(3, 3, 1.0);
      expect(terrain.getHeightMetersAt(3, 3)).toBe(64);
    });
  });

  describe('Brush Operation Scenarios', () => {
    it('should handle pickup operations at ocean floor', () => {
      terrain.setHeightAt(10, 10, 0.01); // Near ocean floor

      // Try to pick up material (dig down)
      const newHeight = terrain.applyBrushOp(10, 10, -0.64); // Small amount

      expect(newHeight).toBe(0); // Should reach ocean floor
      expect(terrain.getHeightMetersAt(10, 10)).toBe(0);
    });

    it('should handle deposit operations at peak', () => {
      terrain.setHeightAt(10, 10, 0.98); // Near peak

      // Try to deposit material (build up)
      const newHeight = terrain.applyBrushOp(10, 10, 5);

      expect(newHeight).toBe(64); // Should be clamped to peak
      expect(terrain.getHeightNormalized(10, 10)).toBe(1.0);
    });

    it('should allow normal operations within valid range', () => {
      terrain.setHeightAt(10, 10, 0.5); // Mid-range

      // Add some height
      let newHeight = terrain.applyBrushOp(10, 10, 10);
      expect(newHeight).toBeCloseTo(42); // 32 + 10

      // Remove some height
      newHeight = terrain.applyBrushOp(10, 10, -15);
      expect(newHeight).toBeCloseTo(27); // 42 - 15

      // Should still be in valid range
      expect(newHeight).toBeGreaterThanOrEqual(0);
      expect(newHeight).toBeLessThanOrEqual(64);
    });
  });
});

// Add helper methods to MockTerrain
Object.assign(MockTerrain.prototype, {
  getHeightNormalized(x: number, y: number): number {
    return this.getHeightAt(x, y);
  }
});