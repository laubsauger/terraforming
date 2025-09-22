import { Fields, createFields, DENSITIES } from './fields_optimized';
import { HandState, BrushOp, SmoothOp, handRemainingFixed_pickup, handRemainingFixed_deposit, materialKindToIndex } from './hand';
import { createBrushPipeline, createBrushBindGroupLayout } from '../gpu/pipelines/brush';
import { createApplyPipeline, createApplyBindGroupLayout } from '../gpu/pipelines/apply';
import { createReposePipeline, createReposeBindGroupLayout } from '../gpu/pipelines/repose';
import { createSmoothPipeline, createSmoothBindGroupLayout } from '../gpu/pipelines/smooth';
import { createSmoothDirectionalPipeline, SmoothDirectionalPipeline, SmoothDirectionalOp, executeSmoothDirectionalPass } from '../gpu/pipelines/smoothDirectional';
import { createFlattenPipeline, FlattenPipeline, FlattenOp, executeFlattenPass } from '../gpu/pipelines/flatten';

export interface BrushSystemOptions {
  gridSize: [number, number];  // [width, height] in cells
  cellSize: number;             // meters per cell
  angleOfRepose: number;        // degrees (typically ~33)
  handCapacityKg: number;       // max carrying capacity
}

export class BrushSystem {
  private device: GPUDevice;
  private fields: Fields;
  private options: BrushSystemOptions;

  // Pipelines
  private brushPipeline!: GPUComputePipeline;
  private applyPipeline!: GPUComputePipeline;
  private reposePipeline!: GPUComputePipeline;
  private smoothPipeline!: GPUComputePipeline;
  private smoothDirectionalPipeline!: SmoothDirectionalPipeline;
  private flattenPipeline!: FlattenPipeline;

  // Bind group layouts
  private brushLayout!: GPUBindGroupLayout;
  private applyLayout!: GPUBindGroupLayout;
  private reposeLayout!: GPUBindGroupLayout;
  private smoothLayout!: GPUBindGroupLayout;

  // Buffers
  private opsBuffer!: GPUBuffer;
  private smoothOpsBuffer!: GPUBuffer;
  private handBuffer!: GPUBuffer;
  private gridSizeBuffer!: GPUBuffer;
  private cellSizeBuffer!: GPUBuffer;
  private densitiesBuffer!: GPUBuffer;
  private tanPhiBuffer!: GPUBuffer;

  // State
  private hand: HandState;
  private pendingOps: BrushOp[] = [];
  private pendingSmoothOps: SmoothOp[] = [];
  private pendingSmoothDirectionalOps: SmoothDirectionalOp[] = [];
  private pendingFlattenOps: FlattenOp[] = [];

  constructor(device: GPUDevice, options: BrushSystemOptions) {
    this.device = device;
    this.options = options;
    this.fields = createFields(device, options.gridSize[0], options.gridSize[1]);
    this.hand = {
      kind: null,
      massKg: 0,
      capKg: options.handCapacityKg || 10000000, // Default to 10,000 tons
    };

    this.initializePipelines();
    this.initializeBuffers();
  }

  private initializePipelines(): void {
    this.brushLayout = createBrushBindGroupLayout(this.device);
    this.brushPipeline = createBrushPipeline(this.device, this.brushLayout);

    this.applyLayout = createApplyBindGroupLayout(this.device);
    this.applyPipeline = createApplyPipeline(this.device, this.applyLayout);

    this.reposeLayout = createReposeBindGroupLayout(this.device);
    this.reposePipeline = createReposePipeline(this.device, this.reposeLayout);

    this.smoothLayout = createSmoothBindGroupLayout(this.device);
    this.smoothPipeline = createSmoothPipeline(this.device, this.smoothLayout);

    this.smoothDirectionalPipeline = createSmoothDirectionalPipeline(this.device);
    this.flattenPipeline = createFlattenPipeline(this.device);
  }

