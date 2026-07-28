import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Pitch markings, drawn in metres.
 *
 * The viewBox is 68 wide (a real pitch) by however many metres tall the element
 * currently *is* at that scale, so one unit is the same number of pixels in both
 * axes and `preserveAspectRatio="none"` cannot distort anything. A fixed viewBox
 * turned the centre circle into an ellipse the moment the pitch stopped matching
 * its assumed shape — which, once the pitch sized itself to the screen, was
 * always.
 */
export function PitchMarkings({ height }: { height: number }) {
  const H = Math.max(50, height);
  const mid = H / 2;

  // Real dimensions, clamped so the two boxes cannot meet on a short pitch.
  const boxDepth = Math.min(16.5, H * 0.19);
  const sixDepth = Math.min(5.5, boxDepth * 0.34);
  const spot = Math.min(11, boxDepth * 0.67);
  const r = Math.min(9.15, H * 0.11);

  // Where the D meets the top of the penalty area, if it reaches at all.
  const dy = spot - boxDepth;
  const dx = r * r > dy * dy ? Math.sqrt(r * r - dy * dy) : 0;

  return (
    <svg
      className="pitch-lines"
      viewBox={`0 0 68 ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect x="0.5" y="0.5" width="67" height={H - 1} />
      <line x1="0.5" y1={mid} x2="67.5" y2={mid} />
      <circle cx="34" cy={mid} r={r} />
      <circle cx="34" cy={mid} r="0.6" className="fill" />

      {/* Our end (bottom): penalty area, six-yard box, spot, and the D. */}
      <rect x="13.85" y={H - boxDepth} width="40.3" height={boxDepth - 0.5} />
      <rect x="24.85" y={H - sixDepth} width="18.3" height={sixDepth - 0.5} />
      <circle cx="34" cy={H - spot} r="0.6" className="fill" />
      {dx > 0 && (
        <path d={`M ${34 - dx} ${H - boxDepth} A ${r} ${r} 0 0 1 ${34 + dx} ${H - boxDepth}`} />
      )}

      {/* Their end (top). */}
      <rect x="13.85" y="0.5" width="40.3" height={boxDepth - 0.5} />
      <rect x="24.85" y="0.5" width="18.3" height={sixDepth - 0.5} />
      <circle cx="34" cy={spot} r="0.6" className="fill" />
      {dx > 0 && <path d={`M ${34 - dx} ${boxDepth} A ${r} ${r} 0 0 0 ${34 + dx} ${boxDepth}`} />}

      {/* Corner arcs. */}
      <path d="M 0.5 2 A 1.5 1.5 0 0 0 2 0.5" />
      <path d="M 66 0.5 A 1.5 1.5 0 0 0 67.5 2" />
      <path d={`M 67.5 ${H - 2} A 1.5 1.5 0 0 0 66 ${H - 0.5}`} />
      <path d={`M 2 ${H - 0.5} A 1.5 1.5 0 0 0 0.5 ${H - 2}`} />
    </svg>
  );
}

export function Pitch({
  formation,
  occupants,
  selected,
  onSlotTap,
  onSlotMove,
  onTokenPointerDown,
  dropSlotId,
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
  /** Supply to let a *player* be dragged off their position (live game). */
  onTokenPointerDown?: (slot: Slot, occupant: Occupant | undefined, e: ReactPointerEvent) => void;
  /** Slot currently under a drag, highlighted as the drop target. */
  dropSlotId?: string | null;
  compact?: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Height of the pitch in "metres" at 68m wide — feeds the viewBox so markings
  // stay true whatever shape the screen leaves for the pitch.
  const [vbHeight, setVbHeight] = useState(88);
  // A drag must not also fire a tap; track whether the pointer actually moved.
  const moved = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      if (box.width > 0) setVbHeight((68 * box.height) / box.width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const positionFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(0.93, Math.max(0.07, (e.clientX - box.left) / box.width)),
      // Tighter at the bottom: the name and time render below the shirt.
      y: Math.min(0.89, Math.max(0.06, (e.clientY - box.top) / box.height)),
    };
  }, []);

  const onPointerDown =
    (slot: Slot, occupant: Occupant | undefined) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      // Editor mode drags the position itself; live mode drags the player in it.
      if (onSlotMove) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(slot.id);
        moved.current = false;
        return;
      }
      if (occupant) onTokenPointerDown?.(slot, occupant, e);
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
      <PitchMarkings height={vbHeight} />
      {formation.slots.map((slot) => {
        const occupant = occupants.get(slot.id);
        const isSelected = occupant ? selected?.has(occupant.playerId) : false;
        return (
          <button
            key={slot.id}
            type="button"
            data-slot={slot.id}
            className={`token${occupant ? '' : ' vacant'}${isSelected ? ' picked' : ''}${
              dragging === slot.id ? ' dragging' : ''
            }${dropSlotId === slot.id ? ' drop' : ''}`}
            style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%` }}
            onPointerDown={onPointerDown(slot, occupant)}
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
              {occupant ? occupant.number || occupant.name.slice(0, 2) : '+'}
            </span>
            {occupant ? (
              <span className="tname">{occupant.name}</span>
            ) : (
              // Empty slot reads as a team sheet entry: "ST · F".
              <span className="tname vacantlabel">
                {slot.code} · {slot.role}
              </span>
            )}
            {/*
              No position label on an occupied shirt: the code is already the
              shirt's location on the pitch, and a third line of text is what
              made tokens collide on a small phone.
            */}
            {occupant && !compact && <span className="ttime">{mmss(occupant.playedMs)}</span>}
          </button>
        );
      })}
      {children}
    </div>
  );
}
