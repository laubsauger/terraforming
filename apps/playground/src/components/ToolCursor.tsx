import { useEffect, useRef, useState } from 'react';
import type { InteractionTool } from './InteractionToolbar';

export const TOOL_COLORS = {
  'select': '#ffffff',
  'brush-raise': '#8b4513', // Brown for terrain
  'brush-smooth': '#ffd700', // Gold for smoothing
  'add-water-source': '#0099cc', // Blue for water
  'add-lava-source': '#ff4500', // Orange-red for lava
} as const;

interface ToolCursorProps {
  activeTool: InteractionTool;
  brushSize: number;
  isVisible: boolean;
  position: { x: number; y: number };
}

export function ToolCursor({ activeTool, brushSize, isVisible, position }: ToolCursorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isVisible) return;

    const color = TOOL_COLORS[activeTool];
    const radius = brushSize;

    // Draw outer circle (tool radius)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(activeTool === 'select' ? [4, 4] : []);
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center dot
    if (activeTool !== 'select') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, 2, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Special styling for select tool
    if (activeTool === 'select') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      // Draw crosshair
      const crossSize = 8;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - crossSize, canvas.height / 2);
      ctx.lineTo(canvas.width / 2 + crossSize, canvas.height / 2);
      ctx.moveTo(canvas.width / 2, canvas.height / 2 - crossSize);
      ctx.lineTo(canvas.width / 2, canvas.height / 2 + crossSize);
      ctx.stroke();
    }
  }, [activeTool, brushSize, isVisible]);

  if (!isVisible) {
    return null;
  }

  const size = Math.max(brushSize * 2 + 20, 100); // Ensure minimum size for crosshair

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: position.x - size / 2,
        top: position.y - size / 2,
        width: size,
        height: size,
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="block"
      />
    </div>
  );
}