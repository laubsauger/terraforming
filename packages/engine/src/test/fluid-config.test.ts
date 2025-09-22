import { describe, it, expect } from 'vitest';
import { FluidConfig } from '../sim/FluidConfig';

describe('FluidConfig', () => {
  describe('Physics Parameters', () => {
    it('should have realistic physics constants', () => {
      expect(FluidConfig.GRAVITY).toBe(9.81);
      expect(FluidConfig.WATER_DENSITY).toBe(1000);
      expect(FluidConfig.LAVA_DENSITY).toBe(2700);
      expect(FluidConfig.LAVA_DENSITY).toBeGreaterThan(FluidConfig.WATER_DENSITY);
    });

    it('should have valid flow dynamics parameters', () => {
      expect(FluidConfig.FLOW_INERTIA).toBeGreaterThanOrEqual(0);
      expect(FluidConfig.FLOW_INERTIA).toBeLessThanOrEqual(1);
      expect(FluidConfig.MIN_FLOW_SPEED).toBeLessThan(FluidConfig.MAX_FLOW_SPEED);
      expect(FluidConfig.MIN_FLOW_SPEED).toBeGreaterThan(0);
    });
  });

  describe('Erosion Parameters', () => {
    it('should have valid erosion rates', () => {
      expect(FluidConfig.EROSION_RATE).toBeGreaterThan(0);
      expect(FluidConfig.DEPOSITION_RATE).toBeGreaterThan(0);
      expect(FluidConfig.CARRYING_CAPACITY_K).toBeGreaterThan(0);
      expect(FluidConfig.MIN_WATER_FOR_EROSION).toBeGreaterThan(0);
    });

    it('should have reasonable erosion limits', () => {
      expect(FluidConfig.MAX_EROSION_PER_STEP).toBeLessThanOrEqual(0.1); // Max 10% per step
      expect(FluidConfig.MAX_EROSION_PER_STEP).toBeGreaterThan(0);
    });
  });

  describe('Source Emitters', () => {
    it('should have valid flow rate ranges', () => {
      expect(FluidConfig.MIN_FLOW_RATE).toBeLessThan(FluidConfig.MAX_FLOW_RATE);
      expect(FluidConfig.DEFAULT_WATER_FLOW_RATE).toBeGreaterThanOrEqual(FluidConfig.MIN_FLOW_RATE);
      expect(FluidConfig.DEFAULT_WATER_FLOW_RATE).toBeLessThanOrEqual(FluidConfig.MAX_FLOW_RATE);
      expect(FluidConfig.DEFAULT_LAVA_FLOW_RATE).toBeGreaterThanOrEqual(FluidConfig.MIN_FLOW_RATE);
      expect(FluidConfig.DEFAULT_LAVA_FLOW_RATE).toBeLessThanOrEqual(FluidConfig.MAX_FLOW_RATE);
    });

    it('should have reasonable source radius', () => {
      expect(FluidConfig.SOURCE_RADIUS).toBeGreaterThan(0);
      expect(FluidConfig.SOURCE_GAUSSIAN_SIGMA).toBeGreaterThan(0);
      expect(FluidConfig.SOURCE_GAUSSIAN_SIGMA).toBeLessThan(FluidConfig.SOURCE_RADIUS);
    });
  });

  describe('Lava Parameters', () => {
    it('should have valid temperature ranges', () => {
      expect(FluidConfig.LAVA_INITIAL_TEMP).toBeGreaterThan(FluidConfig.LAVA_SOLIDIFICATION_TEMP);
      expect(FluidConfig.LAVA_SOLIDIFICATION_TEMP).toBeGreaterThan(FluidConfig.AMBIENT_TEMP);
      expect(FluidConfig.LAVA_COOLING_RATE).toBeGreaterThan(0);
    });

    it('should have valid viscosity range', () => {
      expect(FluidConfig.LAVA_VISCOSITY_MIN).toBeLessThan(FluidConfig.LAVA_VISCOSITY_MAX);
      expect(FluidConfig.LAVA_VISCOSITY_MIN).toBeGreaterThan(0);
    });
  });

  describe('Pool Detection', () => {
    it('should have valid pool detection thresholds', () => {
      expect(FluidConfig.DIVERGENCE_THRESHOLD).toBeLessThan(0); // Negative for convergence
      expect(FluidConfig.POOL_SPEED_THRESHOLD).toBeGreaterThan(0);
      expect(FluidConfig.POOL_DEPTH_THRESHOLD).toBeGreaterThan(0);
      expect(FluidConfig.POOL_SMOOTHING_RADIUS).toBeGreaterThan(0);
    });
  });

  describe('Visualization', () => {
    it('should have valid stream thresholds', () => {
      expect(FluidConfig.STREAM_THRESHOLD).toBeLessThan(FluidConfig.RIVER_THRESHOLD);
      expect(FluidConfig.STREAM_THRESHOLD).toBeGreaterThan(0);
    });

    it('should have valid color values', () => {
      // Check all color components are in [0, 1] range
      FluidConfig.STREAM_COLOR.forEach(c => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });

      FluidConfig.RIVER_COLOR.forEach(c => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });

      FluidConfig.SEDIMENT_COLOR.forEach(c => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });
    });

    it('should have valid wetness roughness', () => {
      expect(FluidConfig.WETNESS_ROUGHNESS).toBeGreaterThanOrEqual(0);
      expect(FluidConfig.WETNESS_ROUGHNESS).toBeLessThanOrEqual(1);
    });
  });

  describe('Performance', () => {
    it('should have valid performance settings', () => {
      expect(FluidConfig.SIMULATION_SCALE).toBeGreaterThan(0);
      expect(FluidConfig.SIMULATION_SCALE).toBeLessThanOrEqual(1);
      expect(FluidConfig.WORKGROUP_SIZE).toBeGreaterThan(0);
      expect(FluidConfig.MAX_SOURCES).toBeGreaterThan(0);
      expect(FluidConfig.UPDATE_FREQUENCY).toBeGreaterThan(0);
    });
  });

  describe('Flow Accumulation', () => {
    it('should have valid accumulation parameters', () => {
      expect(FluidConfig.ACCUMULATION_DECAY).toBeGreaterThan(0);
      expect(FluidConfig.ACCUMULATION_DECAY).toBeLessThanOrEqual(1);
      expect(FluidConfig.RAIN_BASE_AMOUNT).toBeGreaterThan(0);
      expect(FluidConfig.ACCUMULATION_BLUR_RADIUS).toBeGreaterThanOrEqual(0);
      expect(FluidConfig.MIN_ACCUMULATION).toBeGreaterThan(0);
      expect(FluidConfig.SLOPE_POWER).toBeGreaterThan(0);
    });
  });

  describe('Water Dynamics', () => {
    it('should have valid water parameters', () => {
      expect(FluidConfig.EVAPORATION_RATE).toBeGreaterThanOrEqual(0);
      expect(FluidConfig.MIN_WATER_DEPTH).toBeGreaterThan(0);
      expect(FluidConfig.ADVECTION_SCALE).toBeGreaterThan(0);
    });
  });

  describe('Configuration Consistency', () => {
    it('should have consistent erosion and deposition rates', () => {
      // Deposition should typically be faster than erosion for stability
      expect(FluidConfig.DEPOSITION_RATE).toBeGreaterThanOrEqual(FluidConfig.EROSION_RATE);
    });

    it('should have reasonable default flow rates', () => {
      // Water should flow faster than lava by default
      expect(FluidConfig.DEFAULT_WATER_FLOW_RATE).toBeGreaterThanOrEqual(FluidConfig.DEFAULT_LAVA_FLOW_RATE);
    });

    it('should have consistent texture resolutions', () => {
      // Simulation scale should be reasonable for performance
      expect(FluidConfig.SIMULATION_SCALE).toBeLessThanOrEqual(0.5); // At most half resolution
    });
  });
});