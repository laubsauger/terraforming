import { useEffect, useRef } from 'react';
import Stats from 'stats.js';

export function StatsPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<Stats | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create stats instance
    const stats = new Stats();
    statsRef.current = stats;

    // Show FPS panel by default
    stats.showPanel(0); // 0: fps, 1: ms, 2: mb

    // Style the stats panel
    stats.dom.style.position = 'absolute';
    stats.dom.style.left = '0';
    stats.dom.style.bottom = '0';
    stats.dom.style.top = 'auto';

    // Add to container
    containerRef.current.appendChild(stats.dom);

    // Animation loop
    let rafId: number;
    const animate = () => {
      stats.update();
      rafId = requestAnimationFrame(animate);
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(rafId);
      if (containerRef.current?.contains(stats.dom)) {
        containerRef.current.removeChild(stats.dom);
      }
      statsRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed bottom-0 left-0 z-50"
      style={{ mixBlendMode: 'normal' }}
    />
  );
}