/// <reference path="./wgsl.d.ts" />

export type Unsub = () => void;

export interface EngineOpts {
  adapterLabel?: string;
  deviceLabel?: string;
}

export interface QualityOpts {
  simResolution?: number;
  simSubsteps?: number;
  terrainClipmapLevels?: number;
}

export interface BrushOp {
  kind: 'raise' | 'lower' | 'smooth' | 'water' | 'lava';
  position: [number, number];
  radius: number;
  strength: number;
}

export interface Source {
  id: string;
  position: [number, number];
  rate: number;
}

export type DebugOverlay =
  | 'flow'
  | 'accumulation'
  | 'pools'
  | 'sediment'
  | 'lava'
  | 'temperature';

export interface PerfGpuPassTiming {
  name: string;
  gpuMs: number | null;
}

export interface PerfCounters {
  computeDispatches: number;
  drawCalls: number;
  estimatedVrAmMb: number;
}

export interface PerfSample extends PerfCounters {
  frameId: number;
  cpuFrameMs: number;
  gpuFrameMs: number | null;
  passes: PerfGpuPassTiming[];
}
