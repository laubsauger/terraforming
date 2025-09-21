import type { PerfSample } from '@terraforming/types';
import { UiSection } from '@playground/components/primitives/UiSection';
import { Button } from '@playground/components/ui/button';

interface PerfHudSectionProps {
  sample: PerfSample | null;
  onSnapshot: () => void;
}

export function PerfHudSection({ sample, onSnapshot }: PerfHudSectionProps) {
  return (
    <UiSection title="Perf HUD">
      <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/30 px-3 py-3 text-xs text-muted-foreground">
        {sample ? (
          <>
            <div className="flex flex-col gap-1 text-foreground">
              <span className="text-sm font-semibold">Frame #{sample.frameId.toString().padStart(6)}</span>
              <span className="font-mono text-xs">
                CPU {sample.cpuFrameMs.toFixed(2).padStart(6)} ms · GPU{' '}
                {sample.gpuFrameMs === null ? '   N/A' : `${sample.gpuFrameMs.toFixed(2).padStart(6)} ms`}
              </span>
            </div>
            <ul className="flex flex-col gap-1 text-foreground/80">
              {sample.passes.map((pass) => (
                <li key={pass.name} className="flex justify-between font-mono text-xs">
                  <span className="font-sans">{pass.name}</span>
                  <span>
                    {pass.gpuMs === null ? '   N/A' : `${pass.gpuMs.toFixed(2).padStart(6)} ms`}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1 text-foreground/80 font-mono text-xs">
              <span>Dispatches {String(sample.computeDispatches).padStart(4)}</span>
              <span>Draws      {String(sample.drawCalls).padStart(4)}</span>
              <span>VRAM       {String(sample.estimatedVrAmMb).padStart(4)} MB</span>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border/40 bg-secondary/20 px-3 py-3 text-muted-foreground">
            Waiting for samples…
          </div>
        )}
        <Button
          type="button"
          onClick={onSnapshot}
          variant="secondary"
          className="w-full text-xs font-semibold"
          disabled={!sample}
        >
          Snapshot Frame
        </Button>
      </div>
    </UiSection>
  );
}
