/**
 * Configuration constants for the fluid simulation system
 * All physics parameters and thresholds in one place for easy tuning
 */

export const FluidConfig = {
  // === Simulation Resolution ===
  SIMULATION_SCALE: 0.25,          // Run simulation at 1/4 of render resolution
  WORKGROUP_SIZE: 8,                // GPU workgroup size for compute shaders

  // === Physics Parameters ===
  GRAVITY: 9.81,                    // m/s^2
  WATER_DENSITY: 1000,              // kg/m^3
  LAVA_DENSITY: 2700,               // kg/m^3

  // === Flow Dynamics ===
  FLOW_INERTIA: 0.7,                // 0 = instant response, 1 = no change
  MIN_FLOW_SPEED: 0.001,            // Minimum flow velocity
  MAX_FLOW_SPEED: 10.0,             // Maximum flow velocity
  ROUGHNESS_DAMPING: 0.5,           // How much terrain roughness slows flow
  VISCOSITY_DAMPING: 0.01,          // Water viscosity effect

  // === Flow Accumulation ===
  ACCUMULATION_DECAY: 0.98,         // Hysteresis - how long channels persist
  RAIN_BASE_AMOUNT: 1.0,            // Base rain contribution per cell
  ACCUMULATION_BLUR_RADIUS: 1,      // Blur radius for stream merging
  MIN_ACCUMULATION: 0.001,          // Threshold below which accumulation zeros
  SLOPE_POWER: 2.0,                 // Power for slope-based accumulation weighting

  // === Erosion Parameters ===
  CARRYING_CAPACITY_K: 0.5,         // Base carrying capacity constant
  EROSION_RATE: 0.01,               // Rate of picking up sediment
  DEPOSITION_RATE: 0.02,            // Rate of depositing sediment
  MIN_WATER_FOR_EROSION: 0.001,     // Minimum water depth for erosion
  SLOPE_EXPONENT: 1.5,              // Power for slope in capacity calculation
  FLOW_EXPONENT: 1.0,               // Power for flow speed in capacity calculation
  MAX_EROSION_PER_STEP: 0.01,       // Max 1% of terrain height per frame

  // === Water Dynamics ===
  EVAPORATION_RATE: 0.0001,         // Water evaporation rate per second
  MIN_WATER_DEPTH: 0.0001,          // Minimum water depth threshold
  ADVECTION_SCALE: 5.0,             // Scale factor for water advection

  // === Source Emitters ===
  SOURCE_RADIUS: 3.0,               // Radius of source influence in texels
  SOURCE_GAUSSIAN_SIGMA: 1.5,       // Gaussian falloff sigma
  DEFAULT_WATER_FLOW_RATE: 10.0,    // Default water emission rate
  DEFAULT_LAVA_FLOW_RATE: 5.0,      // Default lava emission rate
  MIN_FLOW_RATE: 0.1,               // Minimum source flow rate
  MAX_FLOW_RATE: 100.0,             // Maximum source flow rate

  // === Lava Parameters ===
  LAVA_INITIAL_TEMP: 1200.0,        // Initial lava temperature (Celsius)
  LAVA_SOLIDIFICATION_TEMP: 700.0,  // Temperature at which lava becomes rock
  LAVA_COOLING_RATE: 2.0,           // Degrees per second cooling
  AMBIENT_TEMP: 20.0,               // Room temperature
  LAVA_VISCOSITY_MIN: 0.1,          // Minimum viscosity multiplier (hot)
  LAVA_VISCOSITY_MAX: 10.0,         // Maximum viscosity multiplier (cold)

  // === Pool Detection ===
  DIVERGENCE_THRESHOLD: -0.01,      // Negative = convergence (pooling)
  POOL_SPEED_THRESHOLD: 0.05,       // Low speed indicates pooling
  POOL_DEPTH_THRESHOLD: 0.01,       // Minimum water depth for pool
  POOL_SMOOTHING_RADIUS: 2,         // Radius for height comparison

  // === Visualization (Terrain Material) ===
  STREAM_THRESHOLD: 0.001,          // Min accumulation for stream visibility
  RIVER_THRESHOLD: 0.01,            // Min accumulation for river visibility
  WETNESS_ROUGHNESS: 0.1,           // Roughness of wet areas
  STREAM_COLOR: [0.5, 0.52, 0.55],  // RGB color for streams
  RIVER_COLOR: [0.3, 0.35, 0.4],    // RGB color for rivers
  SEDIMENT_COLOR: [0.8, 0.75, 0.65], // RGB color for deposited sediment

  // === Performance ===
  MAX_SOURCES: 128,                 // Maximum number of water/lava sources
  UPDATE_FREQUENCY: 60,              // Target simulation updates per second
} as const;

export type FluidConfigType = typeof FluidConfig;