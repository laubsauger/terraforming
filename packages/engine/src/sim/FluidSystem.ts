import { Fields } from './fields';
import { type Source } from '@terraforming/types';
import { FluidConfig } from './FluidConfig';
// Import shader sources
import flowVelocityShaderSrc from '../gpu/shaders/FlowVelocity.wgsl?raw';
import flowAccumulationShaderSrc from '../gpu/shaders/FlowAccumulation.wgsl?raw';
import sourceEmissionShaderSrc from '../gpu/shaders/SourceEmission.wgsl?raw';
import waterAdvectionShaderSrc from '../gpu/shaders/WaterAdvection.wgsl?raw';
import poolDetectionShaderSrc from '../gpu/shaders/PoolDetection.wgsl?raw';
import hydraulicErosionShaderSrc from '../gpu/shaders/HydraulicErosion.wgsl?raw';

export interface FluidSystemOptions {
  device: GPUDevice;
  fields: Fields;
  resolution: number;
  simResolution?: number; // Run sim at lower res for performance
  gravity?: number;
  evaporationRate?: number;
  rainIntensity?: number;
}

export class FluidSystem {
  private device: GPUDevice;
  private fields: Fields;
  private resolution: number;
  private simResolution: number;

  // Fluid parameters
  private gravity: number;
  private evaporationRate: number;
  private rainIntensity: number;

  // Water/lava sources
  private waterSources: Map<string, Source> = new Map();
  private lavaSources: Map<string, Source> = new Map();

  // Compute pipelines
  private flowVelocityPipeline: GPUComputePipeline | null = null;
  private flowAccumulationPipeline: GPUComputePipeline | null = null;
  private waterAdvectionPipeline: GPUComputePipeline | null = null;
  private poolDetectionPipeline: GPUComputePipeline | null = null;
  private hydraulicErosionPipeline: GPUComputePipeline | null = null;
  private sourceEmissionPipeline: GPUComputePipeline | null = null;

  // Bind groups for each pipeline
  private flowVelocityBindGroup: GPUBindGroup | null = null;
  private flowAccumulationBindGroup: GPUBindGroup | null = null;
  private waterAdvectionBindGroup: GPUBindGroup | null = null;
  private poolDetectionBindGroup: GPUBindGroup | null = null;
  private hydraulicErosionBindGroup: GPUBindGroup | null = null;
  private sourceEmissionBindGroup: GPUBindGroup | null = null;

  // Uniform buffers
  private paramsBuffer: GPUBuffer;
  private sourceBuffer: GPUBuffer;

  // Ping-pong state
  private pingPongState = {
    flow: false,
    water: false,
    sediment: false,
  };

  constructor(options: FluidSystemOptions) {
    this.device = options.device;
    this.fields = options.fields;
    this.resolution = options.resolution;
    this.simResolution = options.simResolution ?? Math.floor(options.resolution * FluidConfig.SIMULATION_SCALE);

    // Set default parameters from config
    this.gravity = options.gravity ?? FluidConfig.GRAVITY;
    this.evaporationRate = options.evaporationRate ?? FluidConfig.EVAPORATION_RATE;
    this.rainIntensity = options.rainIntensity ?? 0.0;

    // Create uniform buffers
    this.paramsBuffer = this.createParamsBuffer();
    this.sourceBuffer = this.createSourceBuffer();

    // Initialize pipelines (deferred until shaders are ready)
    this.initPipelines();
  }

  private createParamsBuffer(): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: 256, // Enough space for all parameters
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Write initial parameters - matches Params struct in shader
    const params = new Float32Array([
      // Physics (offset 0)
      this.gravity,
      this.evaporationRate,
      this.rainIntensity,
      this.simResolution,
      0, // deltaTime (updated per frame)
      0, // time (updated per frame)

      // Erosion (offset 24)
      FluidConfig.EROSION_RATE,
      FluidConfig.DEPOSITION_RATE,
      FluidConfig.CARRYING_CAPACITY_K,
      FluidConfig.MIN_WATER_FOR_EROSION,

      // Flow dynamics (offset 40)
      FluidConfig.FLOW_INERTIA,
      FluidConfig.MIN_FLOW_SPEED,
      FluidConfig.MAX_FLOW_SPEED,
      FluidConfig.ACCUMULATION_DECAY,
    ]);

