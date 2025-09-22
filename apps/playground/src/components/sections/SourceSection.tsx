import { Label } from '@playground/components/ui/label';
import { Slider } from '@playground/components/ui/slider';
import type { InteractionTool } from '@playground/components/toolbar/types';

interface SourceSectionProps {
  activeTool: InteractionTool;
  flowRate: number;
  setFlowRate: (rate: number) => void;
}

export function SourceSection({
  activeTool,
  flowRate,
  setFlowRate,
}: SourceSectionProps) {
  const isWaterTool = activeTool === 'add-water-source';
  const isLavaTool = activeTool === 'add-lava-source';
  const sourceType = isWaterTool ? 'Water' : isLavaTool ? 'Lava' : 'Source';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{sourceType} Source Tool</h3>
        <span className="text-xs text-gray-400">
          Click to place
        </span>
      </div>

      {/* Flow Rate Slider with Exponential Scaling */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <Label className="text-gray-400">Flow Rate</Label>
          <span className="text-white">
            {flowRate >= 1000 ? `${(flowRate/1000).toFixed(1)}k` : flowRate.toFixed(0)} L/s
          </span>
        </div>
        <Slider
          value={[Math.log10(Math.max(1, flowRate))]}
          onValueChange={(values) => setFlowRate(Math.pow(10, values[0]))}
          min={0}    // 10^0 = 1 L/s
          max={3}    // 10^3 = 1000 L/s
          step={0.05}
          className="w-full"
        />
      </div>

      {/* Source Type Info */}
      <div className="space-y-2 text-xs">
        <div className="px-2 py-1.5 bg-white/5 border border-white/10 rounded">
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">Type:</span>
            <span className={isWaterTool ? "text-blue-400" : "text-orange-400"}>
              {sourceType}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Temperature:</span>
            <span className="text-white">
              {isWaterTool ? "20°C" : "1200°C"}
            </span>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="px-2 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
        💡 Click on terrain to place a {sourceType.toLowerCase()} emitter that will continuously flow at the set rate
      </div>
    </div>
  );
}