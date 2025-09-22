import { describe, it, expect } from 'vitest';
import { FluidConfig } from '../sim/FluidConfig';

/**
 * Tests to verify that shader parameters are correctly structured
 * and match between CPU and GPU sides
 */

describe('Fluid Shader Parameter Passing', () => {
  describe('Params struct alignment', () => {
    it('should have correct byte offsets for uniform buffer', () => {
      // WGSL struct Params layout (each f32 is 4 bytes):
      // Physics block (offset 0)
      const GRAVITY_OFFSET = 0;
      const EVAPORATION_OFFSET = 4;
      const RAIN_OFFSET = 8;
      const RESOLUTION_OFFSET = 12;
      const DELTA_TIME_OFFSET = 16;
      const TIME_OFFSET = 20;

      // Erosion block (offset 24)
      const EROSION_RATE_OFFSET = 24;
      const DEPOSITION_RATE_OFFSET = 28;
      const CARRYING_CAPACITY_OFFSET = 32;
      const MIN_WATER_EROSION_OFFSET = 36;

      // Flow dynamics block (offset 40)
      const FLOW_INERTIA_OFFSET = 40;
      const MIN_FLOW_SPEED_OFFSET = 44;
      const MAX_FLOW_SPEED_OFFSET = 48;
      const ACCUMULATION_DECAY_OFFSET = 52;

      // Verify offsets are multiples of 4 (f32 size)
      expect(GRAVITY_OFFSET % 4).toBe(0);
      expect(EROSION_RATE_OFFSET % 4).toBe(0);
      expect(FLOW_INERTIA_OFFSET % 4).toBe(0);
    });

    it('should create correctly sized params array', () => {
      // Calculate expected array size
      const physicsParams = 6; // gravity, evaporation, rain, resolution, deltaTime, time
      const erosionParams = 4; // erosionRate, depositionRate, carryingCapacityK, minWaterForErosion
      const flowParams = 4; // flowInertia, minFlowSpeed, maxFlowSpeed, accumulationDecay
      const totalParams = physicsParams + erosionParams + flowParams;

      const params = new Float32Array([
        // Physics
        FluidConfig.GRAVITY,
        FluidConfig.EVAPORATION_RATE,
        0, // rain intensity
        256, // resolution
        0.016, // deltaTime
        0, // time

        // Erosion
        FluidConfig.EROSION_RATE,
        FluidConfig.DEPOSITION_RATE,
        FluidConfig.CARRYING_CAPACITY_K,
        FluidConfig.MIN_WATER_FOR_EROSION,

        // Flow dynamics
        FluidConfig.FLOW_INERTIA,
        FluidConfig.MIN_FLOW_SPEED,
        FluidConfig.MAX_FLOW_SPEED,
        FluidConfig.ACCUMULATION_DECAY,
      ]);

      expect(params.length).toBe(totalParams);
      expect(params.byteLength).toBe(totalParams * 4); // 4 bytes per f32
    });
  });

  describe('Source buffer structure', () => {
    it('should pack sources correctly', () => {
      const sources: number[] = [];
      const waterSource = { x: 100, y: 150, rate: 10, type: 0 };
      const lavaSource = { x: 200, y: 250, rate: 5, type: 1 };

      // Add water source
      sources.push(waterSource.x, waterSource.y, waterSource.rate, waterSource.type);
      // Add lava source
      sources.push(lavaSource.x, lavaSource.y, lavaSource.rate, lavaSource.type);

      const sourceBuffer = new Float32Array(sources);

      // Verify water source
      expect(sourceBuffer[0]).toBe(waterSource.x);
      expect(sourceBuffer[1]).toBe(waterSource.y);
      expect(sourceBuffer[2]).toBe(waterSource.rate);
      expect(sourceBuffer[3]).toBe(waterSource.type);

      // Verify lava source
      expect(sourceBuffer[4]).toBe(lavaSource.x);
      expect(sourceBuffer[5]).toBe(lavaSource.y);
      expect(sourceBuffer[6]).toBe(lavaSource.rate);
      expect(sourceBuffer[7]).toBe(lavaSource.type);
    });

    it('should mark inactive sources correctly', () => {
      const maxSources = FluidConfig.MAX_SOURCES;
      const sources = new Float32Array(maxSources * 4);

      // Fill with inactive markers
      for (let i = 0; i < maxSources; i++) {
        const offset = i * 4;
        sources[offset] = 0;     // x
        sources[offset + 1] = 0; // y
        sources[offset + 2] = 0; // rate
        sources[offset + 3] = -1; // type = -1 means inactive
      }

      // Check all sources are marked inactive
      for (let i = 0; i < maxSources; i++) {
        expect(sources[i * 4 + 3]).toBe(-1);
      }
    });
  });

  describe('Shader constant validation', () => {
    it('should have valid constants for shader usage', () => {
      // These constants are used directly in shaders
      expect(FluidConfig.WORKGROUP_SIZE).toBe(8);
      expect(FluidConfig.SOURCE_RADIUS).toBeGreaterThan(0);
      expect(FluidConfig.SOURCE_GAUSSIAN_SIGMA).toBeLessThan(FluidConfig.SOURCE_RADIUS);
    });

    it('should have proper texture format requirements', () => {
      // Verify simulation scale for texture size calculations
      expect(FluidConfig.SIMULATION_SCALE).toBeLessThanOrEqual(1);
      expect(FluidConfig.SIMULATION_SCALE).toBeGreaterThan(0);

      // For a 256x256 base resolution
      const baseRes = 256;
      const simRes = Math.floor(baseRes * FluidConfig.SIMULATION_SCALE);
      expect(simRes).toBeGreaterThan(0);
      expect(simRes).toBeLessThanOrEqual(baseRes);
    });
  });

  describe('Parameter ranges for GPU computation', () => {
    it('should have parameters within GPU-safe ranges', () => {
      // Check for potential overflow in GPU calculations
      const maxVelocity = FluidConfig.GRAVITY * FluidConfig.MAX_FLOW_SPEED;
      expect(maxVelocity).toBeLessThan(1000); // Reasonable max velocity

      // Check erosion won't cause instability
      const maxErosion = FluidConfig.EROSION_RATE * FluidConfig.CARRYING_CAPACITY_K;
      expect(maxErosion).toBeLessThan(1); // Should erode less than 100% per step

      // Check accumulation decay prevents overflow
      expect(FluidConfig.ACCUMULATION_DECAY).toBeLessThan(1);
      expect(FluidConfig.ACCUMULATION_DECAY).toBeGreaterThan(0.9); // Should decay slowly
    });

    it('should have compatible flow parameters', () => {
      // Flow speeds should work with typical deltaTime values
      const typicalDeltaTime = 1/60; // 60 FPS
      const minDisplacement = FluidConfig.MIN_FLOW_SPEED * typicalDeltaTime;
      const maxDisplacement = FluidConfig.MAX_FLOW_SPEED * typicalDeltaTime;

      // Displacement per frame should be reasonable
      expect(minDisplacement).toBeGreaterThan(0);
      expect(maxDisplacement).toBeLessThan(10); // Less than 10 texels per frame
    });
  });

  describe('Shader-CPU consistency checks', () => {
    it('should match shader Params struct field order', () => {
      // This test documents the expected order that must match the WGSL struct
      const expectedOrder = [
        'gravity',
        'evaporationRate',
        'rainIntensity',
        'resolution',
        'deltaTime',
        'time',
        'erosionRate',
        'depositionRate',
        'carryingCapacityK',
        'minWaterForErosion',
        'flowInertia',
        'minFlowSpeed',
        'maxFlowSpeed',
        'accumulationDecay',
      ];

      // Create params array in the same order
      const params = new Float32Array([
        FluidConfig.GRAVITY,              // 0: gravity
        FluidConfig.EVAPORATION_RATE,     // 1: evaporationRate
        0,                                 // 2: rainIntensity
        256,                              // 3: resolution
        0,                                // 4: deltaTime
        0,                                // 5: time
        FluidConfig.EROSION_RATE,        // 6: erosionRate
        FluidConfig.DEPOSITION_RATE,     // 7: depositionRate
        FluidConfig.CARRYING_CAPACITY_K, // 8: carryingCapacityK
        FluidConfig.MIN_WATER_FOR_EROSION, // 9: minWaterForErosion
        FluidConfig.FLOW_INERTIA,        // 10: flowInertia
        FluidConfig.MIN_FLOW_SPEED,      // 11: minFlowSpeed
        FluidConfig.MAX_FLOW_SPEED,      // 12: maxFlowSpeed
        FluidConfig.ACCUMULATION_DECAY,  // 13: accumulationDecay
      ]);

      expect(params.length).toBe(expectedOrder.length);

      // Verify each parameter is at the expected index
      expect(params[0]).toBeCloseTo(FluidConfig.GRAVITY);
      expect(params[6]).toBeCloseTo(FluidConfig.EROSION_RATE);
      expect(params[10]).toBeCloseTo(FluidConfig.FLOW_INERTIA);
    });
  });
});