import { UiSection } from '@playground/components/primitives/UiSection';

interface TimeScaleSectionProps {
  timeScale: number;
  setTimeScale: (value: number) => void;
}

export function TimeScaleSection({ timeScale, setTimeScale }: TimeScaleSectionProps) {
  return (
    <UiSection title="Time Scale">
      <div className="space-y-1.5">
        <input
          type="range"
          min="0.1"
          max="8"
          step="0.1"
          value={timeScale}
          onChange={(event) => setTimeScale(Number(event.target.value))}
          className="tf-range"
        />
        <div className="text-xs font-medium text-muted-foreground">
          {timeScale.toFixed(1)}x
        </div>
      </div>
    </UiSection>
  );
}
