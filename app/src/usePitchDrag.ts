import { useRef, useState } from 'react';

/**
 * Dragging players around a pitch, shared by the game screen and game setup.
 *
 * Pointer events, so a finger on a phone and a mouse in a browser take exactly
 * the same path. The authoritative drag lives in a ref because the window
 * handlers read it synchronously; `ghost` exists only to re-render the avatar
 * following the pointer.
 */

export interface DropTarget {
  /** Slot the pointer was released over, or nearest within reach. */
  slotId: string | null;
  onBench: boolean;
}

/** Where a drag started: the bench, or the id of the slot the player was in. */
export type DragOrigin = 'bench' | string;

export interface PitchDrag {
  /** Attach to a token or bench shirt's `onPointerDown`. */
  startDrag: (
    playerId: string,
    from: DragOrigin,
    label: string,
  ) => (e: { clientX: number; clientY: number }) => void;
  ghost: { x: number; y: number; label: string } | null;
  /** Slot currently under the pointer, for highlighting. */
  dropSlotId: string | null;
  /**
   * True from the moment a gesture becomes a drag until just after it ends.
   * Tap handlers must check this: React dispatches on the element while
   * pointerup is still bubbling, so a flag set at drop time is set too late.
   */
  dragged: { current: boolean };
}

/** Slot nearest a screen point, so a drop need not be pixel-perfect. */
function slotNear(x: number, y: number): string | null {
  const direct = document.elementFromPoint(x, y)?.closest('[data-slot]');
  if (direct) return direct.getAttribute('data-slot');
  let best: { id: string; d: number } | null = null;
  for (const el of document.querySelectorAll('[data-slot]')) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (!best || d < best.d) best = { id: el.getAttribute('data-slot') ?? '', d };
  }
  return best && best.d < 90 ? best.id : null;
}

const overBench = (x: number, y: number): boolean =>
  !!document.elementFromPoint(x, y)?.closest('[data-bench]');

export function usePitchDrag(
  onDrop: (from: DragOrigin, playerId: string, target: DropTarget) => void,
): PitchDrag {
  const dragRef = useRef<{ playerId: string; from: DragOrigin; active: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [dropSlotId, setDropSlotId] = useState<string | null>(null);
  const dragged = useRef(false);

  const startDrag =
    (playerId: string, from: DragOrigin, label: string) =>
    (e: { clientX: number; clientY: number }) => {
      const startX = e.clientX;
      const startY = e.clientY;
      dragRef.current = { playerId, from, active: false };

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        // A few pixels of slop so a tap is still a tap.
        if (!d.active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
        d.active = true;
        dragged.current = true;
        setGhost({ x: ev.clientX, y: ev.clientY, label });
        setDropSlotId(overBench(ev.clientX, ev.clientY) ? null : slotNear(ev.clientX, ev.clientY));
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        const d = dragRef.current;
        dragRef.current = null;
        setGhost(null);
        setDropSlotId(null);
        // Release the tap suppression only once this event has finished
        // bubbling, so the click that follows pointerup is still swallowed.
        setTimeout(() => {
          dragged.current = false;
        }, 0);
        if (!d?.active) return; // never moved: leave it to the tap handler
        const bench = overBench(ev.clientX, ev.clientY);
        onDrop(d.from, d.playerId, {
          slotId: bench ? null : slotNear(ev.clientX, ev.clientY),
          onBench: bench,
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

  return { startDrag, ghost, dropSlotId, dragged };
}
