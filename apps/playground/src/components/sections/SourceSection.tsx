import { Label } from '@playground/components/ui/label';
import { Slider } from '@playground/components/ui/slider';
import type { InteractionTool } from '@playground/components/InteractionToolbar';
import { FluidConfig } from '@terraforming/engine';

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

  // Use configuration constants
  const minRate = FluidConfig.MIN_FLOW_RATE;
  const maxRate = FluidConfig.MAX_FLOW_RATE;
  const defaultRate = isWaterTool ? FluidConfig.DEFAULT_WATER_FLOW_RATE : FluidConfig.DEFAULT_LAVA_FLOW_RATE;

  // Format flow rate display
  const formatFlowRate = (rate: number) => {
    if (rate >= 1000) return `${(rate / 1000).toFixed(1)}k L/s`;
    if (rate >= 100) return `${rate.toFixed(0)} L/s`;
    if (rate >= 10) return `${rate.toFixed(1)} L/s`;
    return `${rate.toFixed(2)} L/s`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{sourceType} Source Tool</h3>
        <span className="text-xs text-gray-400">
          Click to place
        </span>
      </div>

      {/* Flow Rate Slider with Logarithmic Scaling */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <Label className="text-gray-400">Flow Rate</Label>
          <span className="text-white font-mono">
            {formatFlowRate(flowRate)}
          </span>
        </div>
        <Slider
          value={[Math.log10(Math.max(minRate, flowRate))]}
          onValueChange={(values) => {
            const newRate = Math.pow(10, values[0]);
            setFlowRate(Math.min(maxRate, Math.max(minRate, newRate)));
          }}
          min={Math.log10(minRate)}    // Log scale min
          max={Math.log10(maxRate)}    // Log scale max
          step={0.05}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>{formatFlowRate(minRate)}</span>
          <span>{formatFlowRate(defaultRate)}</span>
          <span>{formatFlowRate(maxRate)}</span>
        </div>
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
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">Temperature:</span>
            <span className="text-white">
              {isWaterTool ? `${FluidConfig.AMBIENT_TEMP}°C` : `${FluidConfig.LAVA_INITIAL_TEMP}°C`}
            </span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">Density:</span>
            <span className="text-white">
              {isWaterTool ? `${FluidConfig.WATER_DENSITY}` : `${FluidConfig.LAVA_DENSITY}`} kg/m³
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Effect Radius:</span>
            <span className="text-white">
              {FluidConfig.SOURCE_RADIUS.toFixed(0)} cells
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