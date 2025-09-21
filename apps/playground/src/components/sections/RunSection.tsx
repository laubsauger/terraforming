import { UiSection } from '@playground/components/primitives/UiSection';
import { Button } from '@playground/components/ui/button';
import { Play, Pause } from 'lucide-react';

interface RunSectionProps {
  paused: boolean;
  togglePaused: () => void;
}

export function RunSection({ paused, togglePaused }: RunSectionProps) {
  return (
    <UiSection title="Simulation">
      <Button
        type="button"
        variant="secondary"
        size="default"
        onClick={togglePaused}
        className="gap-2"
      >
        {!paused ? (
          <>
            <Pause className="h-4 w-4" />
            Pause
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Play
          </>
        )}
      </Button>
    </UiSection>
  );
}
