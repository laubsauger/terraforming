import { UiSection } from '@playground/components/primitives/UiSection';
import { Slider } from '@playground/components/ui/slider';

interface TimeScaleSectionProps {
  timeScale: number;
  setTimeScale: (value: number) => void;
}

export function TimeScaleSection({ timeScale, setTimeScale }: TimeScaleSectionProps) {
  return (
    <UiSection title="Time Scale">
      <div className="space-y-1.5">
        <Slider
          min={0.1}
          max={8}
          step={0.1}
          value={[timeScale]}
          onValueChange={(value) => setTimeScale(value[0] ?? timeScale)}
        />
        <div className="text-xs font-medium text-muted-foreground">
          {timeScale.toFixed(1)}x
        </div>
      </div>
    </UiSection>
  );
}
