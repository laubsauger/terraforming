import { createStore } from 'zustand/vanilla';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import type { StoreApi } from 'zustand';
import type {
  DebugOverlay,
  QualityOpts,
  Source,
} from '@terraforming/types';

export type OverlayOption = DebugOverlay | 'none';

export interface RunSlice {
  paused: boolean;
  setPaused: (value: boolean) => void;
  togglePaused: () => void;
}

export interface TimeSlice {
  timeScale: number;
  setTimeScale: (value: number) => void;
}

export interface QualitySlice {
  settings: QualityOpts;
  setQuality: (partial: Partial<QualityOpts>) => void;
}

export interface DebugSlice {
  overlays: OverlayOption[];
  setOverlays: (values: OverlayOption[]) => void;
  toggleOverlay: (value: OverlayOption) => void;
}

export interface SourcesSlice {
  water: Source[];
  lava: Source[];
  setSources: (kind: 'water' | 'lava', list: Source[]) => void;
  setWaterSources: (list: Source[]) => void;
  setLavaSources: (list: Source[]) => void;
}

export interface UiStateSlices {
  run: RunSlice;
  time: TimeSlice;
  quality: QualitySlice;
  debug: DebugSlice;
  sources: SourcesSlice;
}

export type UiStore = UiStateSlices;

export interface UiInitialState {
  run?: Partial<Pick<RunSlice, 'paused'>>;
  time?: Partial<Pick<TimeSlice, 'timeScale'>>;
  quality?: Partial<Pick<QualitySlice, 'settings'>>;
  debug?: Partial<Pick<DebugSlice, 'overlays'>>;
  sources?: Partial<Pick<SourcesSlice, 'water' | 'lava'>>;
}

export function createUiStore(
  initialState: UiInitialState = {}
): StoreApi<UiStore> {
  const initialQuality: QualityOpts = {
    simResolution: 512,
    simSubsteps: 1,
    terrainClipmapLevels: undefined,
    ...initialState.quality?.settings,
  };

  return createStore<UiStore>((set, get) => ({
    run: {
      paused: initialState.run?.paused ?? true,
      setPaused: (value: boolean) =>
        set((state) => ({
          run: {
            ...state.run,
            paused: value,
          },
        })),
      togglePaused: () =>
        set((state) => ({
          run: {
            ...state.run,
            paused: !state.run.paused,
          },
        })),
    },
    time: {
      timeScale: clampTimeScale(initialState.time?.timeScale ?? 1),
      setTimeScale: (value: number) =>
        set((state) => ({
          time: {
            ...state.time,
            timeScale: clampTimeScale(value),
          },
        })),
    },
    quality: {
      settings: initialQuality,
      setQuality: (partial: Partial<QualityOpts>) =>
        set((state) => ({
          quality: {
            ...state.quality,
            settings: {
              ...state.quality.settings,
              ...partial,
            },
          },
        })),
    },
    debug: {
      overlays: sanitizeOverlayList(initialState.debug?.overlays ?? ['none']),
      setOverlays: (values: OverlayOption[]) =>
        set((state) => ({
          debug: {
            ...state.debug,
            overlays: sanitizeOverlayList(values),
          },
        })),
      toggleOverlay: (value: OverlayOption) =>
        set((state) => ({
          debug: {
            ...state.debug,
            overlays: toggleOverlayValue(state.debug.overlays, value),
          },
        })),
    },
    sources: {
      water: cloneSources(initialState.sources?.water ?? []),
      lava: cloneSources(initialState.sources?.lava ?? []),
      setSources: (kind: 'water' | 'lava', list: Source[]) =>
        set((state) => ({
          sources: {
            ...state.sources,
            [kind]: cloneSources(list),
          } as SourcesSlice,
        })),
      setWaterSources: (list: Source[]) =>
        set((state) => ({
          sources: {
            ...state.sources,
            water: cloneSources(list),
          },
        })),
      setLavaSources: (list: Source[]) =>
        set((state) => ({
          sources: {
            ...state.sources,
            lava: cloneSources(list),
          },
        })),
    },
  }));
}

export function useUiStore<T>(
  store: StoreApi<UiStore>,
  selector: (state: UiStore) => T,
  equalityFn?: (a: T, b: T) => boolean
): T {
  return useStoreWithEqualityFn(store, selector, equalityFn);
}

function sanitizeOverlayList(values: OverlayOption[]): OverlayOption[] {
  const filtered = values.filter((value, index, arr) => arr.indexOf(value) === index);
  if (filtered.length === 0) {
    return ['none'];
  }
  if (filtered.length > 1 && filtered.includes('none')) {
    return filtered.filter((value) => value !== 'none');
  }
  return filtered;
}

function toggleOverlayValue(list: OverlayOption[], value: OverlayOption): OverlayOption[] {
  if (value === 'none') {
    return ['none'];
  }
  const hasValue = list.includes(value);
  const withoutNone = list.filter((item) => item !== 'none');
  if (hasValue) {
    const next = withoutNone.filter((item) => item !== value);
    return sanitizeOverlayList(next);
  }
  return sanitizeOverlayList([...withoutNone, value]);
}

function cloneSources(sources: Source[]) {
  return sources.map((source) => ({ ...source }));
}

function clampTimeScale(value: number) {
  return Math.max(0.1, Math.min(16, value));
}
