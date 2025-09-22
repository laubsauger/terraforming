/**
 * Centralized terrain configuration
 * All height values are normalized (0-1)
 * Everything is derived from SEA_LEVEL_NORMALIZED
 */

export class TerrainConfig {
  // Core configuration - the only value that should be changed
  static readonly SEA_LEVEL_NORMALIZED = 0.15; // Sea level at 15% - ocean uses bottom 15% of height range

  // Physical scale
  static readonly HEIGHT_SCALE = 64; // World units of height
  static readonly TERRAIN_SIZE = 128; // World units width/depth

  // Derived absolute water level
  static readonly WATER_LEVEL_ABSOLUTE = TerrainConfig.SEA_LEVEL_NORMALIZED * TerrainConfig.HEIGHT_SCALE;

  // Ocean zones (below sea level)
  static readonly OCEAN_FLOOR = 0.0;
  static readonly OCEAN_DEEP = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.2; // 20% of ocean depth
  static readonly OCEAN_MID = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.5;  // 50% of ocean depth
  static readonly OCEAN_SHALLOW = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.8; // 80% of ocean depth

  // Transition zones (around sea level)
  static readonly UNDERWATER_BEACH = TerrainConfig.SEA_LEVEL_NORMALIZED - 0.01;
  static readonly BEACH_WET = TerrainConfig.SEA_LEVEL_NORMALIZED - 0.005;
  static readonly BEACH_WATER_LINE = TerrainConfig.SEA_LEVEL_NORMALIZED;
  static readonly BEACH_DRY = TerrainConfig.SEA_LEVEL_NORMALIZED + 0.005;
  static readonly BEACH_HIGH = TerrainConfig.SEA_LEVEL_NORMALIZED + 0.02;

  // Land elevation zones (above sea level)
  private static readonly LAND_RANGE = 1.0 - TerrainConfig.SEA_LEVEL_NORMALIZED;

  static readonly COASTAL_PLAINS = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.05;  // 5% into land
  static readonly GRASSLANDS = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.15;     // 15% into land
  static readonly FOOTHILLS = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.3;       // 30% into land
  static readonly MOUNTAINS_LOW = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.5;   // 50% into land
  static readonly MOUNTAINS_MID = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.7;   // 70% into land
  static readonly MOUNTAINS_HIGH = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.85; // 85% into land
  static readonly PEAKS = 1.0; // Maximum height

  // Biome thresholds (for materials)
  static readonly BIOME_SAND_END = TerrainConfig.BEACH_HIGH;
  static readonly BIOME_GRASS_START = TerrainConfig.COASTAL_PLAINS;
  static readonly BIOME_GRASS_END = TerrainConfig.FOOTHILLS;
  static readonly BIOME_ROCK_START = TerrainConfig.MOUNTAINS_LOW;
  static readonly BIOME_SNOW_START = TerrainConfig.MOUNTAINS_HIGH;

  // Water depth zones for rendering
  static readonly WATER_DEPTH_SHALLOW = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.2;  // 20% of max depth
  static readonly WATER_DEPTH_MEDIUM = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.5;   // 50% of max depth
  static readonly WATER_DEPTH_DEEP = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.8;     // 80% of max depth

  // Helper methods
  static getOceanDepth(): number {
    return TerrainConfig.SEA_LEVEL_NORMALIZED;
  }

  static getLandHeight(): number {
    return 1.0 - TerrainConfig.SEA_LEVEL_NORMALIZED;
  }

  static normalizeOceanDepth(depth: number): number {
    // Convert absolute depth to 0-1 within ocean range
    return Math.min(1, depth / TerrainConfig.SEA_LEVEL_NORMALIZED);
  }

  static normalizeLandHeight(height: number): number {
    // Convert absolute height above sea level to 0-1 within land range
    const aboveSeaLevel = height - TerrainConfig.SEA_LEVEL_NORMALIZED;
    return Math.max(0, aboveSeaLevel / TerrainConfig.LAND_RANGE);
  }

  static isUnderwater(height: number): boolean {
    return height < TerrainConfig.SEA_LEVEL_NORMALIZED;
  }

  static isBeachZone(height: number): boolean {
    return height >= TerrainConfig.BEACH_WET && height <= TerrainConfig.BEACH_HIGH;
  }

  static isMountainous(height: number): boolean {
    return height >= TerrainConfig.MOUNTAINS_LOW;
  }
}

export default TerrainConfig;