import type { QualityOpts } from '@terraforming/types';
import { UiSection } from '@playground/components/primitives/UiSection';

interface QualitySectionProps {
  quality: QualityOpts;
  updateQuality: (opts: Partial<QualityOpts>) => void;
}

export function QualitySection({ quality, updateQuality }: QualitySectionProps) {
  return (
    <UiSection title="Quality">
      <div className="space-y-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          <span>Sim Resolution</span>
          <input
            type="number"
            min={128}
            max={2048}
            step={64}
            value={quality.simResolution ?? 512}
            onChange={(event) => updateQuality({ simResolution: Number(event.target.value) })}
            className="tf-input"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          <span>Sim Substeps</span>
          <input
            type="number"
            min={1}
            max={8}
            value={quality.simSubsteps ?? 1}
            onChange={(event) => updateQuality({ simSubsteps: Number(event.target.value) })}
            className="tf-input"
          />
        </label>
      </div>
    </UiSection>
  );
}