  private initializeBuffers(): void {
    // Brush ops buffer (dynamic, for up to 16 simultaneous ops)
    this.opsBuffer = this.device.createBuffer({
      size: 16 * 32, // 16 ops * 32 bytes per op
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Smooth ops buffer (dynamic, for up to 16 simultaneous smooth ops)
    this.smoothOpsBuffer = this.device.createBuffer({
      size: 16 * 20, // 16 ops * 20 bytes per smooth op (center, radius, strength, dt)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Hand buffer (for atomic counter)
    this.handBuffer = this.device.createBuffer({
      size: 4, // single u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    // Uniform buffers
    this.gridSizeBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.gridSizeBuffer, 0,
      new Uint32Array(this.options.gridSize)
    );

    this.cellSizeBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.cellSizeBuffer, 0,
      new Float32Array([this.options.cellSize])
    );

    this.densitiesBuffer = this.device.createBuffer({
      size: 16, // vec4<f32>
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.densitiesBuffer, 0,
      new Float32Array([DENSITIES.soil, DENSITIES.rock, DENSITIES.lava, 0])
    );

    const tanPhi = Math.tan((this.options.angleOfRepose * Math.PI) / 180);
    this.tanPhiBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.tanPhiBuffer, 0,
      new Float32Array([tanPhi])
    );
  }

  public addBrushOp(
    mode: 'pickup' | 'deposit' | 'smooth' | 'smooth_raise' | 'smooth_lower' | 'flatten',
    material: 'soil' | 'rock' | 'lava',
    worldX: number,
    worldZ: number,
    radius: number,
    strength: number,
    dt: number,
    heightMeters?: number
  ): void {
    if (mode === 'smooth') {
      // Handle smoothing operations separately
      this.pendingSmoothOps.push({
        center: [worldX, worldZ],
        radius,
        strength: Math.min(strength / 1000, 1.0), // Convert strength to 0-1 range
        dt,
      });
      console.log('Added smooth op:', { worldX, worldZ, radius, strength });
      return;
    }

    if (mode === 'smooth_raise' || mode === 'smooth_lower') {
      // Handle directional smoothing
      this.pendingSmoothDirectionalOps.push({
        center: [worldX, worldZ],
        radius,
        strength: Math.min(strength / 1000, 1.0),
        mode: mode === 'smooth_raise' ? 1 : -1, // 1 = raise only, -1 = lower only
        dt,
      });
      console.log('Added smooth directional op:', { mode, worldX, worldZ, radius, strength });
      return;
    }

    if (mode === 'flatten') {
      // Handle flatten operations
      this.pendingFlattenOps.push({
        center: [worldX, worldZ],
        radius,
        strength: Math.min(strength / 100, 1.0), // Flatten strength scale
        dt,
      });
      console.log('Added flatten op:', { worldX, worldZ, radius, strength });
      return;
    }

    // For pickup mode with empty hand, set material to what we're picking up
    if (mode === 'pickup' && this.hand.kind === null) {
      this.hand.kind = material;
      console.log('Setting hand material to:', material);
    }

    // Only add operations if we have matching material or empty hand for pickup
    if (mode === 'pickup' || (mode === 'deposit' && this.hand.kind !== null)) {
      this.pendingOps.push({
        mode: mode === 'pickup' ? 0 : 1,
        kind: materialKindToIndex(material),
        center: [worldX, worldZ],
        radius,
        strengthKgPerS: strength,
        dt,
      });
      const heightNormalized = heightMeters !== undefined ? heightMeters / 64.0 : undefined;
      console.log('Added brush op:', {
        mode,
        material,
        worldX,
        worldZ,
        radius,
        strength,
        heightMeters: heightMeters !== undefined ? `${heightMeters.toFixed(1)}m` : 'unknown',
        heightNormalized: heightNormalized !== undefined ? heightNormalized.toFixed(3) : 'unknown',
        heightPercent: heightNormalized !== undefined ? `${(heightNormalized * 100).toFixed(1)}%` : 'unknown'
      });
    }
  }

  public setHandMaterial(kind: 'soil' | 'rock' | 'lava' | null): void {
    if (kind !== this.hand.kind) {
      // Drop current material if switching
      if (this.hand.kind !== null && this.hand.massKg > 0) {
        // Could implement auto-deposit here
        this.hand.massKg = 0;
      }
      this.hand.kind = kind;
    }
  }

  public getHandState(): HandState {
    return { ...this.hand };
  }

  public updateHandMass(deltaMass: number): void {
    this.hand.massKg = Math.max(0, Math.min(this.hand.capKg, this.hand.massKg + deltaMass));
  }

  public execute(commandEncoder: GPUCommandEncoder): void {
    const hasRegularOps = this.pendingOps.length > 0;
    const hasSmoothOps = this.pendingSmoothOps.length > 0;
    const hasSmoothDirectionalOps = this.pendingSmoothDirectionalOps.length > 0;
    const hasFlattenOps = this.pendingFlattenOps.length > 0;

    if (!hasRegularOps && !hasSmoothOps && !hasSmoothDirectionalOps && !hasFlattenOps) return;

    console.log('BrushSystem executing:',
      this.pendingOps.length, 'brush ops,',
      this.pendingSmoothOps.length, 'smooth ops,',
      this.pendingSmoothDirectionalOps.length, 'directional smooth ops,',
      this.pendingFlattenOps.length, 'flatten ops');

    // Handle regular brush operations
    if (hasRegularOps) {
      // Update ops buffer
      const opsData = new Float32Array(this.pendingOps.length * 8);
    this.pendingOps.forEach((op, i) => {
      const offset = i * 8;
      opsData[offset] = op.mode;
      opsData[offset + 1] = op.kind;
      opsData[offset + 2] = op.center[0];
      opsData[offset + 3] = op.center[1];
      opsData[offset + 4] = op.radius;
      opsData[offset + 5] = op.strengthKgPerS;
      opsData[offset + 6] = op.dt;
      opsData[offset + 7] = 0; // padding
    });
    this.device.queue.writeBuffer(this.opsBuffer, 0, opsData);

    // Update hand remaining buffer
    const isPickup = this.pendingOps.some(op => op.mode === 0);
    const remaining = isPickup
      ? handRemainingFixed_pickup(this.hand)
      : handRemainingFixed_deposit(this.hand);
    this.device.queue.writeBuffer(this.handBuffer, 0, new Uint32Array([remaining]));

    // Create bind groups using optimized RGBA textures
    const brushBindGroup = this.device.createBindGroup({
      layout: this.brushLayout,
      entries: [
        { binding: 0, resource: { buffer: this.opsBuffer } },
        { binding: 1, resource: { buffer: this.handBuffer } },
        { binding: 2, resource: this.fields.fields.createView() },    // Combined RGBA fields
        { binding: 3, resource: this.fields.deltas.createView() },    // Combined RGBA deltas
        { binding: 4, resource: { buffer: this.gridSizeBuffer } },
        { binding: 5, resource: { buffer: this.cellSizeBuffer } },
        { binding: 6, resource: { buffer: this.densitiesBuffer } },
      ],
    });

    const applyBindGroup = this.device.createBindGroup({
      layout: this.applyLayout,
      entries: [
        { binding: 0, resource: this.fields.fields.createView() },    // Combined RGBA fields input
        { binding: 1, resource: this.fields.fieldsOut.createView() }, // Combined RGBA fields output
        { binding: 2, resource: this.fields.deltas.createView() },    // Combined RGBA deltas
        { binding: 3, resource: { buffer: this.gridSizeBuffer } },
      ],
    });

    // Brush pass
    {
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.brushPipeline);
      pass.setBindGroup(0, brushBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.options.gridSize[0] / 8),
        Math.ceil(this.options.gridSize[1] / 8)
      );
      pass.end();
    }

    // Apply deltas pass
    {
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.applyPipeline);
      pass.setBindGroup(0, applyBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.options.gridSize[0] / 8),
        Math.ceil(this.options.gridSize[1] / 8)
      );
      pass.end();
    }

      // Copy fieldsOut back to fields
      commandEncoder.copyTextureToTexture(
        { texture: this.fields.fieldsOut },
        { texture: this.fields.fields },
        { width: this.options.gridSize[0], height: this.options.gridSize[1] }
      );

      // Clear deltas texture for next frame
      // Note: We need a clear pass or reset the texture somehow
      // For now, this is handled by writing zeros in the next brush pass
    }

    // Handle smoothing operations
    if (hasSmoothOps) {
      // Update smooth ops buffer
      const smoothOpsData = new Float32Array(this.pendingSmoothOps.length * 5); // 5 floats per op
      this.pendingSmoothOps.forEach((op, i) => {
        const offset = i * 5;
        smoothOpsData[offset] = op.center[0];     // x
        smoothOpsData[offset + 1] = op.center[1]; // z
        smoothOpsData[offset + 2] = op.radius;
        smoothOpsData[offset + 3] = op.strength;
        smoothOpsData[offset + 4] = op.dt;
      });
      this.device.queue.writeBuffer(this.smoothOpsBuffer, 0, smoothOpsData);

      const smoothBindGroup = this.device.createBindGroup({
        layout: this.smoothLayout,
        entries: [
          { binding: 0, resource: { buffer: this.smoothOpsBuffer } },
          { binding: 1, resource: this.fields.fields.createView() },    // Input
          { binding: 2, resource: this.fields.fieldsOut.createView() }, // Output
          { binding: 3, resource: { buffer: this.gridSizeBuffer } },
          { binding: 4, resource: { buffer: this.cellSizeBuffer } },
        ],
      });

      // Smoothing pass
      {
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.smoothPipeline);
        pass.setBindGroup(0, smoothBindGroup);
        pass.dispatchWorkgroups(
          Math.ceil(this.options.gridSize[0] / 8),
          Math.ceil(this.options.gridSize[1] / 8)
        );
        pass.end();
      }

      // Copy smoothed result back to fields
      commandEncoder.copyTextureToTexture(
        { texture: this.fields.fieldsOut },
        { texture: this.fields.fields },
        { width: this.options.gridSize[0], height: this.options.gridSize[1] }
      );
    }

