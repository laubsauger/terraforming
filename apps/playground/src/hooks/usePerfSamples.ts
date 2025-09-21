import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '@terraforming/engine';
import type { PerfSample, Unsub } from '@terraforming/types';

export interface PerfSeriesOptions {
  maxSamples?: number;
  updateInterval?: number; // Throttle updates to this many milliseconds
}

export function usePerfSamples(
  engine: Engine | null,
  options: PerfSeriesOptions = {}
) {
  const { maxSamples = 120, updateInterval = 250 } = options; // Update 4 times per second by default
  const [samples, setSamples] = useState<PerfSample[]>([]);
  const lastUpdateRef = useRef<number>(0);
  const pendingSampleRef = useRef<PerfSample | null>(null);

  useEffect(() => {
    if (!engine) return;

    let unsub: Unsub | null = null;
    let rafId: number | null = null;

    const updateSamples = () => {
      if (pendingSampleRef.current) {
        setSamples((prev) => {
          const next = [...prev, pendingSampleRef.current!];
          if (next.length > maxSamples) {
            next.splice(0, next.length - maxSamples);
          }
          return next;
        });
        pendingSampleRef.current = null;
      }
    };

    unsub = engine.perf.onSample((sample) => {
      const now = Date.now();
      pendingSampleRef.current = sample;

      // Throttle updates to reduce re-renders
      if (now - lastUpdateRef.current >= updateInterval) {
        lastUpdateRef.current = now;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateSamples);
      }
    });

    return () => {
      if (unsub) unsub();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [engine, maxSamples, updateInterval]);

  const latest = useMemo(() => samples.at(-1) ?? null, [samples]);

  return { samples, latest };
}
