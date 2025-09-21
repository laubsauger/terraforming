import { useEffect, useRef } from 'react';
import type { Engine } from '@terraforming/engine';
import { shallow } from 'zustand/shallow';
import type { StoreApi } from 'zustand/vanilla';
import { usePerfSamples } from '@playground/hooks/usePerfSamples';
import {
  createUiStore,
  useUiStore,
  type OverlayOption,
  type UiStore,
} from '@playground/store/uiStore';
import { RunSection } from '@playground/components/sections/RunSection'
import {cn} from '@playground/lib/utils'
import { DebugOverlaySection } from './sections/DebugOverlaySection';
import { PerfHudSection } from './sections/PerfHudSection';
import { QualitySection } from './sections/QualitySection';
import { TimeScaleSection } from './sections/TimeScaleSection';

autoBindPointerEvents();

export interface TerraformingUIProps {
  engine: Engine | null;
  store?: StoreApi<UiStore>;
  className?: string;
}

const PANEL_CLASS = 'tf-panel'

const OVERLAY_OPTIONS: OverlayOption[] = [
  'accumulation',
  'flow',
  'lava',
  'pools',
  'sediment',
  'temperature'
]

export function TerraformingUI({ engine, store, className }: TerraformingUIProps) {
  const storeRef = useRef<StoreApi<UiStore>>();

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

  const overlay = useUiStore(uiStore, (state) => state.debug.overlay);
  const setOverlay = useUiStore(uiStore, (state) => state.debug.setOverlay);

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
    engine.debug.setOverlay(overlay);
  }, [engine, overlay]);

  useEffect(() => {
    if (!engine) return;
    engine.sources.set('water', waterSources);
  }, [engine, waterSources]);

  useEffect(() => {
    if (!engine) return;
    engine.sources.set('lava', lavaSources);
  }, [engine, lavaSources]);

  const { latest } = usePerfSamples(engine);

  return (
    <aside className={cn(PANEL_CLASS, className)}>
      <RunSection paused={paused} togglePaused={togglePaused} />
      <TimeScaleSection timeScale={timeScale} setTimeScale={setTimeScale} />
      <QualitySection quality={quality} updateQuality={updateQuality} />
      <DebugOverlaySection
        overlay={overlay}
        setOverlay={setOverlay}
        options={OVERLAY_OPTIONS}
      />
      <PerfHudSection sample={latest} />
    </aside>
  );
}

function autoBindPointerEvents() {
  if (typeof document === 'undefined') return;
  document.body.style.margin = '0';
  document.body.style.backgroundColor = '#030409';
}
