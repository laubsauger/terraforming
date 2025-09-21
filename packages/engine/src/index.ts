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
      // WebGPU renderer stats (if available)
      drawCalls = info.render?.calls || 0;
      // Estimate VRAM usage (rough approximation)
      estimatedVrAmMb = Math.round((info.memory?.geometries || 0) * 0.001);
    }

    // Try to get GPU timing
    const gpuFrameMs = this.renderer ? this.renderer.getGPUTiming() : null;

    const sample: PerfSample = {
      frameId: this.frameId,
      cpuFrameMs,
      gpuFrameMs,
      passes: [
        { name: 'height/brush', gpuMs: null },
        { name: 'fluids', gpuMs: null },
        { name: 'erosion', gpuMs: null },
        { name: 'thermal', gpuMs: null },
        { name: 'lava', gpuMs: null },
        { name: 'render', gpuMs: null },
      ],
      computeDispatches,
      drawCalls,
      estimatedVrAmMb,
    };

    this.sampleListeners.forEach((cb) => cb(sample));
  }
}
