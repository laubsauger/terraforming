import { Slider } from '@playground/components/ui/slider';
import { Label } from '@playground/components/ui/label';
import { Button } from '@playground/components/ui/button';
import { Minus, Plus } from 'lucide-react';

interface BrushSettingsProps {
  brushSize: number;
  brushStrength: number;
  onSizeChange: (size: number) => void;
  onStrengthChange: (strength: number) => void;
  className?: string;
}

const BRUSH_SIZE_MIN = 1;
const BRUSH_SIZE_MAX = 15; // Reduced from 50 to fit world size
const BRUSH_STRENGTH_MIN = 0.1;
const BRUSH_STRENGTH_MAX = 1.0;

export function BrushSettings({
  brushSize,
  brushStrength,
  onSizeChange,
  onStrengthChange,
  className = '',
}: BrushSettingsProps) {
  const handleSizeIncrement = (delta: number) => {
    const newSize = Math.max(BRUSH_SIZE_MIN, Math.min(BRUSH_SIZE_MAX, brushSize + delta));
    onSizeChange(newSize);
  };

  return (
    <div className={`space-y-4 rounded-lg bg-background/95 backdrop-blur border p-3 ${className}`}>
      <div>
        <div className="flex h-6 mb-2 text-muted-foreground items-center justify-between">
          <Label htmlFor="brush-size" className="text-xs">
            Size: {Math.round(brushSize)}
          </Label>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => handleSizeIncrement(-5)}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => handleSizeIncrement(5)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <Slider
          id="brush-size"
          min={BRUSH_SIZE_MIN}
          max={BRUSH_SIZE_MAX}
          step={1}
          value={[brushSize]}
          onValueChange={([value]) => onSizeChange(value)}
          className="w-32"
        />
      </div>

      <div>
        <Label htmlFor="brush-strength" className="h-6 items-center flex mb-2 text-xs text-muted-foreground">
          Strength: {Math.round(brushStrength * 100)}%
        </Label>
        <Slider
          id="brush-strength"
          min={BRUSH_STRENGTH_MIN * 100}
          max={BRUSH_STRENGTH_MAX * 100}
          step={10}
          value={[brushStrength * 100]}
          onValueChange={([value]) => onStrengthChange(value / 100)}
          className="w-32"
        />
      </div>

      <div className="text-xs text-muted-foreground">
        <div>Scroll: Adjust size</div>
        <div>Shift+Scroll: Fine tune</div>
      </div>
    </div>
  );
}