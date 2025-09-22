import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FluidSystem } from '../sim/FluidSystem';
import { Fields } from '../sim/fields';
import { FluidConfig } from '../sim/FluidConfig';

// Mock GPUBufferUsage
(globalThis as any).GPUBufferUsage = {
  UNIFORM: 0x40,
  STORAGE: 0x80,
  COPY_DST: 0x08,
};

// Mock GPU objects
const createMockDevice = () => ({
  createBuffer: vi.fn(() => ({
    destroy: vi.fn(),
    size: 256,
    usage: 0,
  })),
  createShaderModule: vi.fn(() => ({
    label: 'mock shader',
  })),
  queue: {
    writeBuffer: vi.fn(),
  },
});

const createMockFields = () => ({
  soil: { width: 256, height: 256 },
  soilOut: { width: 256, height: 256 },
  rock: { width: 256, height: 256 },
  rockOut: { width: 256, height: 256 },
  flow: { width: 256, height: 256 },
  flowOut: { width: 256, height: 256 },
  waterDepth: { width: 256, height: 256 },
  waterDepthOut: { width: 256, height: 256 },
  flowAccumulation: { width: 256, height: 256 },
  poolMask: { width: 256, height: 256 },
  temperature: { width: 256, height: 256 },
  sediment: { width: 256, height: 256 },
  sedimentOut: { width: 256, height: 256 },
});

