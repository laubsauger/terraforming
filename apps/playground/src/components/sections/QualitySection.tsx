import type { QualityOpts } from '@terraforming/types';
import { UiSection } from '@playground/components/primitives/UiSection';
import { Input } from '@playground/components/ui/input';

interface QualitySectionProps {
  quality: QualityOpts;
  updateQuality: (opts: Partial<QualityOpts>) => void;
}

export function QualitySection({ quality, updateQuality }: QualitySectionProps) {
  return (
    <UiSection title="Quality">
      <div className="space-y-3">
        <label className="flex flex-col gap-2 text-xs font-medium text-muted-foreground">
          <span>Sim Resolution</span>
          <Input
            type="number"
            min={128}
            max={2048}
            step={64}
            value={quality.simResolution ?? 512}
            onChange={(event) => updateQuality({ simResolution: Number(event.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs font-medium text-muted-foreground">
          <span>Sim Substeps</span>
          <Input
            type="number"
            min={1}
            max={8}
            value={quality.simSubsteps ?? 1}
            onChange={(event) => updateQuality({ simSubsteps: Number(event.target.value) })}
          />
        </label>
      </div>
    </UiSection>
  );
}
