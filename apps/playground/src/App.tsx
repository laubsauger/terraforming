import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerraformingUI } from '@playground/components/TerraformingUI';
import type { Engine } from '@terraforming/engine';
import { InteractionToolbar, type InteractionTool } from '@playground/components/InteractionToolbar';
import type { PerfSample } from '@terraforming/types';
import { initEngine } from '@terraforming/engine';
import { Pointer, Wand2, Waves, Droplets, Flame } from 'lucide-react';
import { StatsPanel } from '@playground/components/StatsPanel';
import { BrushSettings } from '@playground/components/BrushSettings';
import { ToolCursor, TOOL_COLORS } from '@playground/components/ToolCursor';
import { TerrainCursor } from '@playground/components/TerrainCursor';

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
  const [brushSize, setBrushSize] = useState(5); // Reduced from 10 to 5 for better initial size
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showCursor, setShowCursor] = useState(false);
  const [isAdjustingBrush, setIsAdjustingBrush] = useState(false);

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
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToolChange, shortcutMap]);

  // Mouse tracking for tool cursor
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setMousePosition({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        });
      }
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
      const step = 1; // Fine step size for shift+scroll

      setBrushSize(prev => {
        const newSize = prev + (delta * step);
        return Math.max(1, Math.min(15, newSize)); // Reduced max from 50 to 15
      });
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

      {activeTool !== 'select' && (
        <BrushSettings
          brushSize={brushSize}
          brushStrength={brushStrength}
          onSizeChange={setBrushSize}
          onStrengthChange={setBrushStrength}
          className="absolute top-1/2 right-20 -translate-y-1/2"
        />
      )}

      <StatsPanel />

      {/* Show appropriate cursor based on tool type */}
      {activeTool === 'select' ? (
        <ToolCursor
          activeTool={activeTool}
          brushSize={brushSize}
          isVisible={showCursor}
          position={mousePosition}
        />
      ) : (
        <TerrainCursor
          activeTool={activeTool}
          brushSize={brushSize}
          isVisible={showCursor || isAdjustingBrush}
          engine={engine}
          mousePosition={mousePosition}
          canvasElement={canvasRef.current}
        />
      )}

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
