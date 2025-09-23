import { useEffect, useRef, useState } from 'react';
import type { Engine } from '@terraforming/engine';
import type { PerfSample } from '@terraforming/types';
import { shallow } from 'zustand/shallow';
import type { StoreApi } from 'zustand/vanilla';
import { usePerfSamples } from '@playground/hooks/usePerfSamples';
import {
  createUiStore,
  useUiStore,
  type OverlayOption,
  type UiStore,
} from '@playground/store/uiStore';
import { RunSection } from '@playground/components/sections/RunSection';
import { DebugOverlaySection } from '@playground/components/sections/DebugOverlaySection';
import { PerfHudSection } from '@playground/components/sections/PerfHudSection';
import { QualitySection } from '@playground/components/sections/QualitySection';
import { TimeScaleSection } from '@playground/components/sections/TimeScaleSection';
import { BrushSection } from '@playground/components/sections/BrushSection';
import { SourceSection } from '@playground/components/sections/SourceSection';
import type { InteractionTool } from '@playground/components/toolbar/types';
import { NoiseTextureGenerator } from '@playground/components/NoiseTextureGenerator';
import { cn } from '@playground/lib/utils';


function autoBindPointerEvents() {
  if (typeof document === 'undefined') return;
  document.body.style.margin = '0';
}

autoBindPointerEvents();

export interface TerraformingUIProps {
  engine: Engine | null;
  store?: StoreApi<UiStore>;
  className?: string;
  onSnapshot?: (sample: PerfSample | null) => void;
  activeTool?: InteractionTool;
  onWaterFlowRateChange?: (rate: number) => void;
  onLavaFlowRateChange?: (rate: number) => void;
}

const PANEL_CLASS = [
  'absolute left-0 top-0 z-10 flex w-80 flex-col rounded-br-2xl',
  'border border-white/10 bg-black/70 text-foreground backdrop-blur-xl',
  'pointer-events-auto',
  'max-h-[calc(100vh-2rem)]', // Leave some margin from viewport edges
  'overflow-hidden', // Hide overflow on the container
].join(' ');

const OVERLAY_OPTIONS: OverlayOption[] = [
  'none',
  'contours',
  'height',
  'flow',
  'accumulation',
  'erosion',
  'pools',
  'waterDepth',
  'sediment',
  'lava',
  'temperature',
];

