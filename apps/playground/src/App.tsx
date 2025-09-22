import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerraformingUI } from '@playground/components/TerraformingUI';
import type { Engine } from '@terraforming/engine';
import { InteractionToolbar, type InteractionTool } from '@playground/components/InteractionToolbar';
import type { PerfSample } from '@terraforming/types';
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Track Alt/Option key
      if (event.altKey) {
        setIsAltPressed(true);
      }

      if (event.defaultPrevented) return;
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

  // Sync brush size from UI store
  useEffect(() => {
    const syncBrushSize = () => {
      const uiStore = (window as any).__uiStore;
      if (uiStore) {
        const brushState = uiStore.getState().brush;
        setBrushSize(brushState.radius);
      }
    };

    // Initial sync
    syncBrushSize();

    // Set up interval to sync periodically
    const interval = setInterval(syncBrushSize, 100);
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

        console.log('Queueing brush operation:', {
          mode: brushState.mode,
          material: brushState.material,
          worldX: point.x,
          worldZ: point.z,
          radius: brushState.radius,
          strength: brushState.strength
        });

        // Queue the brush operation
        engine.brush.enqueue({
          mode: brushState.mode,
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

    const handlePointerDown = (event: MouseEvent) => {
      console.log('Pointer down, alt key held:', event.altKey, 'button:', event.button);
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
      // Always update mouse position
      setMousePosition({ x: event.clientX, y: event.clientY });
      lastMouseEvent = event; // Store for continuous operation

      // Track alt key state
      localIsAltPressed = event.altKey;
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

    // Track Alt key state
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        localIsAltPressed = true;
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
  }, [engine]); // Remove isAltPressed and isDragging from dependencies

  // Mouse tracking for tool cursor
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      // Store global mouse position for accurate raycasting
      setMousePosition({ x: event.clientX, y: event.clientY });
    };

    const handleMouseEnter = () => setShowCursor(true);
    const handleMouseLeave = () => setShowCursor(false);

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseenter', handleMouseEnter);
      canvas.addEventListener('mouseleave', handleMouseLeave);

      return () => {
        canvas.removeEventListener('mousemove', handleMouseMove);
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
