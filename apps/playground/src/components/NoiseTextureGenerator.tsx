import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@playground/components/ui/button';
import { Slider } from '@playground/components/ui/slider';
import { Label } from '@playground/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@playground/components/ui/tabs';
import { Input } from '@playground/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@playground/components/ui/dialog';
import { Download, Upload, RotateCcw, Send, RefreshCw } from 'lucide-react';
import type { Engine } from '@terraforming/engine';

interface NoiseParams {
  // Island shape
  islandRadius: number;
  islandFalloff: number;
  islandNoise: number;

  // Base terrain
  baseScale: number;
  baseOctaves: number;
  baseAmplitude: number;

  // Mountains
  mountainThreshold: number;
  mountainScale: number;
  mountainOctaves: number;
  mountainAmplitude: number;
  ridgeStrength: number;

  // Details
  detailScale: number;
  detailOctaves: number;
  detailAmplitude: number;

  // Water level
  waterLevel: number;

  // Smoothing
  smoothingPasses: number;
  smoothingStrength: number;
}

interface NoiseTextureGeneratorProps {
  engine: Engine | null;
  isOpen: boolean;
  onClose: () => void;
}

export function NoiseTextureGenerator({ engine, isOpen, onClose }: NoiseTextureGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [params, setParams] = useState<NoiseParams>({
    islandRadius: 0.7,
    islandFalloff: 0.8,
    islandNoise: 0.3,
    baseScale: 2.0,
    baseOctaves: 4,
    baseAmplitude: 0.5,
    mountainThreshold: 0.4,
    mountainScale: 4.0,
    mountainOctaves: 3,
    mountainAmplitude: 0.8,
    ridgeStrength: 0.6,
    detailScale: 8.0,
    detailOctaves: 2,
    detailAmplitude: 0.15,
    waterLevel: 0.153,
    smoothingPasses: 2,
    smoothingStrength: 0.3,
  });

  const [presetName, setPresetName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [heightData, setHeightData] = useState<Float32Array | null>(null);
  const [savedPresets, setSavedPresets] = useState<{ [key: string]: NoiseParams }>({});
  const [activeTab, setActiveTab] = useState('shape');

  // Noise functions
  const hash2 = useCallback((x: number, y: number): number => {
    let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }, []);

  const smoothstep = useCallback((edge0: number, edge1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }, []);

  const smootherstep = useCallback((edge0: number, edge1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }, []);

  const noise2D = useCallback((x: number, y: number, scale: number, octaves: number = 1): number => {
    let value = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const sx = x * frequency;
      const sy = y * frequency;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const wx = sx - x0;
      const wy = sy - y0;

      const n00 = hash2(x0, y0);
      const n10 = hash2(x1, y0);
      const n01 = hash2(x0, y1);
      const n11 = hash2(x1, y1);

      const sx1 = smoothstep(0, 1, wx);
      const sy1 = smoothstep(0, 1, wy);

      const nx0 = n00 * (1 - sx1) + n10 * sx1;
      const nx1 = n01 * (1 - sx1) + n11 * sx1;
      const nxy = nx0 * (1 - sy1) + nx1 * sy1;

      value += nxy * amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }

    return value / maxValue;
  }, [hash2, smoothstep]);

  const ridgeNoise = useCallback((x: number, y: number, scale: number, octaves: number = 1): number => {
    let value = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const n = noise2D(x, y, frequency, 1);
      const ridge = 1 - Math.abs(n * 2 - 1);
      value += ridge * ridge * amplitude;

      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.3;
    }

    return value / maxValue;
  }, [noise2D]);

  const generateHeightmap = useCallback(async () => {
    setIsGenerating(true);

    // Use the engine's grid size to ensure compatibility
    const size = engine ? engine.getGridSize() : 256;
    const data = new Float32Array(size * size);

    // Generate in chunks to avoid blocking the UI
    const chunkSize = 32;

    for (let chunkY = 0; chunkY < size; chunkY += chunkSize) {
      for (let chunkX = 0; chunkX < size; chunkX += chunkSize) {
        await new Promise(resolve => setTimeout(resolve, 0)); // Yield to UI

        const endY = Math.min(chunkY + chunkSize, size);
        const endX = Math.min(chunkX + chunkSize, size);

        for (let y = chunkY; y < endY; y++) {
          for (let x = chunkX; x < endX; x++) {
            const idx = y * size + x;

            // Normalized coordinates (-1 to 1)
            const nx = (x / size) * 2 - 1;
            const ny = (y / size) * 2 - 1;

            // Distance from center
            const dist = Math.sqrt(nx * nx + ny * ny);

            // Island shape
            const shapeNoise = noise2D(nx * params.islandNoise, ny * params.islandNoise, params.baseScale, 2);
            const islandShape = Math.max(0, 1 - dist * (params.islandRadius + shapeNoise * 0.2));
            const islandMask = Math.pow(islandShape, params.islandFalloff);

            let height = 0;

            if (islandMask > 0.01) {
              // Base terrain
              const baseNoise = noise2D(nx, ny, params.baseScale, params.baseOctaves);
              height = params.waterLevel + islandMask * params.baseAmplitude * (0.5 + baseNoise * 0.5);

              // Mountains
              if (islandMask > params.mountainThreshold) {
                const mountainZone = (islandMask - params.mountainThreshold) / (1 - params.mountainThreshold);
                const ridges = ridgeNoise(nx, ny, params.mountainScale, params.mountainOctaves);
                const mountains = ridges * params.ridgeStrength * mountainZone * params.mountainAmplitude;
                height += mountains;
              }

              // Detail noise
              const details = noise2D(nx, ny, params.detailScale, params.detailOctaves);
              height += details * params.detailAmplitude * islandMask;
            }

            data[idx] = Math.max(0, Math.min(1, height));
          }
        }
      }
    }

    // Apply smoothing
    if (params.smoothingPasses > 0) {
      for (let pass = 0; pass < params.smoothingPasses; pass++) {
        const smoothedData = new Float32Array(size * size);

        for (let y = 1; y < size - 1; y++) {
          for (let x = 1; x < size - 1; x++) {
            const idx = y * size + x;
            const center = data[idx];

            const neighbors = [
              data[(y-1) * size + x],     // top
              data[(y+1) * size + x],     // bottom
              data[y * size + (x-1)],     // left
              data[y * size + (x+1)],     // right
              data[(y-1) * size + (x-1)], // top-left
              data[(y-1) * size + (x+1)], // top-right
              data[(y+1) * size + (x-1)], // bottom-left
              data[(y+1) * size + (x+1)]  // bottom-right
            ];

            let smoothedHeight = center * (1 - params.smoothingStrength);
            for (const neighbor of neighbors) {
              smoothedHeight += neighbor * (params.smoothingStrength / 8);
            }

            smoothedData[idx] = smoothedHeight;
          }
        }

        // Copy smoothed data back
        for (let y = 1; y < size - 1; y++) {
          for (let x = 1; x < size - 1; x++) {
            const idx = y * size + x;
            data[idx] = smoothedData[idx];
          }
        }
      }
    }

    setHeightData(data);
    setIsGenerating(false);

    // Update canvas preview
    updateCanvas(data, size);
  }, [params, noise2D, ridgeNoise]);

  const updateCanvas = useCallback((data: Float32Array, size: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(size, size);

    for (let i = 0; i < size * size; i++) {
      const height = data[i];
      const gray = Math.floor(height * 255);
      const pixelIndex = i * 4;

      imageData.data[pixelIndex] = gray;     // R
      imageData.data[pixelIndex + 1] = gray; // G
      imageData.data[pixelIndex + 2] = gray; // B
      imageData.data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  }, []);

  const exportHeightmap = useCallback(() => {
    if (!heightData) return;

    const canvas = document.createElement('canvas');
    const size = Math.sqrt(heightData.length);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(size, size);

    for (let i = 0; i < heightData.length; i++) {
      const height = heightData[i];
      const gray = Math.floor(height * 255);
      const pixelIndex = i * 4;

      imageData.data[pixelIndex] = gray;
      imageData.data[pixelIndex + 1] = gray;
      imageData.data[pixelIndex + 2] = gray;
      imageData.data[pixelIndex + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `heightmap_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [heightData]);

  const importHeightmap = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      // Use the engine's grid size to ensure compatibility
      const targetSize = engine ? engine.getGridSize() : 256;

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Resize the image to match the target grid size
      ctx.drawImage(img, 0, 0, targetSize, targetSize);
      const imageData = ctx.getImageData(0, 0, targetSize, targetSize);

      const data = new Float32Array(targetSize * targetSize);
      for (let i = 0; i < data.length; i++) {
        const pixelIndex = i * 4;
        const gray = imageData.data[pixelIndex]; // Use red channel
        data[i] = gray / 255;
      }

      setHeightData(data);
      updateCanvas(data, targetSize);
    };

    img.src = URL.createObjectURL(file);
  }, [updateCanvas, engine]);

  const applyToTerrain = useCallback(() => {
    if (!heightData || !engine) return;

    // Apply the heightmap to the terrain renderer
    engine.updateHeightmap(heightData);
  }, [heightData, engine]);

  // Load current heightmap from engine
  const loadCurrentHeightmap = useCallback(() => {
    if (!engine) return;

    const currentData = engine.getCurrentHeightmap();
    if (currentData) {
      const size = Math.sqrt(currentData.length);
      setHeightData(currentData);
      updateCanvas(currentData, size);
      updateCurrentCanvas(currentData, size);
    }
  }, [engine, updateCanvas]);

  // Update current heightmap canvas
  const updateCurrentCanvas = useCallback((data: Float32Array, size: number) => {
    const canvas = currentCanvasRef.current;
    if (!canvas) return;

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(size, size);
    for (let i = 0; i < data.length; i++) {
      const value = Math.max(0, Math.min(1, data[i]));
      const gray = Math.floor(value * 255);
      const idx = i * 4;
      imageData.data[idx] = gray;     // R
      imageData.data[idx + 1] = gray; // G
      imageData.data[idx + 2] = gray; // B
      imageData.data[idx + 3] = 255;  // A
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Save current heightmap to file
  const saveCurrentHeightmap = useCallback(() => {
    if (!engine) return;

    const currentData = engine.getCurrentHeightmap();
    if (!currentData) return;

    const canvas = document.createElement('canvas');
    const size = Math.sqrt(currentData.length);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(size, size);
    for (let i = 0; i < currentData.length; i++) {
      const value = Math.max(0, Math.min(1, currentData[i]));
      const gray = Math.floor(value * 255);
      const idx = i * 4;
      imageData.data[idx] = gray;
      imageData.data[idx + 1] = gray;
      imageData.data[idx + 2] = gray;
      imageData.data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `current-heightmap-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }, [engine]);

  const applyCurrentToTerrain = useCallback(() => {
    if (!engine) return;

    const currentData = engine.getCurrentHeightmap();
    if (!currentData) return;

    const size = Math.sqrt(currentData.length);
    engine.applyHeightmap(currentData, size);
  }, [engine]);

  const resetToDefaults = useCallback(() => {
    setParams({
      islandRadius: 0.7,
      islandFalloff: 0.8,
      islandNoise: 0.3,
      baseScale: 2.0,
      baseOctaves: 4,
      baseAmplitude: 0.5,
      mountainThreshold: 0.4,
      mountainScale: 4.0,
      mountainOctaves: 3,
      mountainAmplitude: 0.8,
      ridgeStrength: 0.6,
      detailScale: 8.0,
      detailOctaves: 2,
      detailAmplitude: 0.15,
      waterLevel: 0.153,
      smoothingPasses: 2,
      smoothingStrength: 0.3,
    });
  }, []);

  const savePreset = useCallback(() => {
    if (!presetName.trim()) return;

    const newPresets = { ...savedPresets, [presetName]: { ...params } };
    setSavedPresets(newPresets);
    localStorage.setItem('terraforming-noise-presets', JSON.stringify(newPresets));
    setPresetName('');
  }, [presetName, params, savedPresets]);

  const loadPreset = useCallback((name: string) => {
    const preset = savedPresets[name];
    if (preset) {
      setParams(preset);
    }
  }, [savedPresets]);

  const deletePreset = useCallback((name: string) => {
    const newPresets = { ...savedPresets };
    delete newPresets[name];
    setSavedPresets(newPresets);
    localStorage.setItem('terraforming-noise-presets', JSON.stringify(newPresets));
  }, [savedPresets]);

  // Load presets from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('terraforming-noise-presets');
      if (saved) {
        setSavedPresets(JSON.parse(saved));
      }
    } catch (error) {
      console.warn('Failed to load saved presets:', error);
    }
  }, []);

  // Auto-generate on parameter changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      generateHeightmap();
    }, 300);

    return () => clearTimeout(timer);
  }, [params, generateHeightmap]);

  // Auto-load current heightmap when "current" tab is selected
  useEffect(() => {
    if (activeTab === 'current') {
      loadCurrentHeightmap();
    }
  }, [activeTab, loadCurrentHeightmap]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] bg-black/95 backdrop-blur-xl border border-white/10 p-0 overflow-hidden text-white">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-white/10">
          <DialogTitle className="text-xl font-semibold text-white">Terrain Generator</DialogTitle>
          <DialogDescription className="text-sm text-gray-400">
            Create procedural terrain using noise functions. Adjust parameters to shape your world.
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[calc(100%-5rem)] overflow-hidden">
          {/* Left side - Controls */}
          <div className="w-1/2 p-6 overflow-y-auto border-r border-white/10 space-y-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-6 bg-white/5 text-white">
                  <TabsTrigger value="shape" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Shape</TabsTrigger>
                  <TabsTrigger value="terrain" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Terrain</TabsTrigger>
                  <TabsTrigger value="mountains" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Mountains</TabsTrigger>
                  <TabsTrigger value="details" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Details</TabsTrigger>
                  <TabsTrigger value="current" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Current</TabsTrigger>
                  <TabsTrigger value="presets" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Presets</TabsTrigger>
                </TabsList>

                <TabsContent value="shape" className="space-y-4">
                  <div>
                    <Label className="text-white">Island Radius: {params.islandRadius.toFixed(2)}</Label>
                    <Slider
                      value={[params.islandRadius]}
                      onValueChange={([value]) => setParams(p => ({ ...p, islandRadius: value }))}
                      min={0.3}
                      max={1.2}
                      step={0.05}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Island Falloff: {params.islandFalloff.toFixed(2)}</Label>
                    <Slider
                      value={[params.islandFalloff]}
                      onValueChange={([value]) => setParams(p => ({ ...p, islandFalloff: value }))}
                      min={0.2}
                      max={2.0}
                      step={0.1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Island Noise: {params.islandNoise.toFixed(2)}</Label>
                    <Slider
                      value={[params.islandNoise]}
                      onValueChange={([value]) => setParams(p => ({ ...p, islandNoise: value }))}
                      min={0}
                      max={1}
                      step={0.05}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Water Level: {params.waterLevel.toFixed(3)}</Label>
                    <Slider
                      value={[params.waterLevel]}
                      onValueChange={([value]) => setParams(p => ({ ...p, waterLevel: value }))}
                      min={0.1}
                      max={0.3}
                      step={0.001}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="terrain" className="space-y-4">
                  <div>
                    <Label className="text-white">Base Scale: {params.baseScale.toFixed(1)}</Label>
                    <Slider
                      value={[params.baseScale]}
                      onValueChange={([value]) => setParams(p => ({ ...p, baseScale: value }))}
                      min={0.5}
                      max={8}
                      step={0.1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Base Octaves: {params.baseOctaves}</Label>
                    <Slider
                      value={[params.baseOctaves]}
                      onValueChange={([value]) => setParams(p => ({ ...p, baseOctaves: Math.round(value) }))}
                      min={1}
                      max={8}
                      step={1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Base Amplitude: {params.baseAmplitude.toFixed(2)}</Label>
                    <Slider
                      value={[params.baseAmplitude]}
                      onValueChange={([value]) => setParams(p => ({ ...p, baseAmplitude: value }))}
                      min={0.1}
                      max={1}
                      step={0.05}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="mountains" className="space-y-4">
                  <div>
                    <Label className="text-white">Mountain Threshold: {params.mountainThreshold.toFixed(2)}</Label>
                    <Slider
                      value={[params.mountainThreshold]}
                      onValueChange={([value]) => setParams(p => ({ ...p, mountainThreshold: value }))}
                      min={0.2}
                      max={0.8}
                      step={0.05}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Mountain Scale: {params.mountainScale.toFixed(1)}</Label>
                    <Slider
                      value={[params.mountainScale]}
                      onValueChange={([value]) => setParams(p => ({ ...p, mountainScale: value }))}
                      min={1}
                      max={12}
                      step={0.5}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Mountain Octaves: {params.mountainOctaves}</Label>
                    <Slider
                      value={[params.mountainOctaves]}
                      onValueChange={([value]) => setParams(p => ({ ...p, mountainOctaves: Math.round(value) }))}
                      min={1}
                      max={6}
                      step={1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Mountain Amplitude: {params.mountainAmplitude.toFixed(2)}</Label>
                    <Slider
                      value={[params.mountainAmplitude]}
                      onValueChange={([value]) => setParams(p => ({ ...p, mountainAmplitude: value }))}
                      min={0.2}
                      max={2}
                      step={0.1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Ridge Strength: {params.ridgeStrength.toFixed(2)}</Label>
                    <Slider
                      value={[params.ridgeStrength]}
                      onValueChange={([value]) => setParams(p => ({ ...p, ridgeStrength: value }))}
                      min={0}
                      max={1}
                      step={0.05}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="details" className="space-y-4">
                  <div>
                    <Label className="text-white">Detail Scale: {params.detailScale.toFixed(1)}</Label>
                    <Slider
                      value={[params.detailScale]}
                      onValueChange={([value]) => setParams(p => ({ ...p, detailScale: value }))}
                      min={2}
                      max={20}
                      step={0.5}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Detail Octaves: {params.detailOctaves}</Label>
                    <Slider
                      value={[params.detailOctaves]}
                      onValueChange={([value]) => setParams(p => ({ ...p, detailOctaves: Math.round(value) }))}
                      min={1}
                      max={4}
                      step={1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Detail Amplitude: {params.detailAmplitude.toFixed(3)}</Label>
                    <Slider
                      value={[params.detailAmplitude]}
                      onValueChange={([value]) => setParams(p => ({ ...p, detailAmplitude: value }))}
                      min={0}
                      max={0.5}
                      step={0.01}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Smoothing Passes: {params.smoothingPasses}</Label>
                    <Slider
                      value={[params.smoothingPasses]}
                      onValueChange={([value]) => setParams(p => ({ ...p, smoothingPasses: Math.round(value) }))}
                      min={0}
                      max={5}
                      step={1}
                    />
                  </div>

                  <div>
                    <Label className="text-white">Smoothing Strength: {params.smoothingStrength.toFixed(2)}</Label>
                    <Slider
                      value={[params.smoothingStrength]}
                      onValueChange={([value]) => setParams(p => ({ ...p, smoothingStrength: value }))}
                      min={0}
                      max={0.8}
                      step={0.05}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="current" className="space-y-4">
                  <div className="space-y-4">
                    <Label className="text-white">Current Terrain Heightmap</Label>
                    <div className="flex items-center justify-center bg-gray-900 rounded border border-white/20 p-4">
                      <canvas
                        ref={currentCanvasRef}
                        className="max-w-full max-h-full object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={loadCurrentHeightmap} variant="outline" size="sm" className="flex-1">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Load Current
                      </Button>
                      <Button onClick={saveCurrentHeightmap} variant="outline" size="sm" className="flex-1">
                        <Download className="w-4 h-4 mr-2" />
                        Save Current
                      </Button>
                    </div>

                    <div className="pt-2">
                      <Button onClick={applyCurrentToTerrain} disabled={!engine} size="sm" className="w-full">
                        <Send className="w-4 h-4 mr-2" />
                        Apply Current to Terrain
                      </Button>
                    </div>

                    <div className="pt-2 border-t border-white/20">
                      <p className="text-xs text-gray-400">
                        Display, save, and restore the current terrain heightmap. Use "Load Current" to update the display, "Save Current" to export as PNG, and "Apply Current to Terrain" to restore the current state.
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="presets" className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white">Save Current Settings</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Preset name..."
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        className="flex-1 bg-white/5 border-white/20 text-white placeholder:text-gray-500"
                      />
                      <Button onClick={savePreset} disabled={!presetName.trim()} size="sm">
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white">Saved Presets ({Object.keys(savedPresets).length})</Label>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {Object.keys(savedPresets).length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No saved presets</p>
                      ) : (
                        Object.keys(savedPresets).map((name) => (
                          <div key={name} className="flex items-center gap-2 p-2 bg-gray-800 rounded">
                            <span className="flex-1 text-sm text-white">{name}</span>
                            <Button onClick={() => loadPreset(name)} variant="outline" size="sm">
                              Load
                            </Button>
                            <Button
                              onClick={() => deletePreset(name)}
                              variant="outline"
                              size="sm"
                              className="text-red-400 hover:text-red-300"
                            >
                              ×
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/20">
                    <p className="text-xs text-gray-400">
                      Presets are saved to browser localStorage and will persist between sessions.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-4 border-t border-white/20">
                <Button onClick={resetToDefaults} variant="outline" size="sm">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>

                <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm">
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </Button>

                <Button onClick={exportHeightmap} disabled={!heightData} variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>

                <Button onClick={applyToTerrain} disabled={!heightData || !engine} size="sm">
                  <Send className="w-4 h-4 mr-2" />
                  Apply to Terrain
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={importHeightmap}
                className="hidden"
              />
          </div>

          {/* Right side - Preview */}
          <div className="w-1/2 p-6 flex flex-col">
              <Label className="mb-2 text-white">Preview {isGenerating && '(Generating...)'}</Label>
              <div className="flex-1 flex items-center justify-center bg-gray-900 rounded border border-white/20">
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}