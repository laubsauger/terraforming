import type { ReactNode } from 'react';
import * as ToolbarPrimitive from '@radix-ui/react-toolbar';
import { cn } from '@playground/lib/utils';

export type InteractionTool =
  | 'select'
  | 'brush-raise'
  | 'brush-smooth'
  | 'add-water-source'
  | 'add-lava-source';

export interface ToolbarAction {
  id: InteractionTool;
  label: string;
  icon: ReactNode;
}

export interface InteractionToolbarProps {
  actions: ToolbarAction[];
  activeTool: InteractionTool;
  onToolChange: (tool: InteractionTool) => void;
  className?: string;
}

export function InteractionToolbar({ actions, activeTool, onToolChange, className }: InteractionToolbarProps) {
  return (
    <ToolbarPrimitive.Root
      className={cn(
        'pointer-events-auto flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/70 p-3 shadow-lg shadow-black/50 backdrop-blur-xl',
        className
      )}
    >
      {actions.map((tool) => {
        const isActive = tool.id === activeTool;
        return (
          <ToolbarPrimitive.Button
            key={tool.id}
            type="button"
            className={cn(
              'h-10 w-10 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              'flex items-center justify-center text-muted-foreground hover:bg-white/10 hover:text-foreground',
              isActive && 'bg-primary/80 text-primary-foreground shadow'
            )}
            aria-label={tool.label}
            aria-pressed={isActive}
            onClick={() => onToolChange(tool.id)}
          >
            {tool.icon}
          </ToolbarPrimitive.Button>
        );
      })}
    </ToolbarPrimitive.Root>
  );
}
