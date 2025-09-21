import type { ReactNode } from 'react';
import { cn } from '@playground/lib/utils';

interface UiSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function UiSection({ title, children, className }: UiSectionProps) {
  return (
    <section className={cn('tf-section', className)}>
      <h2 className="tf-section-title">
        {title}
      </h2>
      <div className="tf-section-body">{children}</div>
    </section>
  );
}
