import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '@terraforming/engine';
import type { PerfSample, Unsub } from '@terraforming/types';

export interface PerfSeriesOptions {
  maxSamples?: number;
}

export function usePerfSamples(
  engine: Engine | null,
  options: PerfSeriesOptions = {}
) {
  const { maxSamples = 120 } = options;
  const [samples, setSamples] = useState<PerfSample[]>([]);

  useEffect(() => {
    if (!engine) return;

    let unsub: Unsub | null = null;

    unsub = engine.perf.onSample((sample) => {
      setSamples((prev) => {
        const next = [...prev, sample];
        if (next.length > maxSamples) {
          next.splice(0, next.length - maxSamples);
        }
        return next;
      });
    });

    return () => {
      if (unsub) unsub();
    };
  }, [engine, maxSamples]);

  const latest = useMemo(() => samples.at(-1) ?? null, [samples]);

  return { samples, latest };
}
