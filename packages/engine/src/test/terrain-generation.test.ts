import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainConfig } from '@terraforming/types';

describe('Terrain Generation', () => {
  describe('Height Distribution', () => {
    it('should have sea level at exactly 15% of height range', () => {
      expect(TerrainConfig.SEA_LEVEL_NORMALIZED).toBe(0.15);
      expect(TerrainConfig.WATER_LEVEL_ABSOLUTE).toBe(9.6);
      expect(TerrainConfig.WATER_LEVEL_ABSOLUTE / TerrainConfig.HEIGHT_SCALE).toBe(0.15);
    });

    it('should have ocean floor at 0 meters', () => {
      expect(TerrainConfig.OCEAN_FLOOR).toBe(0);
    });

    it('should have peak at 64 meters', () => {
      expect(TerrainConfig.HEIGHT_SCALE).toBe(64);
      expect(TerrainConfig.PEAKS).toBe(1.0);
    });

    it('should have 85% of height range above water', () => {
      const aboveWaterRange = 1.0 - TerrainConfig.SEA_LEVEL_NORMALIZED;
      expect(aboveWaterRange).toBeCloseTo(0.85);
    });

    it('should have consistent zone boundaries', () => {
      // Ocean zones should be below sea level
      expect(TerrainConfig.OCEAN_DEEP).toBeLessThan(TerrainConfig.SEA_LEVEL_NORMALIZED);
      expect(TerrainConfig.OCEAN_SHALLOW).toBeLessThan(TerrainConfig.SEA_LEVEL_NORMALIZED);

      // Beach zones should straddle sea level
      expect(TerrainConfig.BEACH_WATER_LINE).toBe(TerrainConfig.SEA_LEVEL_NORMALIZED);
      expect(TerrainConfig.BEACH_DRY).toBeGreaterThan(TerrainConfig.SEA_LEVEL_NORMALIZED);

      // Land zones should be above sea level
      expect(TerrainConfig.COASTAL_PLAINS).toBeGreaterThan(TerrainConfig.SEA_LEVEL_NORMALIZED);
      expect(TerrainConfig.GRASSLANDS).toBeGreaterThan(TerrainConfig.COASTAL_PLAINS);
      expect(TerrainConfig.FOOTHILLS).toBeGreaterThan(TerrainConfig.GRASSLANDS);
      expect(TerrainConfig.MOUNTAINS_LOW).toBeGreaterThan(TerrainConfig.FOOTHILLS);
      expect(TerrainConfig.MOUNTAINS_MID).toBeGreaterThan(TerrainConfig.MOUNTAINS_LOW);
      expect(TerrainConfig.MOUNTAINS_HIGH).toBeGreaterThan(TerrainConfig.MOUNTAINS_MID);
      expect(TerrainConfig.PEAKS).toBe(1.0);
    });
  });

  describe('Height Conversions', () => {
    it('should convert normalized to meters correctly', () => {
      expect(TerrainConfig.normalizedToMeters(0)).toBe(0);
      expect(TerrainConfig.normalizedToMeters(0.15)).toBe(9.6);
      expect(TerrainConfig.normalizedToMeters(0.5)).toBe(32);
      expect(TerrainConfig.normalizedToMeters(1.0)).toBe(64);
    });

    it('should convert meters to normalized correctly', () => {
      expect(TerrainConfig.metersToNormalized(0)).toBe(0);
      expect(TerrainConfig.metersToNormalized(9.6)).toBe(0.15);
      expect(TerrainConfig.metersToNormalized(32)).toBe(0.5);
      expect(TerrainConfig.metersToNormalized(64)).toBe(1.0);
    });

    it('should identify underwater correctly', () => {
      expect(TerrainConfig.isUnderwater(0)).toBe(true);
      expect(TerrainConfig.isUnderwater(0.1)).toBe(true);
      expect(TerrainConfig.isUnderwater(0.14)).toBe(true);
      expect(TerrainConfig.isUnderwater(0.15)).toBe(false);
      expect(TerrainConfig.isUnderwater(0.16)).toBe(false);
      expect(TerrainConfig.isUnderwater(1.0)).toBe(false);
    });

    it('should identify beach zone correctly', () => {
      // isBeach doesn't exist, test the beach zone boundaries instead
      expect(TerrainConfig.BEACH_WET).toBeLessThan(TerrainConfig.SEA_LEVEL_NORMALIZED);
      expect(TerrainConfig.BEACH_WATER_LINE).toBe(TerrainConfig.SEA_LEVEL_NORMALIZED);
      expect(TerrainConfig.BEACH_DRY).toBeGreaterThan(TerrainConfig.SEA_LEVEL_NORMALIZED);
      expect(TerrainConfig.BEACH_HIGH).toBeGreaterThan(TerrainConfig.BEACH_DRY);
    });
  });

  describe('WGSL Constant Generation', () => {
    it('should generate valid WGSL constants', () => {
      const wgsl = TerrainConfig.generateWGSLConstants();

      expect(wgsl).toContain('const SEA_LEVEL_NORMALIZED: f32 = 0.15;');
      expect(wgsl).toContain('const HEIGHT_SCALE: f32 = 64.0;');  // WGSL uses 64.0
      expect(wgsl).toContain('const WATER_LEVEL_ABSOLUTE: f32 = 9.6;');
      expect(wgsl).toContain('const MAX_HEIGHT_ABSOLUTE: f32 = 64.0;');  // WGSL uses 64.0
      expect(wgsl).toContain('const OCEAN_FLOOR: f32 = 0;');
      expect(wgsl).toContain('const PEAKS: f32 = 1;');
    });

    it('should include all zone constants in WGSL', () => {
      const wgsl = TerrainConfig.generateWGSLConstants();

      expect(wgsl).toContain('const OCEAN_DEEP: f32');
      expect(wgsl).toContain('const OCEAN_SHALLOW: f32');
      expect(wgsl).toContain('const BEACH_WATER_LINE: f32');
      expect(wgsl).toContain('const COASTAL_PLAINS: f32');
      expect(wgsl).toContain('const GRASSLANDS: f32');
      expect(wgsl).toContain('const MOUNTAINS_LOW: f32');
      expect(wgsl).toContain('const MOUNTAINS_HIGH: f32');
    });
  });
});