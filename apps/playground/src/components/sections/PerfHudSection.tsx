import type { PerfSample } from '@terraforming/types';
import { UiSection } from '@playground/components/primitives/UiSection';

interface PerfHudSectionProps {
  sample: PerfSample | null;
}

export function PerfHudSection({ sample }: PerfHudSectionProps) {
  return (
    <UiSection title="Perf HUD">
      {sample ? (
        <div className="tf-card">
          <div className="tf-metric-heading">
            <span className="tf-metric-title">Frame #{sample.frameId}</span>
            <span>
              CPU {sample.cpuFrameMs.toFixed(2)} ms · GPU{' '}
              {sample.gpuFrameMs === null ? 'N/A' : `${sample.gpuFrameMs.toFixed(2)} ms`}
            </span>
          </div>
          <ul className="tf-metric-list">
            {sample.passes.map((pass) => (
              <li key={pass.name} className="flex justify-between">
                <span>{pass.name}</span>
                <span>
                  {pass.gpuMs === null ? 'N/A' : `${pass.gpuMs.toFixed(2)} ms`}
                </span>
              </li>
            ))}
          </ul>
          <div className="tf-metric-list">
            <span>Dispatches {sample.computeDispatches}</span>
            <span>Draws {sample.drawCalls}</span>
            <span>VRAM {sample.estimatedVrAmMb} MB</span>
          </div>
        </div>
      ) : (
        <div className="tf-card-muted">Waiting for samples…</div>
      )}
    </UiSection>
  );
}
