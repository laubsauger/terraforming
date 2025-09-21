import { UiSection } from '@playground/components/primitives/UiSection';
import { Button } from '@playground/components/ui/button';

interface RunSectionProps {
  paused: boolean;
  togglePaused: () => void;
}

export function RunSection({ paused, togglePaused }: RunSectionProps) {
  return (
    <UiSection title="Run State">
      <Button
        type="button"
        variant={paused ? 'default' : 'secondary'}
        onClick={togglePaused}
      >
        {paused ? 'Resume Simulation' : 'Pause Simulation'}
      </Button>
    </UiSection>
  );
}