export function TerraformingUI({ engine, store, className, onSnapshot, activeTool = 'select', onWaterFlowRateChange, onLavaFlowRateChange }: TerraformingUIProps) {
  const storeRef = useRef<StoreApi<UiStore>>();
  const [showPerfHud, setShowPerfHud] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showNoiseGenerator, setShowNoiseGenerator] = useState(false);
  const [showSourceIndicators, setShowSourceIndicators] = useState(true);
  const [waterFlowRate, setWaterFlowRate] = useState(10); // Default 10 L/s
  const [lavaFlowRate, setLavaFlowRate] = useState(5); // Default 5 L/s

  if (!storeRef.current) {
    storeRef.current = store ?? createUiStore();
  }

  const uiStore = storeRef.current;

  // Expose store globally for brush operations
  useEffect(() => {
    (window as any).__uiStore = uiStore;
    return () => {
      delete (window as any).__uiStore;
    };
  }, [uiStore]);

  const paused = useUiStore(uiStore, (state) => state.run.paused);
  const togglePaused = useUiStore(uiStore, (state) => state.run.togglePaused);

  const timeScale = useUiStore(uiStore, (state) => state.time.timeScale);
  const setTimeScale = useUiStore(uiStore, (state) => state.time.setTimeScale);

  const quality = useUiStore(
    uiStore,
    (state) => state.quality.settings,
    shallow
  );
  const updateQuality = useUiStore(uiStore, (state) => state.quality.setQuality);

  const overlays = useUiStore(
    uiStore,
    (state) => state.debug.overlays,
    shallow
  );
  const setOverlays = useUiStore(uiStore, (state) => state.debug.setOverlays);

  const waterSources = useUiStore(
    uiStore,
    (state) => state.sources.water,
    shallow
  );
  const lavaSources = useUiStore(
    uiStore,
    (state) => state.sources.lava,
    shallow
  );

  const brush = useUiStore(
    uiStore,
    (state) => state.brush,
    shallow
  );

  useEffect(() => {
    if (!engine) return;
    engine.setRunState(!paused);
    return () => {
      engine.setRunState(false);
    };
  }, [engine, paused]);

  useEffect(() => {
    if (!engine) return;
    engine.setTimeScale(timeScale);
  }, [engine, timeScale]);

  useEffect(() => {
    if (!engine) return;
    engine.setSourceIndicatorsVisible(showSourceIndicators);
  }, [engine, showSourceIndicators]);

  useEffect(() => {
    if (!engine) return;
    engine.setQuality(quality);
  }, [engine, quality]);

  useEffect(() => {
    if (!engine) return;
    const primary = overlays.find((value) => value !== 'none') ?? 'none';
    engine.debug.setOverlay(primary);
  }, [engine, overlays]);

  useEffect(() => {
    if (!engine) return;
    engine.sources.set('water', waterSources);
  }, [engine, waterSources]);

  useEffect(() => {
    if (!engine) return;
    engine.sources.set('lava', lavaSources);
  }, [engine, lavaSources]);

  // Always call the hook to maintain consistent hook order
  const { latest } = usePerfSamples(engine);
  // Only use the latest sample if PerfHud is shown
  const perfSample = showPerfHud ? latest : null;

  const handleSnapshot = () => {
    onSnapshot?.(latest ?? null);
  };

  return (
    <aside className={cn(PANEL_CLASS, className)}>
      {/* Collapse Toggle Header - Fixed at top */}
      <div className={cn("p-4", !isCollapsed && "pb-0")}>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full text-left text-sm font-medium text-white hover:bg-white/10 rounded-lg p-2 transition-colors flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <svg
              className={cn("w-4 h-4 transition-transform", isCollapsed && "rotate-180")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Simulation Controls
          </span>
          <span className="text-xs text-gray-400">{isCollapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>

      {/* Collapsible Content - Scrollable */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 pt-2 space-y-4">
          <RunSection paused={paused} togglePaused={togglePaused} />
          <TimeScaleSection timeScale={timeScale} setTimeScale={setTimeScale} />

          {/* Terrain Generator Button */}
          <div className="space-y-2">
            <button
              onClick={() => setShowNoiseGenerator(true)}
              className="w-full px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30"
            >
              <span className="flex items-center justify-between">
                <span>🌍 Terrain Generator</span>
                <span className="text-xs text-gray-400">Open</span>
              </span>
            </button>
          </div>

          {/* Show contextual tool configuration */}
          {(activeTool === 'add-water-source' || activeTool === 'add-lava-source') ? (
            <SourceSection
              activeTool={activeTool}
              flowRate={activeTool === 'add-water-source' ? waterFlowRate : lavaFlowRate}
              setFlowRate={(rate) => {
                if (activeTool === 'add-water-source') {
                  setWaterFlowRate(rate);
                  onWaterFlowRateChange?.(rate);
                } else {
                  setLavaFlowRate(rate);
                  onLavaFlowRateChange?.(rate);
                }
              }}
            />
          ) : (
            <BrushSection
              mode={brush.mode}
              material={brush.material}
              radius={brush.radius}
              strength={brush.strength}
              isActive={brush.isActive}
              handMass={brush.handMass}
              handCapacity={brush.handCapacity}
              setMode={brush.setMode}
              setMaterial={brush.setMaterial}
              setRadius={brush.setRadius}
              setStrength={brush.setStrength}
            />
          )}

          <QualitySection quality={quality} updateQuality={updateQuality} />
          <DebugOverlaySection
            selected={overlays}
            setSelected={setOverlays}
            options={OVERLAY_OPTIONS}
          />

          {/* Visual Toggles */}
          <div className="space-y-2">
            {/* Source Indicators Toggle */}
            <button
              onClick={() => {
                const newValue = !showSourceIndicators;
                setShowSourceIndicators(newValue);
                if (engine) {
                  engine.setSourceIndicatorsVisible(newValue);
                }
              }}
              className="w-full px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors flex items-center justify-between"
            >
              <span>Source Indicators</span>
              <span className="text-xs text-gray-400">{showSourceIndicators ? 'Hide' : 'Show'}</span>
            </button>

            {/* PerfHud Toggle */}
            <button
              onClick={() => setShowPerfHud(!showPerfHud)}
              className="w-full px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors flex items-center justify-between"
            >
              <span>Performance HUD</span>
              <span className="text-xs text-gray-400">{showPerfHud ? 'Hide' : 'Show'}</span>
            </button>

            {/* Only mount PerfHud when shown for performance */}
            {showPerfHud && (
              <PerfHudSection sample={perfSample} onSnapshot={handleSnapshot} />
            )}
          </div>
        </div>
      )}

      {/* Noise Texture Generator Modal */}
      <NoiseTextureGenerator
        engine={engine}
        isOpen={showNoiseGenerator}
        onClose={() => setShowNoiseGenerator(false)}
      />
    </aside>
  );
}
