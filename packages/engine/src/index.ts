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
        handCapacityKg: 10000,
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
        // Update renderer debug mode
        if (this.renderer) {
          // Handle contours specially since it's a material setting
          if (kind === 'contours') {
            this.renderer.setShowContours(true);
            this.renderer.setDebugMode(0); // Clear other debug modes
          } else {
            // Always turn off contours when switching to any other mode
            this.renderer.setShowContours(false);
          }

          // Handle other debug modes
          if (kind !== 'contours') {
            const debugModeMap: Record<Exclude<DebugOverlay, 'contours'> | 'none', number> = {
              'none': 0,
              'height': 8,
              'flow': 1,
              'accumulation': 2,
              'erosion': 3,
              'pools': 5,
              'sediment': 7,
              'lava': 4,
              'temperature': 6,
            };
            this.renderer.setDebugMode(debugModeMap[kind as keyof typeof debugModeMap] || 0);
          }
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

  dispose(): void {
    this.disposed = true;
    this.renderingActive = false;

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = undefined;
    }

    if (this.brushSystem) {
      this.brushSystem.destroy();
      this.brushSystem = undefined;
    }

    if (this.gpuDevice) {
      this.gpuDevice.destroy();
      this.gpuDevice = undefined;
    }

    this.sampleListeners.clear();
    this.brushQueue.length = 0;
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
        // Future: Update simulation here
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
      this.brushSystem.addBrushOp(
        op.mode,
        op.material,
        op.worldX,
        op.worldZ,
        op.radius,
        op.strength,
        op.dt || dt || 0.016 // Use provided dt first, then calculated dt, then default to 60fps
      );
    }

    // Execute brush operations on GPU
    const commandEncoder = this.gpuDevice.createCommandEncoder();
    this.brushSystem.execute(commandEncoder);
    this.gpuDevice.queue.submit([commandEncoder.finish()]);

    // Update renderer with new field textures
    if (this.renderer) {
      const fields = this.brushSystem.getFields();
      // Pass updated fields to renderer for visualization
      (this.renderer as any).updateFieldTextures?.(fields);
    }

    // Update hand state in UI after GPU operations
    // Note: We need to read back from GPU to get actual mass changes
    const handState = this.brushSystem.getHandState();
    const uiStore = (window as any).__uiStore;
    if (uiStore) {
      // For now, simulate mass changes based on operations
      // TODO: Read back actual mass from GPU
      for (const op of this.brushQueue) {
        if (op.mode === 'pickup') {
          // Simulate picking up material
          const massChange = op.strength * op.dt * 0.1; // Simplified calculation
          handState.massKg = Math.min(handState.massKg + massChange, 10000);
        } else if (op.mode === 'deposit' && handState.massKg > 0) {
          // Simulate depositing material
          const massChange = op.strength * op.dt * 0.1;
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
