import type { ReactNode } from 'react';
import { cn } from '@playground/lib/utils';

interface UiSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function UiSection({ title, children, className }: UiSectionProps) {
  return (
    <section className={cn('space-y-2', className)}>
      <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
