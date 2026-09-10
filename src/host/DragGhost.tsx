import { useEffect, useRef } from 'react';

interface DragGhostProps {
  labels: string[];
  /** Pointer position when the drag started, before the first move arrives. */
  origin: { x: number; y: number };
}

/**
 * The thing that follows the cursor during a drag. Purely host-side chrome —
 * MagicChat neither knows nor cares that it exists.
 *
 * It positions itself by writing to `style.transform` from its own pointermove
 * listener, so a drag does not re-render the whole host on every frame.
 */
export function DragGhost({ labels, origin }: DragGhostProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const element = elementRef.current;
      if (element) {
        element.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
      }
    };

    document.addEventListener('pointermove', handleMove, true);
    return () => document.removeEventListener('pointermove', handleMove, true);
  }, []);

  return (
    <div
      ref={elementRef}
      className="drag-ghost"
      style={{ transform: `translate(${origin.x + 14}px, ${origin.y + 14}px)` }}
    >
      {labels.map((label) => (
        <span key={label} className="drag-ghost-label">
          {label}
        </span>
      ))}
    </div>
  );
}
