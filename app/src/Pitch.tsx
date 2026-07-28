import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { heatColor, mmss } from './components';
import type { Formation, Slot } from './formations';

/**
 * The field view: a vertical pitch with a token at each position slot.
 *
 * Vertical rather than landscape because the phone is held in one hand in
 * portrait, and because it lets the bench sit directly underneath where a thumb
 * reaches. You defend the bottom and attack upward.
 */

export interface Occupant {
  playerId: string;
  name: string;
  number: string;
  playedMs: number;
  deficitMs?: number;
}

export function PitchMarkings() {
  // Drawn as one SVG under the tokens. Stroke-only, low contrast: the pitch is
  // orientation, not decoration, and must never compete with the shirts.
  return (
    <svg className="pitch-lines" viewBox="0 0 68 100" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1" y="1" width="66" height="98" rx="1" />
      <line x1="1" y1="50" x2="67" y2="50" />
      <circle cx="34" cy="50" r="9" />
      <circle cx="34" cy="50" r="0.7" className="fill" />
      {/* Own penalty area and six-yard box (bottom). */}
      <rect x="14" y="83" width="40" height="16" />
      <rect x="25" y="93" width="18" height="6" />
      {/* Opponent's (top). */}
      <rect x="14" y="1" width="40" height="16" />
      <rect x="25" y="1" width="18" height="6" />
    </svg>
  );
}

export function Pitch({
  formation,
  occupants,
  selected,
  onSlotTap,
  onSlotMove,
  compact,
  children,
}: {
  formation: Formation;
  /** Slot id → who is standing there. Missing means an empty slot. */
  occupants: Map<string, Occupant>;
  selected?: Set<string>;
  onSlotTap?: (slot: Slot, occupant: Occupant | undefined) => void;
  /** Supply to make slots draggable — this is what turns it into an editor. */
  onSlotMove?: (slotId: string, x: number, y: number) => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A drag must not also fire a tap; track whether the pointer actually moved.
  const moved = useRef(false);

  const positionFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(0.93, Math.max(0.07, (e.clientX - box.left) / box.width)),
      // Tighter at the bottom: the name and time render below the shirt.
      y: Math.min(0.89, Math.max(0.06, (e.clientY - box.top) / box.height)),
    };
  }, []);

  const onPointerDown = (slot: Slot) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onSlotMove) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(slot.id);
    moved.current = false;
  };

  const onPointerMove = (slot: Slot) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onSlotMove || dragging !== slot.id) return;
    const at = positionFromEvent(e);
    if (!at) return;
    moved.current = true;
    onSlotMove(slot.id, at.x, at.y);
  };

  const onPointerUp = (slot: Slot, occupant: Occupant | undefined) => () => {
    if (dragging === slot.id) {
      setDragging(null);
      if (moved.current) return; // it was a drag, not a tap
    }
    onSlotTap?.(slot, occupant);
  };

  return (
    <div className={`pitch${compact ? ' compact' : ''}`} ref={ref}>
      <PitchMarkings />
      {formation.slots.map((slot) => {
        const occupant = occupants.get(slot.id);
        const isSelected = occupant ? selected?.has(occupant.playerId) : false;
        return (
          <button
            key={slot.id}
            type="button"
            className={`token${occupant ? '' : ' vacant'}${isSelected ? ' picked' : ''}${
              dragging === slot.id ? ' dragging' : ''
            }`}
            style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%` }}
            onPointerDown={onPointerDown(slot)}
            onPointerMove={onPointerMove(slot)}
            onPointerUp={onPointerUp(slot, occupant)}
            aria-label={
              occupant ? `${occupant.name}, ${slot.code}` : `${slot.code}, empty`
            }
          >
            <span
              className="shirt"
              style={
                occupant?.deficitMs !== undefined
                  ? { borderColor: heatColor(occupant.deficitMs) }
                  : undefined
              }
            >
              {occupant ? occupant.number || occupant.name.slice(0, 2) : slot.code}
            </span>
            {occupant ? (
              <span className="tname">{occupant.name}</span>
            ) : (
              <span className="tname muted">empty</span>
            )}
            {occupant && !compact && <span className="ttime">{mmss(occupant.playedMs)}</span>}
            {!occupant || compact ? null : <span className="tcode">{slot.code}</span>}
          </button>
        );
      })}
      {children}
    </div>
  );
}