    this.device.queue.writeBuffer(buffer, 0, params);
    return buffer;
  }

  private createSourceBuffer(): GPUBuffer {
    const maxSources = FluidConfig.MAX_SOURCES;
    const buffer = this.device.createBuffer({
      size: maxSources * 16, // Each source: x, y, rate, type (4 floats)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    return buffer;
  }

  private initPipelines(): void {
    try {
      // Create shader modules
      const flowVelocityShader = this.device.createShaderModule({
        label: 'Flow Velocity Shader',
        code: flowVelocityShaderSrc,
      });

      const flowAccumulationShader = this.device.createShaderModule({
        label: 'Flow Accumulation Shader',
        code: flowAccumulationShaderSrc,
      });

      const sourceEmissionShader = this.device.createShaderModule({
        label: 'Source Emission Shader',
        code: sourceEmissionShaderSrc,
      });

      const waterAdvectionShader = this.device.createShaderModule({
        label: 'Water Advection Shader',
        code: waterAdvectionShaderSrc,
      });

      const poolDetectionShader = this.device.createShaderModule({
        label: 'Pool Detection Shader',
        code: poolDetectionShaderSrc,
      });

      const hydraulicErosionShader = this.device.createShaderModule({
        label: 'Hydraulic Erosion Shader',
        code: hydraulicErosionShaderSrc,
      });

      // Create pipelines
      this.createFlowVelocityPipeline(flowVelocityShader);
      this.createFlowAccumulationPipeline(flowAccumulationShader);
      this.createSourceEmissionPipeline(sourceEmissionShader);
      this.createWaterAdvectionPipeline(waterAdvectionShader);
      this.createPoolDetectionPipeline(poolDetectionShader);
      this.createHydraulicErosionPipeline(hydraulicErosionShader);
    } catch (error) {
      console.error('FluidSystem: Failed to initialize pipelines', error);
    }
  }

  private createFlowVelocityPipeline(shaderModule: GPUShaderModule): void {
    // Pipeline creation will be implemented when shader is ready
    console.log('Creating flow velocity pipeline');
  }

  private createFlowAccumulationPipeline(shaderModule: GPUShaderModule): void {
    // Pipeline creation will be implemented when shader is ready
    console.log('Creating flow accumulation pipeline');
  }

  private createWaterAdvectionPipeline(shaderModule: GPUShaderModule): void {
    // Pipeline creation will be implemented when shader is ready
    console.log('Creating water advection pipeline');
  }

  private createPoolDetectionPipeline(shaderModule: GPUShaderModule): void {
    // Pipeline creation will be implemented when shader is ready
    console.log('Creating pool detection pipeline');
  }

  private createHydraulicErosionPipeline(shaderModule: GPUShaderModule): void {
    // Pipeline creation will be implemented when shader is ready
    console.log('Creating hydraulic erosion pipeline');
  }

  private createSourceEmissionPipeline(shaderModule: GPUShaderModule): void {
    // Pipeline creation will be implemented when shader is ready
    console.log('Creating source emission pipeline');
  }

  // Public API

  public addWaterSource(id: string, x: number, z: number, flowRate: number = FluidConfig.DEFAULT_WATER_FLOW_RATE): void {
    // Check if we've reached the source limit
    const totalSources = this.waterSources.size + this.lavaSources.size;
    if (totalSources >= FluidConfig.MAX_SOURCES && !this.waterSources.has(id)) {
      console.warn(`FluidSystem: Cannot add water source ${id}, max sources (${FluidConfig.MAX_SOURCES}) reached`);
      return;
    }

    this.waterSources.set(id, {
      id,
      position: [x, z],
      rate: flowRate,
    });
    this.updateSourceBuffer();
  }

  public addLavaSource(id: string, x: number, z: number, flowRate: number = FluidConfig.DEFAULT_LAVA_FLOW_RATE): void {
    // Check if we've reached the source limit
    const totalSources = this.waterSources.size + this.lavaSources.size;
    if (totalSources >= FluidConfig.MAX_SOURCES && !this.lavaSources.has(id)) {
      console.warn(`FluidSystem: Cannot add lava source ${id}, max sources (${FluidConfig.MAX_SOURCES}) reached`);
      return;
    }

    this.lavaSources.set(id, {
      id,
      position: [x, z],
      rate: flowRate,
    });
    this.updateSourceBuffer();
  }

  public removeSource(id: string): void {
    this.waterSources.delete(id);
    this.lavaSources.delete(id);
    this.updateSourceBuffer();
  }

  private updateSourceBuffer(): void {
    const sources: number[] = [];

    // Add water sources (type = 0)
    for (const source of this.waterSources.values()) {
      sources.push(source.position[0], source.position[1], source.rate, 0);
    }

    // Add lava sources (type = 1)
    for (const source of this.lavaSources.values()) {
      sources.push(source.position[0], source.position[1], source.rate, 1);
    }

    // Pad with zeros
    while (sources.length < 128 * 4) {
      sources.push(0, 0, 0, -1); // -1 type means inactive
    }

    const data = new Float32Array(sources);
    this.device.queue.writeBuffer(this.sourceBuffer, 0, data);
  }

  public setRainIntensity(intensity: number): void {
    this.rainIntensity = Math.max(0, intensity);
    this.updateParams();
  }

  public setEvaporationRate(rate: number): void {
    this.evaporationRate = Math.max(0, rate);
    this.updateParams();
  }

  private updateParams(deltaTime: number = 0, time: number = 0): void {
    const params = new Float32Array([
      // Physics (offset 0)
      this.gravity,
      this.evaporationRate,
      this.rainIntensity,
      this.simResolution,
      deltaTime,
      time,

      // Erosion (offset 24)
      FluidConfig.EROSION_RATE,
      FluidConfig.DEPOSITION_RATE,
      FluidConfig.CARRYING_CAPACITY_K,
      FluidConfig.MIN_WATER_FOR_EROSION,

      // Flow dynamics (offset 40)
      FluidConfig.FLOW_INERTIA,
      FluidConfig.MIN_FLOW_SPEED,
      FluidConfig.MAX_FLOW_SPEED,
      FluidConfig.ACCUMULATION_DECAY,
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
  }

  public update(encoder: GPUCommandEncoder, deltaTime: number, time: number): void {
    // Update parameters
    this.updateParams(deltaTime, time);

    // Run compute passes in order

    // 1. Emit from sources
    if (this.sourceEmissionPipeline && this.sourceEmissionBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Source Emission' });
      pass.setPipeline(this.sourceEmissionPipeline);
      pass.setBindGroup(0, this.sourceEmissionBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.simResolution / 8),
        Math.ceil(this.simResolution / 8)
      );
      pass.end();
    }

    // 2. Calculate flow velocity from height gradient
    if (this.flowVelocityPipeline && this.flowVelocityBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Flow Velocity' });
      pass.setPipeline(this.flowVelocityPipeline);
      pass.setBindGroup(0, this.flowVelocityBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.simResolution / 8),
        Math.ceil(this.simResolution / 8)
      );
      pass.end();
      this.pingPongState.flow = !this.pingPongState.flow;
    }

    // 3. Accumulate flow
    if (this.flowAccumulationPipeline && this.flowAccumulationBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Flow Accumulation' });
      pass.setPipeline(this.flowAccumulationPipeline);
      pass.setBindGroup(0, this.flowAccumulationBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.simResolution / 8),
        Math.ceil(this.simResolution / 8)
      );
      pass.end();
    }

    // 4. Advect water along flow field
    if (this.waterAdvectionPipeline && this.waterAdvectionBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Water Advection' });
      pass.setPipeline(this.waterAdvectionPipeline);
      pass.setBindGroup(0, this.waterAdvectionBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.simResolution / 8),
        Math.ceil(this.simResolution / 8)
      );
      pass.end();
      this.pingPongState.water = !this.pingPongState.water;
    }

    // 5. Detect pools
    if (this.poolDetectionPipeline && this.poolDetectionBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Pool Detection' });
      pass.setPipeline(this.poolDetectionPipeline);
      pass.setBindGroup(0, this.poolDetectionBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.simResolution / 8),
        Math.ceil(this.simResolution / 8)
      );
      pass.end();
    }

    // 6. Apply hydraulic erosion
    if (this.hydraulicErosionPipeline && this.hydraulicErosionBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Hydraulic Erosion' });
      pass.setPipeline(this.hydraulicErosionPipeline);
      pass.setBindGroup(0, this.hydraulicErosionBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.simResolution / 8),
        Math.ceil(this.simResolution / 8)
      );
      pass.end();
      this.pingPongState.sediment = !this.pingPongState.sediment;
    }
  }

  public getFlowTexture(): GPUTexture {
    return this.pingPongState.flow ? this.fields.flowOut : this.fields.flow;
  }

  public getWaterDepthTexture(): GPUTexture {
    return this.pingPongState.water ? this.fields.waterDepthOut : this.fields.waterDepth;
  }

  public getSedimentTexture(): GPUTexture {
    return this.pingPongState.sediment ? this.fields.sedimentOut : this.fields.sediment;
  }

  public destroy(): void {
    this.paramsBuffer.destroy();
    this.sourceBuffer.destroy();
  }
}