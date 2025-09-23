import { Fields, createFieldTex, createFlowTex, createFlowSampledTex, createMaskTex, createDepthTex } from './fields';
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
  fields: any; // Accept any fields structure from BrushSystem
  resolution: number;
  simResolution?: number; // Run sim at lower res for performance
  gravity?: number;
  evaporationRate?: number;
  rainIntensity?: number;
}

export class FluidSystem {
  private device: GPUDevice;
  private fields!: Fields; // Initialized in initializeFields()
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
  private hydraulicErosionBindGroupLayout: GPUBindGroupLayout | null = null;
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
    this.resolution = options.resolution;
    this.simResolution = options.simResolution ?? Math.floor(options.resolution * FluidConfig.SIMULATION_SCALE);

    // Set default parameters from config
    this.gravity = options.gravity ?? FluidConfig.GRAVITY;
    this.evaporationRate = options.evaporationRate ?? FluidConfig.EVAPORATION_RATE;
    this.rainIntensity = options.rainIntensity ?? 0.0;

    // Initialize fields - create missing fluid textures if needed
    this.initializeFields(options.fields);

    // Create uniform buffers
    this.paramsBuffer = this.createParamsBuffer();
    this.sourceBuffer = this.createSourceBuffer();

    // Initialize pipelines (deferred until shaders are ready)
    this.initPipelines();
  }

  private initializeFields(inputFields: any): void {
    const w = this.resolution;
    const h = this.resolution;

    // Start with the provided fields (should have soil, rock, lava from BrushSystem)
    this.fields = { ...inputFields } as Fields;

    // Create fluid-specific textures if they don't exist
    if (!this.fields.flow) {
      this.fields.flow = createFlowTex(this.device, w, h);
    }
    if (!this.fields.flowOut) {
      this.fields.flowOut = createFlowTex(this.device, w, h);
    }
    if (!this.fields.flowSampled) {
      this.fields.flowSampled = createFlowSampledTex(this.device, w, h);
    }
    if (!this.fields.waterDepth) {
      this.fields.waterDepth = createDepthTex(this.device, w, h);
    }
    if (!this.fields.waterDepthOut) {
      this.fields.waterDepthOut = createDepthTex(this.device, w, h);
    }
    if (!this.fields.waterDepthSampled) {
      this.fields.waterDepthSampled = this.device.createTexture({
        size: { width: w, height: h },
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      });
    }
    if (!this.fields.flowAccumulation) {
      this.fields.flowAccumulation = createFieldTex(this.device, w, h);
    }
    if (!this.fields.poolMask) {
      this.fields.poolMask = createMaskTex(this.device, w, h);
    }
    if (!this.fields.temperature) {
      this.fields.temperature = createDepthTex(this.device, w, h);
    }
    if (!this.fields.sediment) {
      this.fields.sediment = createDepthTex(this.device, w, h);
    }
    if (!this.fields.sedimentOut) {
      this.fields.sedimentOut = createDepthTex(this.device, w, h);
    }

    // Validate required terrain fields exist
    if (!this.fields.soil || !this.fields.rock || !this.fields.lava) {
      throw new Error('FluidSystem requires soil, rock, and lava textures from BrushSystem');
    }
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
      this.resolution,
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
      // Create shader modules with individual error handling
      console.log('FluidSystem: Creating shader modules...');

      const flowVelocityShader = this.device.createShaderModule({
        label: 'Flow Velocity Shader',
        code: flowVelocityShaderSrc,
      });
      console.log('FluidSystem: Flow Velocity shader created successfully');

      const flowAccumulationShader = this.device.createShaderModule({
        label: 'Flow Accumulation Shader',
        code: flowAccumulationShaderSrc,
      });
      console.log('FluidSystem: Flow Accumulation shader created successfully');

      const sourceEmissionShader = this.device.createShaderModule({
        label: 'Source Emission Shader',
        code: sourceEmissionShaderSrc,
      });
      console.log('FluidSystem: Source Emission shader created successfully');

      const waterAdvectionShader = this.device.createShaderModule({
        label: 'Water Advection Shader',
        code: waterAdvectionShaderSrc,
      });
      console.log('FluidSystem: Water Advection shader created successfully');

      const poolDetectionShader = this.device.createShaderModule({
        label: 'Pool Detection Shader',
        code: poolDetectionShaderSrc,
      });
      console.log('FluidSystem: Pool Detection shader created successfully');

      const hydraulicErosionShader = this.device.createShaderModule({
        label: 'Hydraulic Erosion Shader',
        code: hydraulicErosionShaderSrc,
      });
      console.log('FluidSystem: Hydraulic Erosion shader created successfully');

      // Create pipelines with individual error handling
      console.log('FluidSystem: Creating compute pipelines...');

      try {
        this.createFlowVelocityPipeline(flowVelocityShader);
        console.log('FluidSystem: Flow Velocity pipeline created successfully');
      } catch (e) {
        console.error('FluidSystem: Failed to create Flow Velocity pipeline:', e);
      }

      try {
        this.createFlowAccumulationPipeline(flowAccumulationShader);
        console.log('FluidSystem: Flow Accumulation pipeline created successfully');
      } catch (e) {
        console.error('FluidSystem: Failed to create Flow Accumulation pipeline:', e);
      }

      try {
        this.createSourceEmissionPipeline(sourceEmissionShader);
        console.log('FluidSystem: Source Emission pipeline created successfully');
      } catch (e) {
        console.error('FluidSystem: Failed to create Source Emission pipeline:', e);
      }

      try {
        this.createWaterAdvectionPipeline(waterAdvectionShader);
        console.log('FluidSystem: Water Advection pipeline created successfully');
      } catch (e) {
        console.error('FluidSystem: Failed to create Water Advection pipeline:', e);
      }

      try {
        this.createPoolDetectionPipeline(poolDetectionShader);
        console.log('FluidSystem: Pool Detection pipeline created successfully');
      } catch (e) {
        console.error('FluidSystem: Failed to create Pool Detection pipeline:', e);
      }

      try {
        this.createHydraulicErosionPipeline(hydraulicErosionShader);
        console.log('FluidSystem: Hydraulic Erosion pipeline created successfully');
      } catch (e) {
        console.error('FluidSystem: Failed to create Hydraulic Erosion pipeline:', e);
      }

    } catch (error) {
      console.error('FluidSystem: Failed to initialize pipelines', error);
    }
  }

  private createFlowVelocityPipeline(shaderModule: GPUShaderModule): void {
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // height texture (combined soil+rock)
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'rg32float' } }, // flow in
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float' } }, // flow out
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // roughness texture
        { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'r32float' } }, // water depth
      ]
    });

    this.flowVelocityPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Create bind group
    this.flowVelocityBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: this.fields.soil.createView() }, // Use soil as height for now
        { binding: 2, resource: this.fields.flow.createView() },
        { binding: 3, resource: this.fields.flowOut.createView() },
        { binding: 4, resource: this.fields.rock.createView() }, // Use rock as roughness for now
        { binding: 5, resource: this.fields.waterDepth.createView() }, // Water depth
      ]
    });
  }

  private createFlowAccumulationPipeline(shaderModule: GPUShaderModule): void {
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // flow field
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // accumulation
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // height field
      ]
    });

    this.flowAccumulationPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Create bind group - Note: flow field needs to be a sampled texture, not storage
    this.flowAccumulationBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: this.fields.flowSampled.createView() }, // Flow field as sampled texture
        { binding: 2, resource: this.fields.flowAccumulation.createView() },
        { binding: 3, resource: this.fields.soil.createView() }, // Use soil as height field
      ]
    });
  }

  private createWaterAdvectionPipeline(shaderModule: GPUShaderModule): void {
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'rg32float' } }, // flow
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'r32float' } }, // water depth in
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } }, // water depth out
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // height texture
      ]
    });

    this.waterAdvectionPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Create bind group
    this.waterAdvectionBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: this.fields.flow.createView() },
        { binding: 2, resource: this.fields.waterDepth.createView() },
        { binding: 3, resource: this.fields.waterDepthOut.createView() },
        { binding: 4, resource: this.fields.soil.createView() }, // Use soil as height
      ]
    });
  }

  private createPoolDetectionPipeline(shaderModule: GPUShaderModule): void {
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // flow (sampled)
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'r32float' } }, // water depth (storage)
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } }, // pool mask
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // height
      ]
    });

    this.poolDetectionPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Create bind group
    this.poolDetectionBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: this.fields.flowSampled.createView() }, // Use sampled flow texture
        { binding: 2, resource: this.fields.waterDepth.createView() }, // Water depth storage texture
        { binding: 3, resource: this.fields.poolMask.createView() },
        { binding: 4, resource: this.fields.soil.createView() }, // Use soil as height
      ]
    });
  }

  private createHydraulicErosionPipeline(shaderModule: GPUShaderModule): void {
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // flow (sampled)
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // water depth (sampled)
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // soil
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'r32float' } }, // sediment in
        { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } }, // sediment out
        { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } }, // flow accumulation
      ]
    });

    this.hydraulicErosionPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Store bind group layout for dynamic bind group creation
    this.hydraulicErosionBindGroupLayout = bindGroupLayout;
    this.hydraulicErosionBindGroup = null;
  }

  private createSourceEmissionPipeline(shaderModule: GPUShaderModule): void {
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // params
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // sources
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // water depth
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // lava depth (using lava field)
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // temperature
      ]
    });

    this.sourceEmissionPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Create bind group
    this.sourceEmissionBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.sourceBuffer } },
        { binding: 2, resource: this.fields.waterDepth.createView() },
        { binding: 3, resource: this.fields.lava.createView() }, // Use lava field for lava depth
        { binding: 4, resource: this.fields.temperature.createView() },
      ]
    });
  }

  // Public API

  public addWaterSource(id: string, x: number, z: number, flowRate: number = FluidConfig.DEFAULT_WATER_FLOW_RATE): void {
    // Check if we've reached the source limit
    const totalSources = this.waterSources.size + this.lavaSources.size;
    if (totalSources >= FluidConfig.MAX_SOURCES && !this.waterSources.has(id)) {
      console.warn(`FluidSystem: Cannot add water source ${id}, max sources (${FluidConfig.MAX_SOURCES}) reached`);
      return;
    }

    // Normalize coordinates to 0-1 range for the shader
    // x and z are in grid coordinates (0-256), need to normalize to 0-1
    const normalizedX = x / this.resolution;
    const normalizedZ = z / this.resolution;

    this.waterSources.set(id, {
      id,
      position: [normalizedX, normalizedZ],
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

    // Normalize coordinates to 0-1 range for the shader
    // x and z are in grid coordinates (0-256), need to normalize to 0-1
    const normalizedX = x / this.resolution;
    const normalizedZ = z / this.resolution;

    this.lavaSources.set(id, {
      id,
      position: [normalizedX, normalizedZ],
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

    // Debug: Log first few sources
    if (this.waterSources.size > 0 || this.lavaSources.size > 0) {
      console.log('FluidSystem: Updated source buffer with', this.waterSources.size, 'water sources and', this.lavaSources.size, 'lava sources');
      console.log('FluidSystem: First source data:', data.slice(0, 16));
    }
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
    // Log deltaTime if it's unusual
    if (deltaTime === 0 || deltaTime > 1) {
      console.warn('FluidSystem: Unusual deltaTime', { deltaTime, time });
    }

    const params = new Float32Array([
      // Physics (offset 0)
      this.gravity,
      this.evaporationRate,
      this.rainIntensity,
      this.resolution,
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
    // Debug logging to verify simulation is running
    if (Math.floor(time) % 2 === 0 && Math.floor(time * 10) % 10 === 0) { // Log every 2 seconds
      console.log('FluidSystem: Running simulation update', {
        deltaTime,
        time,
        waterSources: this.waterSources.size,
        lavaSources: this.lavaSources.size
      });
    }
    // Update parameters
    this.updateParams(deltaTime, time);

    // Run compute passes in order

    // 1. Emit from sources
    if (this.sourceEmissionPipeline && this.sourceEmissionBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Source Emission' });
      pass.setPipeline(this.sourceEmissionPipeline);
      pass.setBindGroup(0, this.sourceEmissionBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.resolution / 8),
        Math.ceil(this.resolution / 8)
      );
      pass.end();

      // Debug log emission pass every 2 seconds
      if (Math.floor(time) % 2 === 0 && Math.floor(time * 10) % 10 === 0) {
        console.log('FluidSystem: Source emission pass executed', {
          resolution: this.resolution,
          workgroups: Math.ceil(this.resolution / 8)
        });
      }
    } else {
      if (!this.sourceEmissionPipeline) {
        console.warn('FluidSystem: No source emission pipeline');
      }
      if (!this.sourceEmissionBindGroup) {
        console.warn('FluidSystem: No source emission bind group');
      }
    }

    // 2. Calculate flow velocity from height gradient
    if (this.flowVelocityPipeline && this.flowVelocityBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Flow Velocity' });
      pass.setPipeline(this.flowVelocityPipeline);
      pass.setBindGroup(0, this.flowVelocityBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.resolution / 8),
        Math.ceil(this.resolution / 8)
      );
      pass.end();
      this.pingPongState.flow = !this.pingPongState.flow;

      // Debug log flow velocity pass
      if (Math.floor(time) % 5 === 0 && Math.floor(time * 10) % 10 === 0) {
        console.log('FluidSystem: Flow Velocity pass executed');
      }

      // Copy the updated flow texture to sampled texture for use in other passes
      const currentFlow = this.pingPongState.flow ? this.fields.flow : this.fields.flowOut;
      encoder.copyTextureToTexture(
        { texture: currentFlow },
        { texture: this.fields.flowSampled },
        { width: this.resolution, height: this.resolution }
      );
    }

    // 3. Accumulate flow
    if (this.flowAccumulationPipeline && this.flowAccumulationBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Flow Accumulation' });
      pass.setPipeline(this.flowAccumulationPipeline);
      pass.setBindGroup(0, this.flowAccumulationBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.resolution / 8),
        Math.ceil(this.resolution / 8)
      );
      pass.end();
    }

    // 4. Advect water along flow field
    if (this.waterAdvectionPipeline && this.waterAdvectionBindGroup) {
      const pass = encoder.beginComputePass({ label: 'Water Advection' });
      pass.setPipeline(this.waterAdvectionPipeline);
      pass.setBindGroup(0, this.waterAdvectionBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.resolution / 8),
        Math.ceil(this.resolution / 8)
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
        Math.ceil(this.resolution / 8),
        Math.ceil(this.resolution / 8)
      );
      pass.end();
    }

    // Copy textures for hydraulic erosion (needs sampled textures)
    const flowTexture = this.getFlowTexture();
    const waterDepthTexture = this.getWaterDepthTexture();

    if (flowTexture && this.fields.flowSampled) {
      encoder.copyTextureToTexture(
        { texture: flowTexture },
        { texture: this.fields.flowSampled },
        { width: this.simResolution, height: this.simResolution }
      );
    }

    if (waterDepthTexture && this.fields.waterDepthSampled) {
      encoder.copyTextureToTexture(
        { texture: waterDepthTexture },
        { texture: this.fields.waterDepthSampled },
        { width: this.simResolution, height: this.simResolution }
      );
    }

    // 6. Apply hydraulic erosion
    if (this.hydraulicErosionPipeline && this.hydraulicErosionBindGroupLayout) {
      // Create bind group with current ping-pong state
      const currentSediment = this.pingPongState.sediment ? this.fields.sedimentOut : this.fields.sediment;
      const outputSediment = this.pingPongState.sediment ? this.fields.sediment : this.fields.sedimentOut;

      const bindGroup = this.device.createBindGroup({
        layout: this.hydraulicErosionBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer } },
          { binding: 1, resource: this.fields.flowSampled.createView() },
          { binding: 2, resource: this.fields.waterDepthSampled.createView() },
          { binding: 3, resource: this.fields.soil.createView() },
          { binding: 4, resource: currentSediment.createView() }, // Read from current
          { binding: 5, resource: outputSediment.createView() }, // Write to output
          { binding: 6, resource: this.fields.flowAccumulation.createView() },
        ]
      });

      const pass = encoder.beginComputePass({ label: 'Hydraulic Erosion' });
      pass.setPipeline(this.hydraulicErosionPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.resolution / 8),
        Math.ceil(this.resolution / 8)
      );
      pass.end();
      this.pingPongState.sediment = !this.pingPongState.sediment;
    }
  }

  public getFlowTexture(): GPUTexture {
    const texture = this.pingPongState.flow ? this.fields.flowOut : this.fields.flow;
    if (!texture) {
      console.error('FluidSystem: Flow texture is undefined!', {
        pingPongFlow: this.pingPongState.flow,
        hasFlow: !!this.fields.flow,
        hasFlowOut: !!this.fields.flowOut
      });
    }
    return texture;
  }

  public getWaterDepthTexture(): GPUTexture {
    const texture = this.pingPongState.water ? this.fields.waterDepthOut : this.fields.waterDepth;
    if (!texture) {
      console.error('FluidSystem: Water depth texture is undefined!', {
        pingPongWater: this.pingPongState.water,
        hasWaterDepth: !!this.fields.waterDepth,
        hasWaterDepthOut: !!this.fields.waterDepthOut
      });
    }
    return texture;
  }

  public getSedimentTexture(): GPUTexture {
    return this.pingPongState.sediment ? this.fields.sedimentOut : this.fields.sediment;
  }

  public getFlowAccumulationTexture(): GPUTexture {
    return this.fields.flowAccumulation;
  }

  public getPoolMaskTexture(): GPUTexture {
    return this.fields.poolMask;
  }

  public getTemperatureTexture(): GPUTexture {
    return this.fields.temperature;
  }

  public getLavaDepthTexture(): GPUTexture {
    return this.fields.lava;
  }

  // Debug method to read back water depth values
  public async debugWaterDepth(): Promise<void> {
    const waterDepthTexture = this.getWaterDepthTexture();
    if (!waterDepthTexture) return;

    // Create a buffer to copy texture data to
    const bytesPerPixel = 4; // r32float = 4 bytes
    const bufferSize = this.resolution * this.resolution * bytesPerPixel;
    const readBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    // Copy texture to buffer
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: waterDepthTexture },
      { buffer: readBuffer, bytesPerRow: this.resolution * bytesPerPixel },
      { width: this.resolution, height: this.resolution }
    );
    this.device.queue.submit([encoder.finish()]);

    // Read buffer
    await readBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = readBuffer.getMappedRange();
    const data = new Float32Array(arrayBuffer);

    // Find non-zero values
    let maxValue = 0;
    let nonZeroCount = 0;
    let sampleValues: number[] = [];

    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0) {
        nonZeroCount++;
        maxValue = Math.max(maxValue, data[i]);
        if (sampleValues.length < 10) {
          sampleValues.push(data[i]);
        }
      }
    }

    console.log('FluidSystem: Water depth debug:', {
      totalPixels: data.length,
      nonZeroPixels: nonZeroCount,
      maxWaterDepth: maxValue,
      sampleValues: sampleValues,
      waterSources: Array.from(this.waterSources.values()),
      lavaSources: Array.from(this.lavaSources.values())
    });

    readBuffer.unmap();
    readBuffer.destroy();
  }

  public destroy(): void {
    this.paramsBuffer.destroy();
    this.sourceBuffer.destroy();
  }
}