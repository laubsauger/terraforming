import type {
  BrushOp,
  DebugOverlay,
  EngineOpts,
  PerfSample,
  QualityOpts,
  Source,
  Unsub,
} from '@terraforming/types';

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

  private paused = false;
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

  constructor(canvas: HTMLCanvasElement, opts: EngineOpts) {
    this.canvas = canvas;
    this.opts = opts;
  }

  initialize(): void {
    this.canvas.width = this.canvas.clientWidth || 1280;
    this.canvas.height = this.canvas.clientHeight || 720;
    // Don't start the loop - wait for explicit setRunState call
    // this.startLoop();
  }

  setRunState(running: boolean): void {
    this.paused = !running;
    if (running) {
      this.startLoop();
    }
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

  dispose(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.sampleListeners.clear();
  }

  private startLoop() {
    if (this.rafHandle !== null) {
      return;
    }

    let lastTime = performance.now();

    const tick = () => {
      if (this.paused) {
        this.rafHandle = null;
        return;
      }

      const now = performance.now();
      const deltaMs = (now - lastTime) * this.timeScale;
      lastTime = now;

      this.frameId += 1;
      this.drainBrushQueue();
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

    const sample: PerfSample = {
      frameId: this.frameId,
      cpuFrameMs,
      gpuFrameMs: null,
      passes: [
        { name: 'height/brush', gpuMs: null },
        { name: 'fluids', gpuMs: null },
        { name: 'erosion', gpuMs: null },
        { name: 'thermal', gpuMs: null },
        { name: 'lava', gpuMs: null },
        { name: 'render', gpuMs: null },
      ],
      computeDispatches: 0,
      drawCalls: 0,
      estimatedVrAmMb: 0,
    };

    this.sampleListeners.forEach((cb) => cb(sample));
  }
}
