/**
 * Centralized terrain configuration
 * Shared across TypeScript and GPU shaders
 */

export class TerrainConfig {
  // Core configuration - the only value that should be changed
  static readonly SEA_LEVEL_NORMALIZED = 0.15; // Sea level at 15% - ocean uses bottom 15% of height range

  // Physical scale
  static readonly HEIGHT_SCALE = 64; // World units of height
  static readonly TERRAIN_SIZE = 128; // World units width/depth

  // Derived absolute values
  static readonly WATER_LEVEL_ABSOLUTE = TerrainConfig.SEA_LEVEL_NORMALIZED * TerrainConfig.HEIGHT_SCALE;
  static readonly MAX_HEIGHT_ABSOLUTE = TerrainConfig.HEIGHT_SCALE;
  static readonly OCEAN_DEPTH_RANGE = TerrainConfig.WATER_LEVEL_ABSOLUTE; // 0 to sea level

  // Ocean zones (below sea level) - in normalized units
  static readonly OCEAN_FLOOR = 0.0;
  static readonly OCEAN_DEEP = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.2; // 20% of ocean depth
  static readonly OCEAN_MID = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.5;  // 50% of ocean depth
  static readonly OCEAN_SHALLOW = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.8; // 80% of ocean depth

  // Transition zones (around sea level) - in normalized units
  static readonly UNDERWATER_BEACH = TerrainConfig.SEA_LEVEL_NORMALIZED - 0.01;
  static readonly BEACH_WET = TerrainConfig.SEA_LEVEL_NORMALIZED - 0.005;
  static readonly BEACH_WATER_LINE = TerrainConfig.SEA_LEVEL_NORMALIZED;
  static readonly BEACH_DRY = TerrainConfig.SEA_LEVEL_NORMALIZED + 0.005;
  static readonly BEACH_HIGH = TerrainConfig.SEA_LEVEL_NORMALIZED + 0.02;

  // Land elevation zones (above sea level) - in normalized units
  private static readonly LAND_RANGE = 1.0 - TerrainConfig.SEA_LEVEL_NORMALIZED;

  static readonly COASTAL_PLAINS = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.05;
  static readonly GRASSLANDS = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.15;
  static readonly FOOTHILLS = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.3;
  static readonly MOUNTAINS_LOW = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.5;
  static readonly MOUNTAINS_MID = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.7;
  static readonly MOUNTAINS_HIGH = TerrainConfig.SEA_LEVEL_NORMALIZED + TerrainConfig.LAND_RANGE * 0.85;
  static readonly PEAKS = 1.0; // Maximum height

  // Biome thresholds (for materials)
  static readonly BIOME_SAND_END = TerrainConfig.BEACH_HIGH;
  static readonly BIOME_GRASS_START = TerrainConfig.COASTAL_PLAINS;
  static readonly BIOME_GRASS_END = TerrainConfig.FOOTHILLS;
  static readonly BIOME_ROCK_START = TerrainConfig.MOUNTAINS_LOW;
  static readonly BIOME_SNOW_START = TerrainConfig.MOUNTAINS_HIGH;

  // Water depth zones for rendering
  static readonly WATER_DEPTH_SHALLOW = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.2;
  static readonly WATER_DEPTH_MEDIUM = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.5;
  static readonly WATER_DEPTH_DEEP = TerrainConfig.SEA_LEVEL_NORMALIZED * 0.8;

  // Generate WGSL constants for GPU shaders
  static generateWGSLConstants(): string {
    return `// Auto-generated terrain constants - DO NOT EDIT MANUALLY
const SEA_LEVEL_NORMALIZED: f32 = ${TerrainConfig.SEA_LEVEL_NORMALIZED};
const HEIGHT_SCALE: f32 = ${TerrainConfig.HEIGHT_SCALE}.0;
const WATER_LEVEL_ABSOLUTE: f32 = ${TerrainConfig.WATER_LEVEL_ABSOLUTE};
const MAX_HEIGHT_ABSOLUTE: f32 = ${TerrainConfig.MAX_HEIGHT_ABSOLUTE}.0;
const OCEAN_DEPTH_RANGE: f32 = ${TerrainConfig.OCEAN_DEPTH_RANGE};

// Ocean zones (normalized)
const OCEAN_FLOOR: f32 = ${TerrainConfig.OCEAN_FLOOR};
const OCEAN_DEEP: f32 = ${TerrainConfig.OCEAN_DEEP};
const OCEAN_MID: f32 = ${TerrainConfig.OCEAN_MID};
const OCEAN_SHALLOW: f32 = ${TerrainConfig.OCEAN_SHALLOW};

// Beach zones (normalized)
const BEACH_WATER_LINE: f32 = ${TerrainConfig.BEACH_WATER_LINE};
const BEACH_DRY: f32 = ${TerrainConfig.BEACH_DRY};
const BEACH_HIGH: f32 = ${TerrainConfig.BEACH_HIGH};

// Land zones (normalized)
const COASTAL_PLAINS: f32 = ${TerrainConfig.COASTAL_PLAINS};
const GRASSLANDS: f32 = ${TerrainConfig.GRASSLANDS};
const FOOTHILLS: f32 = ${TerrainConfig.FOOTHILLS};
const MOUNTAINS_LOW: f32 = ${TerrainConfig.MOUNTAINS_LOW};
const MOUNTAINS_MID: f32 = ${TerrainConfig.MOUNTAINS_MID};
const MOUNTAINS_HIGH: f32 = ${TerrainConfig.MOUNTAINS_HIGH};
const PEAKS: f32 = ${TerrainConfig.PEAKS};
`;
  }

  // Helper methods
  static getOceanDepth(): number {
    return TerrainConfig.SEA_LEVEL_NORMALIZED;
  }

  static getLandHeight(): number {
    return 1.0 - TerrainConfig.SEA_LEVEL_NORMALIZED;
  }

  static normalizeOceanDepth(depth: number): number {
    return Math.min(1, depth / TerrainConfig.SEA_LEVEL_NORMALIZED);
  }

  static normalizeLandHeight(height: number): number {
    const aboveSeaLevel = height - TerrainConfig.SEA_LEVEL_NORMALIZED;
    return Math.max(0, aboveSeaLevel / (1.0 - TerrainConfig.SEA_LEVEL_NORMALIZED));
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

  // Convert between normalized and absolute heights
  static normalizedToMeters(normalized: number): number {
    return normalized * TerrainConfig.HEIGHT_SCALE;
  }

  static metersToNormalized(meters: number): number {
    return meters / TerrainConfig.HEIGHT_SCALE;
  }
}

export default TerrainConfig;