    // Thermal repose (3 iterations)
    for (let iter = 0; iter < 3; iter++) {
      // Skip thermal repose if legacy textures are not available
      if (!this.fields.rock || !this.fields.soil || !this.fields.soilOut) {
        continue;
      }

      const reposeBindGroup = this.device.createBindGroup({
        layout: this.reposeLayout,
        entries: [
          { binding: 0, resource: this.fields.rock.createView() },
          { binding: 1, resource: (iter % 2 === 0) ? this.fields.soil.createView() : this.fields.soilOut.createView() },
          { binding: 2, resource: (iter % 2 === 0) ? this.fields.soilOut.createView() : this.fields.soil.createView() },
          { binding: 3, resource: { buffer: this.gridSizeBuffer } },
          { binding: 4, resource: { buffer: this.cellSizeBuffer } },
          { binding: 5, resource: { buffer: this.tanPhiBuffer } },
        ],
      });

      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.reposePipeline);
      pass.setBindGroup(0, reposeBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.options.gridSize[0] / 8),
        Math.ceil(this.options.gridSize[1] / 8)
      );
      pass.end();

      // Note: Clearing output texture would need a separate compute pass
      // For now, the ping-pong pattern handles this
    }

    // Ensure final result is in soil texture
    if (3 % 2 === 1 && this.fields.soilOut && this.fields.soil) {
      // Copy soilOut back to soil
      commandEncoder.copyTextureToTexture(
        { texture: this.fields.soilOut },
        { texture: this.fields.soil },
        { width: this.options.gridSize[0], height: this.options.gridSize[1] }
      );
    }

    // Execute directional smoothing operations
    if (hasSmoothDirectionalOps) {
      executeSmoothDirectionalPass(
        this.device,
        this.smoothDirectionalPipeline,
        commandEncoder,
        this.fields.fields,
        this.fields.fieldsOut,
        this.pendingSmoothDirectionalOps,
        this.options.gridSize,
        this.options.cellSize
      );

      // Copy result back to fields
      commandEncoder.copyTextureToTexture(
        { texture: this.fields.fieldsOut },
        { texture: this.fields.fields },
        { width: this.options.gridSize[0], height: this.options.gridSize[1] }
      );
    }

    // Execute flatten operations
    if (hasFlattenOps) {
      executeFlattenPass(
        this.device,
        this.flattenPipeline,
        commandEncoder,
        this.fields.fields,
        this.fields.fieldsOut,
        this.pendingFlattenOps,
        this.options.gridSize,
        this.options.cellSize
      );

      // Copy result back to fields
      commandEncoder.copyTextureToTexture(
        { texture: this.fields.fieldsOut },
        { texture: this.fields.fields },
        { width: this.options.gridSize[0], height: this.options.gridSize[1] }
      );
    }

    // Clear pending ops
    this.pendingOps = [];
    this.pendingSmoothOps = [];
    this.pendingSmoothDirectionalOps = [];
    this.pendingFlattenOps = [];
  }

  public getFields(): Fields {
    return this.fields;
  }

  public destroy(): void {
    // Destroy textures
    Object.values(this.fields).forEach(tex => tex.destroy());

    // Destroy buffers
    this.opsBuffer.destroy();
    this.smoothOpsBuffer.destroy();
    this.handBuffer.destroy();
    this.gridSizeBuffer.destroy();
    this.cellSizeBuffer.destroy();
    this.densitiesBuffer.destroy();
    this.tanPhiBuffer.destroy();
  }
}