describe('FluidSystem', () => {
  let mockDevice: any;
  let mockFields: any;
  let fluidSystem: FluidSystem;

  beforeEach(() => {
    mockDevice = createMockDevice();
    mockFields = createMockFields();
  });

  describe('Initialization', () => {
    it('should create with default parameters', () => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });

      expect(mockDevice.createBuffer).toHaveBeenCalledTimes(2); // params + sources
      expect(mockDevice.createShaderModule).toHaveBeenCalled();
    });

    it('should use custom simulation resolution', () => {
      const customSimRes = 64;
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
        simResolution: customSimRes,
      });

      // Check that params buffer is initialized with custom resolution
      const writeBufferCall = mockDevice.queue.writeBuffer.mock.calls[0];
      const paramsData = writeBufferCall[2];
      expect(paramsData[3]).toBe(customSimRes); // simResolution at index 3
    });

    it('should use default simulation scale if not specified', () => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });

      const expectedSimRes = Math.floor(256 * FluidConfig.SIMULATION_SCALE);
      const writeBufferCall = mockDevice.queue.writeBuffer.mock.calls[0];
      const paramsData = writeBufferCall[2];
      expect(paramsData[3]).toBe(expectedSimRes);
    });

    it('should initialize with custom physics parameters', () => {
      const customGravity = 5.0;
      const customEvaporation = 0.01;
      const customRain = 0.5;

      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
        gravity: customGravity,
        evaporationRate: customEvaporation,
        rainIntensity: customRain,
      });

      const writeBufferCall = mockDevice.queue.writeBuffer.mock.calls[0];
      const paramsData = writeBufferCall[2];
      expect(paramsData[0]).toBeCloseTo(customGravity);
      expect(paramsData[1]).toBeCloseTo(customEvaporation);
      expect(paramsData[2]).toBeCloseTo(customRain);
    });
  });

  describe('Source Management', () => {
    beforeEach(() => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });
      // Reset mock to ignore initialization calls
      mockDevice.queue.writeBuffer.mockClear();
    });

    it('should add water source', () => {
      const sourceId = 'water-1';
      const x = 100;
      const z = 150;
      const flowRate = 20;

      fluidSystem.addWaterSource(sourceId, x, z, flowRate);

      expect(mockDevice.queue.writeBuffer).toHaveBeenCalled();
      const sourceData = mockDevice.queue.writeBuffer.mock.calls[0][2];

      // Check first source entry
      expect(sourceData[0]).toBe(x);      // x position
      expect(sourceData[1]).toBe(z);      // z position
      expect(sourceData[2]).toBe(flowRate); // rate
      expect(sourceData[3]).toBe(0);      // type 0 = water
    });

    it('should add lava source', () => {
      const sourceId = 'lava-1';
      const x = 50;
      const z = 75;
      const flowRate = 5;

      fluidSystem.addLavaSource(sourceId, x, z, flowRate);

      const sourceData = mockDevice.queue.writeBuffer.mock.calls[0][2];

      expect(sourceData[0]).toBe(x);
      expect(sourceData[1]).toBe(z);
      expect(sourceData[2]).toBe(flowRate);
      expect(sourceData[3]).toBe(1);      // type 1 = lava
    });

    it('should use default flow rates', () => {
      fluidSystem.addWaterSource('water-default', 0, 0);
      let sourceData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      expect(sourceData[2]).toBe(FluidConfig.DEFAULT_WATER_FLOW_RATE);

      // Create a new fluid system for testing lava separately
      const newFluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });
      mockDevice.queue.writeBuffer.mockClear();

      newFluidSystem.addLavaSource('lava-default', 0, 0);
      sourceData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      expect(sourceData[2]).toBe(FluidConfig.DEFAULT_LAVA_FLOW_RATE);
    });

    it('should remove sources', () => {
      fluidSystem.addWaterSource('source-1', 10, 20, 15);
      fluidSystem.addLavaSource('source-2', 30, 40, 5);

      mockDevice.queue.writeBuffer.mockClear();

      fluidSystem.removeSource('source-1');

      const sourceData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      // Should only have lava source now
      expect(sourceData[0]).toBe(30);  // lava x
      expect(sourceData[1]).toBe(40);  // lava z
      expect(sourceData[2]).toBe(5);   // lava rate
      expect(sourceData[3]).toBe(1);   // lava type

      // Next source should be inactive
      expect(sourceData[7]).toBe(-1);  // inactive type marker
    });

    it('should handle multiple sources', () => {
      fluidSystem.addWaterSource('w1', 10, 20, 5);
      fluidSystem.addWaterSource('w2', 30, 40, 10);
      fluidSystem.addLavaSource('l1', 50, 60, 3);

      const sourceData = mockDevice.queue.writeBuffer.mock.calls[mockDevice.queue.writeBuffer.mock.calls.length - 1][2];

      // Check all three sources
      expect(sourceData[0]).toBe(10);  // w1 x
      expect(sourceData[3]).toBe(0);   // w1 type (water)

      expect(sourceData[4]).toBe(30);  // w2 x
      expect(sourceData[7]).toBe(0);   // w2 type (water)

      expect(sourceData[8]).toBe(50);  // l1 x
      expect(sourceData[11]).toBe(1);  // l1 type (lava)
    });

    it('should not exceed max sources', () => {
      // Try to add more than MAX_SOURCES
      for (let i = 0; i < FluidConfig.MAX_SOURCES + 10; i++) {
        fluidSystem.addWaterSource(`source-${i}`, i, i, 1);
      }

      const sourceData = mockDevice.queue.writeBuffer.mock.calls[mockDevice.queue.writeBuffer.mock.calls.length - 1][2];
      // Buffer should be exactly MAX_SOURCES * 4 floats
      expect(sourceData.length).toBe(FluidConfig.MAX_SOURCES * 4);
    });
  });

  describe('Parameter Updates', () => {
    beforeEach(() => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });
      mockDevice.queue.writeBuffer.mockClear();
    });

    it('should update rain intensity', () => {
      const newIntensity = 0.75;
      fluidSystem.setRainIntensity(newIntensity);

      expect(mockDevice.queue.writeBuffer).toHaveBeenCalled();
      const paramsData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      expect(paramsData[2]).toBe(newIntensity);
    });

    it('should clamp negative rain intensity to zero', () => {
      fluidSystem.setRainIntensity(-10);

      const paramsData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      expect(paramsData[2]).toBe(0);
    });

    it('should update evaporation rate', () => {
      const newRate = 0.005;
      fluidSystem.setEvaporationRate(newRate);

      const paramsData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      expect(paramsData[1]).toBeCloseTo(newRate);
    });

    it('should clamp negative evaporation to zero', () => {
      fluidSystem.setEvaporationRate(-1);

      const paramsData = mockDevice.queue.writeBuffer.mock.calls[0][2];
      expect(paramsData[1]).toBe(0);
    });
  });

  describe('Update Parameters Buffer', () => {
    beforeEach(() => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });
      mockDevice.queue.writeBuffer.mockClear();
    });

    it('should include all erosion parameters', () => {
      // Trigger an update
      fluidSystem.setRainIntensity(0.1);

      const paramsData = mockDevice.queue.writeBuffer.mock.calls[0][2];

      // Check erosion parameters (starting at offset 6)
      expect(paramsData[6]).toBeCloseTo(FluidConfig.EROSION_RATE);
      expect(paramsData[7]).toBeCloseTo(FluidConfig.DEPOSITION_RATE);
      expect(paramsData[8]).toBeCloseTo(FluidConfig.CARRYING_CAPACITY_K);
      expect(paramsData[9]).toBeCloseTo(FluidConfig.MIN_WATER_FOR_EROSION);
    });

    it('should include all flow dynamics parameters', () => {
      fluidSystem.setRainIntensity(0.1);

      const paramsData = mockDevice.queue.writeBuffer.mock.calls[0][2];

      // Check flow dynamics (starting at offset 10)
      expect(paramsData[10]).toBeCloseTo(FluidConfig.FLOW_INERTIA);
      expect(paramsData[11]).toBeCloseTo(FluidConfig.MIN_FLOW_SPEED);
      expect(paramsData[12]).toBeCloseTo(FluidConfig.MAX_FLOW_SPEED);
      expect(paramsData[13]).toBeCloseTo(FluidConfig.ACCUMULATION_DECAY);
    });
  });

  describe('Texture Access', () => {
    beforeEach(() => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });
    });

    it('should return correct flow texture based on ping-pong state', () => {
      // Initially should return base texture
      expect(fluidSystem.getFlowTexture()).toBe(mockFields.flow);

      // Simulate update changing ping-pong state
      // This would normally happen in update() but we can't test GPU operations
      // So we'll test the logic exists
      expect(fluidSystem.getFlowTexture()).toBeDefined();
    });

    it('should return water depth texture', () => {
      expect(fluidSystem.getWaterDepthTexture()).toBe(mockFields.waterDepth);
      expect(fluidSystem.getWaterDepthTexture()).toBeDefined();
    });

    it('should return sediment texture', () => {
      expect(fluidSystem.getSedimentTexture()).toBe(mockFields.sediment);
      expect(fluidSystem.getSedimentTexture()).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    it('should destroy buffers on cleanup', () => {
      fluidSystem = new FluidSystem({
        device: mockDevice as any,
        fields: mockFields as any,
        resolution: 256,
      });

      const buffers = mockDevice.createBuffer.mock.results.map((r: any) => r.value);

      fluidSystem.destroy();

      buffers.forEach((buffer: any) => {
        expect(buffer.destroy).toHaveBeenCalled();
      });
    });
  });
});