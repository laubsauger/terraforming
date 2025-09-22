import { Button } from '@playground/components/ui/button';
import { Label } from '@playground/components/ui/label';
import { Slider } from '@playground/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@playground/components/ui/toggle-group';
import type { MaterialKind, BrushMode } from '@playground/store/uiStore';
import { cn } from '@playground/lib/utils';

interface BrushSectionProps {
  mode: BrushMode;
  material: MaterialKind;
  radius: number;
  strength: number;
  isActive: boolean;
  handMass: number;
  handCapacity: number;
  setMode: (mode: BrushMode) => void;
  setMaterial: (material: MaterialKind) => void;
  setRadius: (radius: number) => void;
  setStrength: (strength: number) => void;
}

const MATERIALS: { value: MaterialKind; label: string; color: string }[] = [
  { value: 'soil', label: 'Soil', color: 'bg-amber-600' },
  { value: 'rock', label: 'Rock', color: 'bg-gray-600' },
  { value: 'lava', label: 'Lava', color: 'bg-red-600' },
];

export function BrushSection({
  mode,
  material,
  radius,
  strength,
  isActive,
  handMass,
  handCapacity,
  setMode,
  setMaterial,
  setRadius,
  setStrength,
}: BrushSectionProps) {
  const massPercent = (handMass / handCapacity) * 100;

  // Detect OS for correct modifier key
  const isMac = typeof navigator !== 'undefined' &&
    (navigator.userAgent.toLowerCase().includes('mac') ||
     navigator.platform?.toLowerCase().includes('mac'));
  const modifierKey = isMac ? 'Option' : 'Alt';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Brush Tool</h3>
        <span className="text-xs text-gray-400">
          Hold <kbd className="px-1 py-0.5 text-xs bg-white/10 rounded">{modifierKey}</kbd> + Click
        </span>
      </div>

      {/* Mode Toggle */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Mode</Label>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => value && setMode(value as BrushMode)}
          className="w-full"
        >
          <ToggleGroupItem value="pickup" className="flex-1">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M3 12l9-9 9 9M12 3v18" strokeWidth={2} />
              </svg>
              Pick Up
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem value="deposit" className="flex-1">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21 12l-9 9-9-9M12 21V3" strokeWidth={2} />
              </svg>
              Deposit
            </span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Material Selection */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Material</Label>
        <div className="grid grid-cols-3 gap-2">
          {MATERIALS.map((mat) => (
            <Button
              key={mat.value}
              variant={material === mat.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMaterial(mat.value)}
              className={cn(
                'relative overflow-hidden',
                material === mat.value && mat.color
              )}
            >
              <span className="relative z-10 text-xs">{mat.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Radius Slider */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <Label className="text-gray-400">Radius</Label>
          <span className="text-white">{radius.toFixed(1)}m</span>
        </div>
        <Slider
          value={[radius]}
          onValueChange={(values) => setRadius(values[0])}
          min={1}
          max={30}
          step={0.5}
          className="w-full"
        />
      </div>

      {/* Strength Slider with Exponential Scaling */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <Label className="text-gray-400">Strength</Label>
          <span className="text-white">{strength >= 1000000 ? `${(strength/1000000).toFixed(1)}M` : strength >= 1000 ? `${Math.round(strength/1000)}k` : Math.round(strength)} kg/s</span>
        </div>
        <Slider
          value={[Math.log10(strength)]}
          onValueChange={(values) => setStrength(Math.pow(10, values[0]))}
          min={2}  // 10^2 = 100
          max={6}  // 10^6 = 1,000,000
          step={0.05}
          className="w-full"
        />
      </div>

      {/* Hand Mass Indicator */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Carrying</span>
          <span className="text-white">{(handMass/1000).toFixed(1)} / {(handCapacity/1000).toFixed(0)} tons</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300',
              material === 'soil' && 'bg-amber-600',
              material === 'rock' && 'bg-gray-600',
              material === 'lava' && 'bg-red-600'
            )}
            style={{ width: `${massPercent}%` }}
          />
        </div>
      </div>


      {/* Status Indicators */}
      {isActive && (
        <div className="px-2 py-1 bg-green-500/20 border border-green-500/40 rounded text-xs text-green-400 text-center">
          Brush Active
        </div>
      )}

      {/* Full Capacity Warning */}
      {massPercent >= 95 && mode === 'pickup' && (
        <div className="px-2 py-1 bg-red-500/20 border border-red-500/40 rounded text-xs text-red-400 text-center animate-pulse">
          ⚠️ Hand Nearly Full!
        </div>
      )}

      {/* Empty Warning */}
      {massPercent <= 5 && mode === 'deposit' && (
        <div className="px-2 py-1 bg-yellow-500/20 border border-yellow-500/40 rounded text-xs text-yellow-400 text-center">
          Hand Nearly Empty
        </div>
      )}
    </div>
  );
}