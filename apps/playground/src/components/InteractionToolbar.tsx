import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as ToolbarPrimitive from '@radix-ui/react-toolbar';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@playground/lib/utils';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@playground/components/ui/tooltip';

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
  shortcut: string;
  color?: string;
}

export interface InteractionToolbarProps {
  actions: ToolbarAction[];
  activeTool: InteractionTool;
  onToolChange: (tool: InteractionTool) => void;
  className?: string;
}

export function InteractionToolbar({ actions, activeTool, onToolChange, className }: InteractionToolbarProps) {
  const [expanded, setExpanded] = useState(false);

  const rootClasses = cn(
    'pointer-events-auto flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/70 p-3 shadow-lg shadow-black/50 backdrop-blur-xl transition-[width] duration-150 ease-out',
    expanded ? 'w-52' : 'w-16',
    className
  );

  const formattedActions = useMemo(
    () =>
      actions.map((action) => ({
        ...action,
        shortcutLabel: action.shortcut.toUpperCase(),
      })),
    [actions]
  );

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={0} disableHoverableContent>
      <ToolbarPrimitive.Root className={rootClasses} aria-label="Interaction tools">
        {formattedActions.map((tool) => {
          const isActive = tool.id === activeTool;
          const shortcutAttr = tool.shortcut.toLowerCase();
          const toolColor = tool.color;
          const button = (
            <ToolbarPrimitive.Button
              key={tool.id}
              type="button"
              className={cn(
                'flex h-10 items-center rounded-full px-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                'text-muted-foreground hover:bg-white/10 hover:text-foreground',
                expanded ? 'w-full justify-start gap-3' : 'w-10 justify-center',
                isActive && 'bg-primary/80 text-primary-foreground shadow'
              )}
              style={toolColor && isActive ? {
                backgroundColor: `${toolColor}20`,
                borderColor: toolColor,
                color: toolColor
              } : undefined}
              aria-label={`${tool.label} (${tool.shortcut.toUpperCase()})`}
              aria-pressed={isActive}
              aria-keyshortcuts={shortcutAttr}
              onClick={() => onToolChange(tool.id)}
            >
              <span
                className="flex h-8 w-8 items-center justify-center"
                style={toolColor ? { color: toolColor } : undefined}
              >
                {tool.icon}
              </span>
              {expanded && (
                <span className="flex flex-1 items-center justify-between text-sm font-medium text-foreground">
                  <span className="capitalize">{tool.label}</span>
                  <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/80">
                    {tool.shortcutLabel}
                  </kbd>
                </span>
              )}
            </ToolbarPrimitive.Button>
          );

          if (expanded) {
            return button;
          }

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="left">
                <div className="flex items-center gap-2">
                  <span className="capitalize">{tool.label}</span>
                  <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/80">
                    {tool.shortcutLabel}
                  </kbd>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        <ToolbarPrimitive.Separator className="my-2 h-px w-full bg-white/10" />

        <ToolbarPrimitive.Button
          type="button"
          aria-label={expanded ? 'Collapse toolbar' : 'Expand toolbar'}
          className={cn(
            'flex h-10 items-center justify-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            expanded ? 'w-full' : 'w-10'
          )}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <div className="flex w-full items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide">
              <span>Collapse</span>
              <ChevronsRight className="h-4 w-4" />
            </div>
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </ToolbarPrimitive.Button>
      </ToolbarPrimitive.Root>
    </TooltipProvider>
  );
}
