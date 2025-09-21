import { UiSection } from '@playground/components/primitives/UiSection';
import { cn } from '@playground/lib/utils';

interface RunSectionProps {
  paused: boolean;
  togglePaused: () => void;
}

export function RunSection({ paused, togglePaused }: RunSectionProps) {
  return (
    <UiSection title="Run State">
      <button
        type="button"
        onClick={togglePaused}
        className={cn('tf-button', paused ? 'tf-button--primary' : 'tf-button--secondary')}
      >
        {paused ? 'Resume Simulation' : 'Pause Simulation'}
      </button>
    </UiSection>
  );
}
