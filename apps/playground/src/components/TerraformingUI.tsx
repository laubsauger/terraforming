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
}

const PANEL_CLASS = [
  'absolute left-0 top-0 z-10 flex w-80 flex-col gap-4 rounded-br-2xl',
  'border border-white/10 bg-black/70 p-4 text-foreground backdrop-blur-xl',
  'pointer-events-auto',
].join(' ');

const OVERLAY_OPTIONS: OverlayOption[] = [
  'none',
  'contours',
  'height',
  'flow',
  'accumulation',
  'erosion',
  'pools',
  'sediment',
  'lava',
  'temperature',
];

export function TerraformingUI({ engine, store, className, onSnapshot }: TerraformingUIProps) {
  const storeRef = useRef<StoreApi<UiStore>>();
  const [showPerfHud, setShowPerfHud] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!storeRef.current) {
    storeRef.current = store ?? createUiStore();
  }

  const uiStore = storeRef.current;

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

  // Only use perf samples when PerfHud is shown
  const { latest } = showPerfHud ? usePerfSamples(engine) : { latest: null };

  const handleSnapshot = () => {
    onSnapshot?.(latest ?? null);
  };

  return (
    <aside className={cn(PANEL_CLASS, className)}>
      {/* Collapse Toggle Header */}
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

      {/* Collapsible Content */}
      {!isCollapsed && (
        <>
          <RunSection paused={paused} togglePaused={togglePaused} />
          <TimeScaleSection timeScale={timeScale} setTimeScale={setTimeScale} />

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
            setActive={brush.setActive}
          />

          <QualitySection quality={quality} updateQuality={updateQuality} />
          <DebugOverlaySection
            selected={overlays}
            setSelected={setOverlays}
            options={OVERLAY_OPTIONS}
          />

          {/* PerfHud Toggle */}
          <div className="space-y-2">
            <button
              onClick={() => setShowPerfHud(!showPerfHud)}
              className="w-full px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors flex items-center justify-between"
            >
              <span>Performance HUD</span>
              <span className="text-xs text-gray-400">{showPerfHud ? 'Hide' : 'Show'}</span>
            </button>

            {/* Only mount PerfHud when shown for performance */}
            {showPerfHud && (
              <PerfHudSection sample={latest} onSnapshot={handleSnapshot} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
