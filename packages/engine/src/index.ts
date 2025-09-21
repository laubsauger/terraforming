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
  getScene(): THREE.Scene | null;
  getCamera(): THREE.Camera | null;
  getTerrainMesh(): THREE.Mesh | null;
  getTerrainHeightAt(worldX: number, worldZ: number): number | null;
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
  private simulationPaused = true;  // Simulation starts paused
  private renderingActive = true;   // Renderer runs by default
  private timeScale = 1;
  private quality: QualityOpts = { simResolution: 512, simSubsteps: 1 };
  private overlay: DebugOverlay | 'none' = 'none';
  private readonly brushQueue: BrushOp[] = [];
  private readonly sourceMap: Record<'water' | 'lava', Source[]> = {
    water: [],
    lava: [],
  };
  private rafHandle: number | null = null;
  private frameId = 0;
  private readonly sampleListeners = new Set<(sample: PerfSample) => void>();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts) {
    this.canvas = canvas;
    this.opts = opts;
  }

  async initialize(): Promise<void> {
    // Don't initialize if already disposed
    if (this.disposed) {
      return;
    }

    // Initialize the renderer (BaseRenderer will handle sizing)
    try {
      this.renderer = new TerrainRenderer({
        canvas: this.canvas,
        gridSize: 256,
        terrainSize: 100,
      });
      // Renderer initializes itself asynchronously
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
        this.overlay = kind;
        // Update renderer debug mode
        if (this.renderer) {
          const debugModeMap: Record<DebugOverlay | 'none', number> = {
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
          this.renderer.setDebugMode(debugModeMap[kind] || 0);
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

      this.frameId += 1;

      // Run simulation updates only if not paused
      if (!this.simulationPaused) {
        const simDeltaMs = deltaMs * this.timeScale;
        this.drainBrushQueue();
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
    if (!this.brushQueue.length) return;
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
      const bufferMemory = info.memory?.buffers || 0;

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
