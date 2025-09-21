import { useEffect, useState } from 'react';
import { Slider } from '@playground/components/ui/slider';
import { Label } from '@playground/components/ui/label';
import { Button } from '@playground/components/ui/button';
import { Play, Pause, Sun, Moon, Sunrise } from 'lucide-react';
import type { Engine } from '@terraforming/engine';

interface DayNightControlsProps {
  engine: Engine | null;
  className?: string;
}

export function DayNightControls({ engine, className = '' }: DayNightControlsProps) {
  const [timeOfDay, setTimeOfDay] = useState(0.25); // Start at noon
  const [isPlaying, setIsPlaying] = useState(false);
  const [cycleSpeed, setCycleSpeed] = useState(0.0005); // Default speed

  // Update engine when time changes
  useEffect(() => {
    if (engine) {
      engine.dayNight.setTimeOfDay(timeOfDay);
    }
  }, [engine, timeOfDay]);

  // Update engine when play state changes
  useEffect(() => {
    if (engine) {
      engine.dayNight.setActive(isPlaying);
    }
  }, [engine, isPlaying]);

  // Update engine when cycle speed changes
  useEffect(() => {
    if (engine) {
      engine.dayNight.setCycleSpeed(cycleSpeed);
    }
  }, [engine, cycleSpeed]);

  // Update local time when playing
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setTimeOfDay(prev => {
        const next = prev + cycleSpeed;
        return next > 1 ? next - 1 : next;
      });
    }, 16); // ~60fps update

    return () => clearInterval(interval);
  }, [isPlaying, cycleSpeed]);

  const getTimeLabel = (time: number): string => {
    const hours = time * 24;
    const hour = Math.floor(hours);
    const minute = Math.floor((hours - hour) * 60);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  const getTimeIcon = (time: number) => {
    if (time < 0.2 || time > 0.8) return <Moon className="h-4 w-4" />; // Night
    if (time < 0.3 || time > 0.7) return <Sunrise className="h-4 w-4" />; // Dawn/Dusk
    return <Sun className="h-4 w-4" />; // Day
  };

  return (
    <div className={`space-y-4 rounded-lg bg-background/95 backdrop-blur border p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getTimeIcon(timeOfDay)}
          <Label className="text-sm font-medium">
            Day/Night Cycle
          </Label>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsPlaying(!isPlaying)}
          className="h-8 w-8"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Time: {getTimeLabel(timeOfDay)}</span>
          <span>{Math.round(timeOfDay * 100)}%</span>
        </div>
        <Slider
          value={[timeOfDay * 100]}
          onValueChange={([value]) => setTimeOfDay(value / 100)}
          max={100}
          step={0.5}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>

      {isPlaying && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Cycle Speed: {cycleSpeed > 0.001 ? 'Fast' : cycleSpeed > 0.0005 ? 'Normal' : 'Slow'}
          </Label>
          <Slider
            value={[cycleSpeed * 10000]}
            onValueChange={([value]) => setCycleSpeed(value / 10000)}
            min={1}
            max={20}
            step={1}
            className="w-full"
          />
        </div>
      )}

      <div className="grid grid-cols-4 gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTimeOfDay(0.0)}
          className="text-xs"
        >
          Midnight
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTimeOfDay(0.125)}
          className="text-xs"
        >
          Dawn
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTimeOfDay(0.25)}
          className="text-xs"
        >
          Noon
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTimeOfDay(0.625)}
          className="text-xs"
        >
          Dusk
        </Button>
      </div>
    </div>
  );
}