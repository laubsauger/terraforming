import type {
  BrushOp,
  DebugOverlay,
  EngineOpts,
  PerfSample,
  QualityOpts,
  Source,
  Unsub,
} from '@terraforming/types';
import * as THREE from 'three/webgpu';
import { TerrainRenderer } from './render/TerrainRenderer';
import { BrushSystem } from './sim/BrushSystem';
import { FluidSystem } from './sim/FluidSystem';
import { FluidConfig } from './sim/FluidConfig';

export type {
  BrushOp,
  DebugOverlay,
  EngineOpts,
  PerfCounters,
  PerfGpuPassTiming,
  PerfSample,
  QualityOpts,
  Source,
  Unsub,
} from '@terraforming/types';

// Export FluidConfig for UI usage
export { FluidConfig } from './sim/FluidConfig';

export interface Engine {
  canvas: HTMLCanvasElement;
  opts: EngineOpts;
  setRunState(running: boolean): void;
  setTimeScale(mult: number): void;
  setQuality(opts: QualityOpts): void;
  brush: {
    enqueue(op: BrushOp): void;
  };
  sources: {
    set(kind: 'water' | 'lava', list: Source[]): void;
  };
  debug: {
    setOverlay(kind: DebugOverlay | 'none'): void;
  };
  perf: {
    onSample(cb: (sample: PerfSample) => void): Unsub;
  };
  dayNight: {
    setTimeOfDay(time: number): void;
    setActive(active: boolean): void;
    setCycleSpeed(speed: number): void;
  };
  getScene(): THREE.Scene | null;
  getCamera(): THREE.Camera | null;
  getTerrainMesh(): THREE.Mesh | null;
  getTerrainHeightAt(worldX: number, worldZ: number): number | null;
  updateHeightmap(data: Float32Array): void;
  getCurrentHeightmap(): Float32Array | null;
  applyHeightmap(data: Float32Array, size: number): void;
  getGridSize(): number;
  dispose(): void;
}

export async function initEngine(
  canvas: HTMLCanvasElement,
  opts: EngineOpts = {}
): Promise<Engine> {
  if (!canvas) {
    throw new Error('initEngine requires a target canvas element');
  }

  await ensureWebGpuSupport(opts);
  const engine = new StubEngine(canvas, opts);
  engine.initialize();
  return engine;
}

async function ensureWebGpuSupport(_opts: EngineOpts): Promise<GPUAdapter> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    throw new Error('WebGPU is not available in this environment');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });

  if (!adapter) {
    throw new Error('Failed to acquire a WebGPU adapter');
  }

  return adapter;
}

class StubEngine implements Engine {
  public readonly canvas: HTMLCanvasElement;
  public readonly opts: EngineOpts;

