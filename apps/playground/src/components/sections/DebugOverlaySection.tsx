import type { OverlayOption } from '@playground/store/uiStore';
import { UiSection } from '@playground/components/primitives/UiSection';
import { Button } from '@playground/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@playground/components/ui/popover';
import { cn } from '@playground/lib/utils';
import { CheckIcon } from '@radix-ui/react-icons';

interface DebugOverlaySectionProps {
  selected: OverlayOption[];
  setSelected: (values: OverlayOption[]) => void;
  options: OverlayOption[];
}

export function DebugOverlaySection({ selected, setSelected, options }: DebugOverlaySectionProps) {
  const toggleOption = (value: OverlayOption) => {
    if (value === 'none') {
      setSelected(['none']);
      return;
    }
    const withNoneRemoved = selected.filter((item) => item !== 'none');
    const next = withNoneRemoved.includes(value)
      ? withNoneRemoved.filter((item) => item !== value)
      : [...withNoneRemoved, value];
    setSelected(next.length === 0 ? ['none'] : next);
  };

  const label = selected.length
    ? selected.join(', ')
    : 'Pick buffers';

  return (
    <UiSection title="Debug Overlays">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="justify-between">
            <span className="truncate text-left text-sm capitalize">{label}</span>
            <span className="text-xs text-muted-foreground">multi</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="space-y-1">
          <button
            type="button"
            onClick={() => toggleOption('none')}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm capitalize transition',
              selected.includes('none')
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted/40'
            )}
          >
            <span>none</span>
            {selected.includes('none') && <CheckIcon className="size-4" />}
          </button>
          <div className="h-px w-full bg-border/40" />
          {options
            .filter((option) => option !== 'none')
            .map((option) => {
              const active = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleOption(option)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm capitalize transition',
                    active
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:bg-muted/40'
                  )}
                >
                  <span>{option}</span>
                  {active && <CheckIcon className="size-4" />}
                </button>
              );
            })}
        </PopoverContent>
      </Popover>
    </UiSection>
  );
}
