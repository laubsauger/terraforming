import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerraformingUI } from '@playground/components/TerraformingUI';
import type { Engine } from '@terraforming/engine';
import { InteractionToolbar, type InteractionTool } from '@playground/components/InteractionToolbar';
import type { PerfSample, Source } from '@terraforming/types';
import { initEngine } from '@terraforming/engine';
import { Pointer, Wand2, Waves, Droplets, Flame } from 'lucide-react';
import { StatsPanel } from '@playground/components/StatsPanel';
import { ToolCursor, TOOL_COLORS } from '@playground/components/ToolCursor';
import { TerrainCursor } from '@playground/components/TerrainCursor';
import { DayNightControls } from '@playground/components/DayNightControls';
import { raycastToTerrain } from '@playground/utils/raycasting';

type BootstrapState = 'pending' | 'ready' | 'error';

let resizeBound = false;

ensureDarkMode();
autoResizeCanvas();

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [state, setState] = useState<BootstrapState>('pending');
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<InteractionTool>('select');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showCursor, setShowCursor] = useState(false);
  const [isAdjustingBrush, setIsAdjustingBrush] = useState(false);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [brushSize, setBrushSize] = useState(5); // Used for visual feedback only
  const [brushHandMass, setBrushHandMass] = useState(0);
  const [brushHandCapacity, setBrushHandCapacity] = useState(100000000);
  const [brushMode, setBrushMode] = useState<'pickup' | 'deposit'>('pickup');
  const [waterSources, setWaterSources] = useState<Source[]>([]);
  const [lavaSources, setLavaSources] = useState<Source[]>([]);
  const dragIntervalRef = useRef<number | null>(null);

  // Detect OS for correct modifier key
  const isMac = typeof navigator !== 'undefined' &&
    (navigator.userAgent.toLowerCase().includes('mac') ||
     navigator.platform?.toLowerCase().includes('mac'));
  const modifierKey = isMac ? 'Option' : 'Alt';

  const toolbarActions = useMemo(
    () => [
      {
        id: 'select' as InteractionTool,
        label: 'Select tool',
        icon: <Pointer className="h-4 w-4" />,
        shortcut: 'q',
        color: TOOL_COLORS.select,
      },
      {
        id: 'brush-raise' as InteractionTool,
        label: 'Raise terrain',
        icon: <Wand2 className="h-4 w-4" />,
        shortcut: 'w',
        color: TOOL_COLORS['brush-raise'],
      },
      {
        id: 'brush-smooth' as InteractionTool,
        label: 'Smooth terrain',
        icon: <Waves className="h-4 w-4" />,
        shortcut: 'e',
        color: TOOL_COLORS['brush-smooth'],
      },
      {
        id: 'add-water-source' as InteractionTool,
        label: 'Add water source',
        icon: <Droplets className="h-4 w-4" />,
        shortcut: 'r',
        color: TOOL_COLORS['add-water-source'],
      },
      {
        id: 'add-lava-source' as InteractionTool,
        label: 'Add lava source',
        icon: <Flame className="h-4 w-4" />,
        shortcut: 't',
        color: TOOL_COLORS['add-lava-source'],
      },
    ],
    []
  );

  const shortcutMap = useMemo(() => {
    const map = new Map<string, InteractionTool>();
    toolbarActions.forEach(({ shortcut, id }) => {
      map.set(shortcut.toLowerCase(), id);
    });
    return map;
  }, [toolbarActions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!isWebGpuAvailable()) {
      setError('WebGPU is not available. Enable chrome://flags/#enable-unsafe-webgpu or try a supported browser.');
      setState('error');
      return;
    }

    let active = true;

    initEngine(canvas)
      .then((instance) => {
        if (!active) {
          instance.dispose();
          return;
        }
        setEngine(instance);
        setState('ready');
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setState('error');
      });

    return () => {
      active = false;
      setState('pending');
      setEngine((value) => {
        value?.dispose();
        return null;
      });
    };
  }, []);

  const handleSnapshot = (sample: PerfSample | null) => {
    console.log('snapshot requested', sample);
  };

  const handleToolChange = useCallback((tool: InteractionTool) => {
    setActiveTool(tool);
    // TODO: wire tool selection into engine brush/tool system
  }, []);

  const addWaterSource = useCallback((position: [number, number], rate: number = 1.0) => {
    const newSource: Source = {
      id: `water-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      position,
      rate
    };
    setWaterSources(prev => [...prev, newSource]);
  }, []);

  const addLavaSource = useCallback((position: [number, number], rate: number = 0.5) => {
    const newSource: Source = {
      id: `lava-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      position,
      rate
    };
    setLavaSources(prev => [...prev, newSource]);
  }, []);

  const removeWaterSource = useCallback((id: string) => {
    setWaterSources(prev => prev.filter(source => source.id !== id));
  }, []);

  const removeLavaSource = useCallback((id: string) => {
    setLavaSources(prev => prev.filter(source => source.id !== id));
  }, []);

  // Update engine sources when sources change
  useEffect(() => {
    if (engine) {
      engine.sources.set('water', waterSources);
      console.log('Updated water sources:', waterSources);
    }
  }, [engine, waterSources]);

  useEffect(() => {
    if (engine) {
      engine.sources.set('lava', lavaSources);
      console.log('Updated lava sources:', lavaSources);
    }
  }, [engine, lavaSources]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Track Alt/Option key
      if (event.altKey) {
        setIsAltPressed(true);
      }

      if (event.defaultPrevented) return;

      // Handle spacebar to toggle pickup/deposit mode
      if (event.key === ' ' || event.key === 'Space') {
        const target = event.target as HTMLElement | null;
        if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }

        event.preventDefault();
        const uiStore = (window as any).__uiStore;
        if (uiStore) {
          const brushState = uiStore.getState().brush;
          const newMode = brushState.mode === 'pickup' ? 'deposit' : 'pickup';
          brushState.setMode(newMode);
          console.log('Toggled brush mode to:', newMode);
        }
        return;
      }

      // Don't block shortcuts when Alt is pressed, but block others
      if (event.metaKey || event.ctrlKey) return;

      // If Alt is pressed, don't process tool shortcuts
      if (event.altKey) return;

      const key = event.key.toLowerCase();
      const tool = shortcutMap.get(key);
      if (!tool) return;

      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      event.preventDefault();
      handleToolChange(tool);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // Release Alt/Option key
      if (!event.altKey) {
        setIsAltPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleToolChange, shortcutMap]);

  // Sync brush state from UI store
  useEffect(() => {
    const syncBrushState = () => {
      const uiStore = (window as any).__uiStore;
      if (uiStore) {
        const brushState = uiStore.getState().brush;
        setBrushSize(brushState.radius);
        setBrushHandMass(brushState.handMass);
        setBrushHandCapacity(brushState.handCapacity);
        setBrushMode(brushState.mode);
      }
    };

    // Initial sync
    syncBrushState();

    // Set up interval to sync periodically
    const interval = setInterval(syncBrushState, 100);
    return () => clearInterval(interval);
  }, []);

  // Handle brush operations when Alt+Click
  useEffect(() => {
    if (!engine || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let lastBrushTime = 0;
    const BRUSH_RATE = 1000 / 30; // 30Hz for smooth painting
    let lastMouseEvent: MouseEvent | null = null;
    let animationFrameId: number | null = null;
    let localIsDragging = false;
    let localIsAltPressed = false;
    let localIsCmdPressed = false;

    const performBrushOperation = (event: MouseEvent) => {
      const uiStore = (window as any).__uiStore;
      if (!uiStore) {
        console.log('No UI store available');
        return false;
      }

      // Use shared raycasting utility
      const raycastResult = raycastToTerrain(engine, canvas, {
        x: event.clientX,
        y: event.clientY
      });

      if (raycastResult) {
        const point = raycastResult.point;
        const brushState = uiStore.getState().brush;

        // Invert mode if CMD is held
        const actualMode = (event.metaKey || localIsCmdPressed)
          ? (brushState.mode === 'pickup' ? 'deposit' : 'pickup')
          : brushState.mode;

        // Check capacity limits BEFORE queuing operation
        const isFull = brushState.handMass >= brushState.handCapacity * 0.99; // 99% full
        const isEmpty = brushState.handMass <= brushState.handCapacity * 0.01; // 1% or less

        // Block operation if at capacity limits
        if (actualMode === 'pickup' && isFull) {
          console.log('Hand is full! Cannot pick up more material.');
          return false; // Stop picking up when full
        }

        if (actualMode === 'deposit' && isEmpty) {
          console.log('Hand is empty! Nothing to deposit.');
          return false; // Stop depositing when empty
        }

        console.log('Queueing brush operation:', {
          mode: actualMode,
          material: brushState.material,
          worldX: point.x,
          worldZ: point.z,
          radius: brushState.radius,
          strength: brushState.strength,
          handMass: brushState.handMass,
          handCapacity: brushState.handCapacity,
          cmdHeld: event.metaKey || localIsCmdPressed
        });

        // Queue the brush operation with potentially inverted mode
        engine.brush.enqueue({
          mode: actualMode,
          material: brushState.material,
          worldX: point.x,
          worldZ: point.z,
          radius: brushState.radius,
          strength: brushState.strength,
          dt: 0.033 // ~30fps for smoother operations
        });

        return true;
      }
      console.log('No terrain intersection found');
      return false;
    };

    const performSourcePlacement = (event: MouseEvent) => {
      // Use shared raycasting utility
      const raycastResult = raycastToTerrain(engine, canvas, {
        x: event.clientX,
        y: event.clientY
      });

      if (raycastResult) {
        const point = raycastResult.point;
        const position: [number, number] = [point.x, point.z];

        console.log('Placing source at:', position, 'Active tool:', activeTool);

        if (activeTool === 'add-water-source') {
          addWaterSource(position, 1.0); // Default rate
        } else if (activeTool === 'add-lava-source') {
          addLavaSource(position, 0.5); // Default rate
        }
        return true;
      }
      console.log('No terrain intersection found for source placement');
      return false;
    };

    const handlePointerDown = (event: MouseEvent) => {
      console.log('Pointer down, alt key held:', event.altKey, 'button:', event.button, 'active tool:', activeTool);

      // Handle source placement for regular clicks (no alt key) when source tools are active
      if (!event.altKey && event.button === 0 && (activeTool === 'add-water-source' || activeTool === 'add-lava-source')) {
        console.log('Placing source');
        event.preventDefault();
        event.stopPropagation();
        performSourcePlacement(event);
        return;
      }

      if (event.altKey && event.button === 0) { // Left click only
        console.log('Starting brush drag');
        event.preventDefault();
        event.stopPropagation();
        localIsDragging = true;
        localIsAltPressed = true;
        setIsDragging(true);
        lastMouseEvent = event; // Store initial event

        // Mark brush as active in UI
        const uiStore = (window as any).__uiStore;
        if (uiStore) {
          uiStore.getState().brush.setActive(true);
        }

        // Perform initial brush operation
        const success = performBrushOperation(event);
        console.log('Initial brush operation result:', success);
        lastBrushTime = Date.now();

        // Start continuous brush loop
        animationFrameId = requestAnimationFrame(continuousBrushLoop);
      }
    };

    // Continuous brush operation loop
    const continuousBrushLoop = () => {
      if (localIsDragging && localIsAltPressed && lastMouseEvent) {
        const now = Date.now();
        if (now - lastBrushTime >= BRUSH_RATE) {
          performBrushOperation(lastMouseEvent);
          lastBrushTime = now;
        }
      }
      if (localIsDragging) {
        animationFrameId = requestAnimationFrame(continuousBrushLoop);
      }
    };

    const handlePointerMove = (event: MouseEvent) => {
      // Store for continuous brush operation
      lastMouseEvent = event;

      // Track modifier key states
      localIsAltPressed = event.altKey;
      localIsCmdPressed = event.metaKey;
    };

    const handlePointerUp = () => {
      if (localIsDragging) {
        localIsDragging = false;
        setIsDragging(false);

        // Cancel animation frame
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }

        // Mark brush as inactive
        const uiStore = (window as any).__uiStore;
        if (uiStore) {
          uiStore.getState().brush.setActive(false);
        }
      }
    };

    // Track modifier key states
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        localIsAltPressed = true;
      }
      if (event.metaKey) {
        localIsCmdPressed = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.altKey) {
        localIsAltPressed = false;
        // Stop dragging if Alt is released
        if (localIsDragging) {
          handlePointerUp();
        }
      }
      if (!event.metaKey) {
        localIsCmdPressed = false;
      }
    };

    // Use pointer events for better touch/mouse support
    canvas.addEventListener('pointerdown', handlePointerDown, { capture: true });
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      canvas.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [engine, activeTool, addWaterSource, addLavaSource]); // Add source management dependencies

  // Mouse tracking for tool cursor - always track position
  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      // Always update mouse position for cursor tracking
      setMousePosition({ x: event.clientX, y: event.clientY });
    };

    const handleMouseEnter = () => setShowCursor(true);
    const handleMouseLeave = () => setShowCursor(false);

    const canvas = canvasRef.current;
    if (canvas) {
      // Use pointermove for consistent tracking during drag operations
      canvas.addEventListener('pointermove', handlePointerMove);
      canvas.addEventListener('mouseenter', handleMouseEnter);
      canvas.addEventListener('mouseleave', handleMouseLeave);

      return () => {
        canvas.removeEventListener('pointermove', handlePointerMove);
        canvas.removeEventListener('mouseenter', handleMouseEnter);
        canvas.removeEventListener('mouseleave', handleMouseLeave);
      };
    }

    return () => {}; // No cleanup needed if canvas is not available
  }, []);

  useEffect(() => {
    let brushAdjustTimeout: number | null = null;

    const handleWheel = (event: WheelEvent) => {
      // Only handle brush size adjustment when Shift is held
      if (!event.shiftKey) return;

      // Only handle when over the canvas
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest('canvas')) return;

      // Prevent page scroll when adjusting brush size
      event.preventDefault();

      // Mark that we're adjusting brush size
      setIsAdjustingBrush(true);

      // Clear existing timeout
      if (brushAdjustTimeout) {
        clearTimeout(brushAdjustTimeout);
      }

      // Set timeout to stop adjusting after 200ms of no wheel events
      brushAdjustTimeout = window.setTimeout(() => {
        setIsAdjustingBrush(false);
      }, 200);

      // Calculate size change (fine control with shift)
      const delta = event.deltaY > 0 ? -1 : 1;
      const step = 0.25; // Much finer step size for shift+scroll (quarter increments)

      const uiStore = (window as any).__uiStore;
      if (uiStore) {
        const brushState = uiStore.getState().brush;
        const currentRadius = brushState.radius;
        const newRadius = Math.max(1, Math.min(15, currentRadius + (delta * step)));
        brushState.setRadius(Math.round(newRadius * 4) / 4); // Round to nearest 0.25
        setBrushSize(newRadius); // Update local state for visual feedback
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
      if (brushAdjustTimeout) {
        clearTimeout(brushAdjustTimeout);
      }
    };
  }, []);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top,#1b2735,#090a0f)]">
      <canvas ref={canvasRef} className="block h-full w-full" />

      <TerraformingUI
        engine={engine}
        className="shadow-2xl shadow-black/70 ring-1 ring-white/10"
        onSnapshot={handleSnapshot}
      />

      <InteractionToolbar
        actions={toolbarActions}
        activeTool={activeTool}
        onToolChange={handleToolChange}
        className="absolute top-1/2 right-4 -translate-y-1/2"
      />

      {/* Brush settings removed - now in left sidebar only */}

      <StatsPanel />

      <DayNightControls
        engine={engine}
        className="absolute bottom-4 right-4"
      />


      {/* Always use TerrainCursor for all tools for consistent terrain-following behavior */}
      <TerrainCursor
        activeTool={activeTool}
        brushSize={brushSize}
        isVisible={showCursor || isAdjustingBrush}
        engine={engine}
        mousePosition={mousePosition}
        canvasElement={canvasRef.current}
        isAltPressed={isAltPressed}
        handMass={brushHandMass}
        handCapacity={brushHandCapacity}
        brushMode={brushMode}
      />

      {state === 'pending' && (
        <StatusToast message="Initializing engine…" />
      )}
      {state === 'error' && error && (
        <StatusToast message={error} tone="error" />
      )}
    </div>
  );
}

interface StatusToastProps {
  message: string;
  tone?: 'info' | 'error';
}

function StatusToast({ message, tone = 'info' }: StatusToastProps) {
  const isError = tone === 'error';
  const variant = isError
    ? 'from-red-600/80 to-rose-700/80'
    : 'from-blue-600/80 to-indigo-700/80';

  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 w-max -translate-x-1/2 rounded-xl border border-white/10 bg-gradient-to-br px-4 py-3 text-sm font-medium text-foreground shadow-2xl shadow-black/40 backdrop-blur ${variant}`}
    >
      {message}
    </div>
  );
}

function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function autoResizeCanvas() {
  if (typeof window === 'undefined' || resizeBound) return;
  resizeBound = true;

  const apply = () => {
    document.body.style.margin = '0';
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
  };

  window.addEventListener('resize', apply, { passive: true });
  apply();
}

function ensureDarkMode() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add('dark');
}