  private renderer?: TerrainRenderer;
  private brushSystem?: BrushSystem;
  private gpuDevice?: GPUDevice;
  private simulationPaused = true;  // Simulation starts paused
  private renderingActive = true;   // Renderer runs by default
  private timeScale = 1;
  private quality: QualityOpts = { simResolution: 512, simSubsteps: 1 };
  private overlay: DebugOverlay | 'none' = 'contours'; // Contours enabled by default
  private readonly brushQueue: BrushOp[] = [];
  private readonly sourceMap: Record<'water' | 'lava', Source[]> = {
    water: [],
    lava: [],
  };
  private rafHandle: number | null = null;
  private frameId = 0;
  private readonly sampleListeners = new Set<(sample: PerfSample) => void>();
  private disposed = false;
  private lastFrameTime = 0;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts) {
    this.canvas = canvas;
    this.opts = opts;
  }

  async initialize(): Promise<void> {
    // Don't initialize if already disposed
    if (this.disposed) {
      return;
    }

    // Get GPU device first
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) {
        throw new Error('Failed to get GPU adapter');
      }

      this.gpuDevice = await adapter.requestDevice({
        requiredLimits: {
          maxStorageTexturesPerShaderStage: 8, // Request higher limit for complex shaders
        },
      });

      // Initialize BrushSystem
      this.brushSystem = new BrushSystem(this.gpuDevice, {
        gridSize: [256, 256],
        cellSize: 100 / 256, // terrainSize / gridSize
        angleOfRepose: 33,
        handCapacityKg: 100000000, // 100,000 tons capacity - mountain scale!
      });
    } catch (error) {
      console.error('Failed to initialize GPU device:', error);
    }

    // Initialize the renderer (BaseRenderer will handle sizing)
    try {
      this.renderer = new TerrainRenderer({
        canvas: this.canvas,
        gridSize: 256,
        terrainSize: 100,
      });
      // Pass BrushSystem to renderer if available
      if (this.brushSystem && this.renderer) {
        (this.renderer as any).brushSystem = this.brushSystem;
      }
    } catch (error) {
      console.error('Failed to initialize renderer:', error);
    }

    // Start the render loop immediately (simulation stays paused)
    if (!this.disposed) {
      this.startLoop();
    }
  }

  setRunState(running: boolean): void {
    this.simulationPaused = !running;
    // Note: Renderer keeps running regardless of simulation state
  }

  setTimeScale(mult: number): void {
    this.timeScale = Math.max(0.1, mult);
  }

  setQuality(opts: QualityOpts): void {
    this.quality = { ...this.quality, ...opts };
  }

  get brush() {
    return {
      enqueue: (op: BrushOp) => {
        this.brushQueue.push(op);
      },
    };
  }

  get sources() {
    return {
      set: (kind: 'water' | 'lava', list: Source[]) => {
        this.sourceMap[kind] = [...list];
      },
    };
  }

  get debug() {
    return {
      setOverlay: (kind: DebugOverlay | 'none') => {
        const previousOverlay = this.overlay;
        this.overlay = kind;
        // Update renderer with new debug overlay system
        if (this.renderer) {
          // Convert single overlay to array for the new system
          const overlays: DebugOverlay[] = kind === 'none' ? [] : [kind];
          this.renderer.setDebugOverlays(overlays);
        }
      },
    };
  }

  get dayNight() {
    return {
      setTimeOfDay: (time: number) => {
        if (this.renderer) {
          this.renderer.setTimeOfDay(time);
        }
      },
      setActive: (active: boolean) => {
        if (this.renderer) {
          this.renderer.setDayNightCycleActive(active);
        }
      },
      setCycleSpeed: (speed: number) => {
        if (this.renderer) {
          this.renderer.setCycleSpeed(speed);
        }
      },
    };
  }

  get perf() {
    return {
      onSample: (cb: (sample: PerfSample) => void): Unsub => {
        this.sampleListeners.add(cb);
        return () => this.sampleListeners.delete(cb);
      },
    };
  }

  /**
   * Get Three.js scene for advanced interaction
   */
  getScene(): THREE.Scene | null {
    return this.renderer?.getScene() || null;
  }

  /**
   * Get Three.js camera for raycasting
   */
  getCamera(): THREE.Camera | null {
    return this.renderer?.getCamera() || null;
  }

  /**
   * Get terrain mesh for raycasting
   */
  getTerrainMesh(): THREE.Mesh | null {
    return this.renderer?.getTerrainMesh() || null;
  }

  /**
   * Get height at world position by sampling terrain height texture
   */
  getTerrainHeightAt(worldX: number, worldZ: number): number | null {
    return this.renderer?.getHeightAtWorldPos(worldX, worldZ) || null;
  }

  updateHeightmap(data: Float32Array): void {
    if (this.renderer) {
      this.renderer.updateHeightmap(data);
    }
  }

  /**
   * Get current heightmap data from the terrain
   */
  getCurrentHeightmap(): Float32Array | null {
    if (this.renderer) {
      return this.renderer.getCurrentHeightmap();
    }
    return null;
  }

  applyHeightmap(data: Float32Array, size: number): void {
    if (this.renderer) {
      this.renderer.updateHeightmap(data);
    }
  }

  getGridSize(): number {
    return this.renderer ? (this.renderer as any).gridSize || 256 : 256;
  }

  /**
   * Add a water source at the specified position
   * @param worldY - Optional Y position, if not provided will be calculated from terrain height
   */
  addWaterSource(worldX: number, worldZ: number, flowRate: number = 10, worldY?: number): string | null {
    if (this.renderer) {
      return this.renderer.addWaterSource(worldX, worldZ, flowRate, worldY);
    }
    return null;
  }

  /**
   * Add a lava source at the specified position
   * @param worldY - Optional Y position, if not provided will be calculated from terrain height
   */
  addLavaSource(worldX: number, worldZ: number, flowRate: number = 10, worldY?: number): string | null {
    if (this.renderer) {
      return this.renderer.addLavaSource(worldX, worldZ, flowRate, worldY);
    }
    return null;
  }

  /**
   * Remove a source by ID
   */
  removeSource(id: string): boolean {
    if (this.renderer) {
      return this.renderer.removeSource(id);
    }
    return false;
  }

  /**
   * Toggle visibility of source indicators
   */
  setSourceIndicatorsVisible(visible: boolean): void {
    if (this.renderer) {
      this.renderer.setSourceIndicatorsVisible(visible);
    }
  }

  private applyBrushToTerrain(op: BrushOp): void {
    if (!this.renderer) return;

    const heightTexture = (this.renderer as any).getHeightTexture?.();
    if (!heightTexture) return;

    const data = heightTexture.image.data as Float32Array;
    const gridSize = 256; // Grid size
    const terrainSize = 100; // World size in meters

    // Convert world coordinates to texture coordinates
    // Note: Z axis needs to be flipped for correct mapping
    const centerU = (op.worldX + terrainSize/2) / terrainSize;
    const centerV = 1.0 - (op.worldZ + terrainSize/2) / terrainSize; // Flip V coordinate
    const centerX = Math.floor(centerU * gridSize);
    const centerY = Math.floor(centerV * gridSize);

    // Calculate radius in pixels
    const radiusPixels = (op.radius / terrainSize) * gridSize;

    // Apply brush effect
    const strengthScale = op.dt * 0.000002; // Scale strength for more controlled terrain changes

    for (let dy = -Math.ceil(radiusPixels); dy <= Math.ceil(radiusPixels); dy++) {
      for (let dx = -Math.ceil(radiusPixels); dx <= Math.ceil(radiusPixels); dx++) {
        const x = centerX + dx;
        const y = centerY + dy;

        if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= radiusPixels) {
            // Falloff from center
            const falloff = 1.0 - (distance / radiusPixels);
            const effect = falloff * falloff; // Quadratic falloff

            const index = (y * gridSize + x) * 4; // RGBA format

            if (op.mode === 'pickup') {
              // Lower terrain
              data[index] -= op.strength * strengthScale * effect;
              data[index] = Math.max(0, data[index]); // Ocean floor at 0.0 normalized - NEVER go below
            } else {
              // Raise terrain
              data[index] += op.strength * strengthScale * effect;
              data[index] = Math.min(1, data[index]); // Prevent going too high
            }
          }
        }
      }
    }

    heightTexture.needsUpdate = true;
  }

  dispose(): void {
    console.log('[Engine] Disposing engine...');
    this.disposed = true;
    this.renderingActive = false;

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    if (this.renderer) {
      console.log('[Engine] Disposing renderer...');
      this.renderer.dispose();
      this.renderer = undefined;
    }

    if (this.brushSystem) {
      console.log('[Engine] Destroying brush system...');
      this.brushSystem.destroy();
      this.brushSystem = undefined;
    }

    if (this.gpuDevice) {
      console.log('[Engine] Destroying GPU device...');
      this.gpuDevice.destroy();
      this.gpuDevice = undefined;
    }

    this.sampleListeners.clear();
    this.brushQueue.length = 0;
    console.log('[Engine] Engine disposed successfully');
  }

  private startLoop() {
    if (this.rafHandle !== null) {
      return;
    }

    let lastTime = performance.now();

    const tick = () => {
      if (!this.renderingActive || this.disposed) {
        this.rafHandle = null;
        return;
      }

      const now = performance.now();
      const deltaMs = (now - lastTime);
      lastTime = now;
      this.lastFrameTime = deltaMs;

      this.frameId += 1;

      // Always drain brush queue (brush operations should work even when paused)
      this.drainBrushQueue();

      // Run simulation updates only if not paused
      if (!this.simulationPaused) {
        const simDeltaMs = deltaMs * this.timeScale;
        const simDeltaS = simDeltaMs / 1000.0; // Convert to seconds
        const simTimeS = now / 1000.0; // Total time in seconds

        // Update fluid simulation
        if (this.renderer && (this.renderer as any).updateSimulation) {
          (this.renderer as any).updateSimulation(simDeltaS, simTimeS);
        }
      }

      // Always render the scene (even when simulation is paused)
      if (this.renderer) {
        this.renderer.render();
      }

      this.emitPerfSample(deltaMs);

      this.rafHandle = requestAnimationFrame(tick);
    };

    this.rafHandle = requestAnimationFrame(tick);
  }

  private drainBrushQueue() {
    if (!this.brushQueue.length || !this.brushSystem || !this.gpuDevice) {
      // Only log if there are operations waiting but missing dependencies
      if (this.brushQueue.length > 0) {
        console.log('Cannot process brush queue - missing brushSystem or gpuDevice');
      }
      return;
    }

    console.log('Processing', this.brushQueue.length, 'brush operations');
    const dt = this.lastFrameTime * 0.001 * this.timeScale; // Convert to seconds and apply time scale

    // Process all queued brush operations
    for (const op of this.brushQueue) {
      console.log('Brush op:', op);

      // Calculate height at brush position for logging
      let heightMeters: number | undefined;
      if (this.renderer) {
        heightMeters = this.renderer.getHeightAtWorldPos(op.worldX, op.worldZ);
      }

      this.brushSystem.addBrushOp(
        op.mode,
        op.material,
        op.worldX,
        op.worldZ,
        op.radius,
        op.strength,
        op.dt || dt || 0.016, // Use provided dt first, then calculated dt, then default to 60fps
        heightMeters
      );
    }

    // Execute brush operations on GPU
    const commandEncoder = this.gpuDevice.createCommandEncoder();
    this.brushSystem.execute(commandEncoder);
    this.gpuDevice.queue.submit([commandEncoder.finish()]);

    // Update renderer with new field textures AND modify height
    if (this.renderer) {
      const fields = this.brushSystem.getFields();
      // Pass updated fields to renderer for visualization
      (this.renderer as any).updateFieldTextures?.(fields);

      // TEMPORARY: Directly modify height texture based on brush operations
      // This simulates the terrain changes until we implement proper GPU readback
      for (const op of this.brushQueue) {
        this.applyBrushToTerrain(op);
      }
    }

    // Update hand state in UI after GPU operations
    // Note: We need to read back from GPU to get actual mass changes
    const handState = this.brushSystem.getHandState();
    const uiStore = (window as any).__uiStore;
    if (uiStore) {
      // For now, simulate mass changes based on operations
      // TODO: Read back actual mass from GPU
      const handCapacity = this.brushSystem.getHandState().capKg;
      for (const op of this.brushQueue) {
        if (op.mode === 'pickup') {
          // Simulate picking up material - full strength, no reduction
          const massChange = op.strength * op.dt;
          handState.massKg = Math.min(handState.massKg + massChange, handCapacity);
        } else if (op.mode === 'deposit' && handState.massKg > 0) {
          // Simulate depositing material - full strength
          const massChange = op.strength * op.dt;
          handState.massKg = Math.max(handState.massKg - massChange, 0);
        }
      }

      // Update the brush system's internal state
      this.brushSystem.updateHandMass(handState.massKg - this.brushSystem.getHandState().massKg);

      // Update UI
      uiStore.getState().brush.updateHandMass(handState.massKg);
      console.log('Updated hand mass:', handState.massKg, 'kg');
    }

    this.brushQueue.length = 0;
  }

  private emitPerfSample(cpuFrameMs: number) {
    if (this.sampleListeners.size === 0) {
      return;
    }

    // Collect actual stats from WebGPU renderer
    let drawCalls = 0;
    let computeDispatches = 0;
    let estimatedVrAmMb = 0;

    if (this.renderer) {
      const info = this.renderer.getRendererInfo();

      // WebGPU renderer stats
      drawCalls = info.render?.calls || 0;

      // Compute dispatches (WebGPU compute passes)
      computeDispatches = info.compute?.calls || 0;

      // Calculate VRAM usage from various sources
      const geometryMemory = info.memory?.geometries || 0;
      const textureMemory = info.memory?.textures || 0;
      // Note: WebGPU info.memory doesn't have buffers property in this version
      const bufferMemory = 0;

      // Convert bytes to MB and round
      estimatedVrAmMb = Math.round((geometryMemory + textureMemory + bufferMemory) / (1024 * 1024));

      // If still 0, estimate based on known texture allocations
      if (estimatedVrAmMb === 0) {
        // Each 256x256 RGBA float32 texture is ~1MB
        const textureCount = 10; // height, flow, accumulation, erosion, sediment, pools, lava depth, temp, water material, lava material
        const textureSize = 256 * 256 * 4 * 4; // RGBA float32
        estimatedVrAmMb = Math.round((textureCount * textureSize) / (1024 * 1024));
      }
    }

    // Try to get GPU timing from renderer
    const gpuFrameMs = this.renderer ? this.renderer.getGPUTiming() : null;

    // Since we're in stub mode, provide estimated pass timings based on total GPU time
    // In a real implementation, these would come from GPU timestamp queries
    const passTimings = gpuFrameMs !== null ? {
      heightBrush: gpuFrameMs * 0.05,  // ~5% for height/brush ops
      fluids: gpuFrameMs * 0.20,       // ~20% for fluid simulation
      erosion: gpuFrameMs * 0.15,      // ~15% for erosion
      thermal: gpuFrameMs * 0.10,      // ~10% for thermal erosion
      lava: gpuFrameMs * 0.10,         // ~10% for lava simulation
      render: gpuFrameMs * 0.40,       // ~40% for rendering
    } : {
      heightBrush: null,
      fluids: null,
      erosion: null,
      thermal: null,
      lava: null,
      render: null,
    };

    const sample: PerfSample = {
      frameId: this.frameId,
      cpuFrameMs,
      gpuFrameMs,
      passes: [
        { name: 'height/brush', gpuMs: passTimings.heightBrush },
        { name: 'fluids', gpuMs: passTimings.fluids },
        { name: 'erosion', gpuMs: passTimings.erosion },
        { name: 'thermal', gpuMs: passTimings.thermal },
        { name: 'lava', gpuMs: passTimings.lava },
        { name: 'render', gpuMs: passTimings.render },
      ],
      computeDispatches,
      drawCalls,
      estimatedVrAmMb,
    };

    this.sampleListeners.forEach((cb) => cb(sample));
  }
}
