import { formatClock } from '@touchline/core';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Screen({
  title,
  subtitle,
  onBack,
  action,
  children,
  footer,
  fill,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Lock the body to the viewport and let the content size itself to the space
   * between header and footer, instead of scrolling. Used by the game screen,
   * where scrolling to find a player mid-match is unacceptable.
   */
  fill?: boolean;
}) {
  return (
    <div className="app">
      <header className="top">
        {onBack && (
          <button className="back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <h1>
          {title}
          {subtitle && <span className="sub">{subtitle}</span>}
        </h1>
        {action}
      </header>
      <main className={fill ? 'fill' : undefined}>{children}</main>
      {footer}
    </div>
  );
}

/*
 * Sheets are counted rather than flagged. Swapping one sheet for another —
 * picking a scorer from a goal sheet, say — mounts the new one before the old
 * one unmounts, and a boolean would be cleared by the departing sheet and leave
 * the page marked closed while a sheet is still up.
 */
let openSheets = 0;

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes, and the page behind must not scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    openSheets += 1;
    document.body.classList.add('sheet-open');
    return () => {
      openSheets -= 1;
      if (openSheets === 0) document.body.classList.remove('sheet-open');
    };
  }, []);

  /*
   * Rendered into <body>, not into the screen that opened it.
   *
   * The header and the footer action bar are blurred (`backdrop-filter`), and
   * WebKit promotes a blurred element to its own compositing layer that can
   * paint above content with a higher z-index. A sheet nested inside <main>,
   * between those two bars, lost to them on iOS: the Delete game button sat
   * underneath Copy summary and Export CSV and could not be tapped, while
   * Chromium sorted the same markup correctly and showed nothing wrong.
   *
   * A portal makes the sheet a sibling of the app shell rather than a
   * descendant of a scroll container between two composited bars. `.sheet-open`
   * on the body then takes those bars out of the running entirely — belt and
   * braces, and invisible either way, since a bottom-anchored full-width sheet
   * covers that strip regardless.
   */
  return createPortal(
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const mmss = (ms: number): string => formatClock(Math.max(0, ms));

/**
 * Short label for a period: 1H/2H for halves, Q1..Q4 for quarters, else P1..
 *
 * The clock reads per-period and this sits beside it. That pairing is what
 * makes the reading unambiguous without inventing a running total from
 * configured period lengths that a real game rarely honours.
 */
export const periodTag = (periods: number, period: number): string => {
  if (period < 1) return 'Pre';
  if (periods === 2) return `${period}H`;
  if (periods === 4) return `Q${period}`;
  return `P${period}`;
};

/** Whole minutes, for tables where seconds are noise. */
export const mins = (ms: number): number => Math.round(ms / 60_000);

/**
 * First and last initial — the shirt-circle label for a player with no
 * jersey number set. `name.slice(0, 2)` was there before, and for anyone
 * whose name doesn't start with their first name's only two letters ("Leo
 * Selby" → "Le") it read as arbitrary rather than as the player. Splitting on
 * whitespace and taking the outer two initials ("LS") reads as the person
 * instead, and a single-word name still falls back to its first two letters.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * A period-length field held as text while it's being typed, clamped on commit.
 *
 * Clamping on every keystroke — `Math.max(1, Number(value))` in an `onChange`
 * — turns a momentarily empty field into `1`: clearing "30" to type "25" leaves
 * "1", then "1" + "2" + "5" reads "125" before the coach has finished typing.
 * Below one minute is nonsense for a half, so it still floors at one, just not
 * mid-keystroke.
 */
export const minutesOf = (raw: string): number => Math.max(1, Math.round(Number(raw)) || 1);

/**
 * Colour for a player's fairness deficit: warm when they are owed time, cool
 * when they have had more than their share. The point is that a coach can scan
 * the list without reading a single number.
 */
export function heatColor(deficitMs: number): string {
  const d = deficitMs / (10 * 60_000); // saturate at ten minutes either way
  if (d > 0.08) return `hsl(${Math.round(42 - 42 * Math.min(d, 1))} 88% 55%)`;
  if (d < -0.08) return 'hsl(162 45% 38%)';
  return 'var(--line)';
}

export function PlayerRow({
  name,
  number,
  position,
  playedMs,
  deficitMs,
  picked,
  onClick,
  onPositionClick,
  right,
}: {
  name: string;
  number: string;
  position?: string;
  playedMs: number;
  deficitMs?: number;
  picked?: boolean;
  onClick?: () => void;
  onPositionClick?: () => void;
  right?: ReactNode;
}) {
  /*
   * The deficit is a *projection* — where this player lands at full time if
   * nothing changes — not a statement about right now. Labelling it "6:00 over"
   * at kickoff, before anyone has played a second, reads as a description of the
   * present and is baffling. "ends 6:00 over" says what it actually means.
   */
  const projection =
    deficitMs === undefined
      ? null
      : Math.abs(deficitMs) < 30_000
        ? 'on track'
        : deficitMs > 0
          ? `ends ${mmss(deficitMs)} short`
          : `ends ${mmss(-deficitMs)} over`;

  return (
    <button
      className={`prow${position ? ' on' : ''}${picked ? ' picked' : ''}`}
      onClick={onClick}
      type="button"
    >
      {deficitMs !== undefined && (
        <span className="heat" style={{ background: heatColor(deficitMs) }} />
      )}
      <span className="num-badge">{number || '–'}</span>
      <span className="grow">
        <span className="name">{name}</span>
        {projection && (
          <span className="small muted" style={{ display: 'block' }}>
            {projection}
          </span>
        )}
      </span>
      {position &&
        (onPositionClick ? (
          <span
            className="pos"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onPositionClick();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onPositionClick();
              }
            }}
          >
            {position}
          </span>
        ) : (
          <span className="pos">{position}</span>
        ))}
      {!position && <span className="pos bench">BENCH</span>}
      <span className="mins">
        <b>{mmss(playedMs)}</b>
      </span>
      {right}
    </button>
  );
}

/**
 * A short line confirming what just happened, in the band above the action bar.
 *
 * The coach is looking at the field, not the phone, at exactly the moment they
 * make a sub — the interaction is tap, tap, tap, look up. Without this the only
 * evidence a sub registered is two tokens changing places in two different
 * regions of the screen, so a mis-tap fails silently and is discovered later, in
 * the playing-time numbers, when it is expensive to fix.
 *
 * The live region is always mounted, empty or not: a region added to the DOM at
 * the same moment as its text is not reliably announced.
 */
export function useToast(): { notify: (text: string) => void; toast: ReactNode } {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMsg({ text, key: Date.now() });
    timer.current = window.setTimeout(() => setMsg(null), 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toast = (
    <div className="toastwrap" role="status" aria-live="polite">
      {msg && (
        <span className="toast" key={msg.key}>
          {msg.text}
        </span>
      )}
    </div>
  );
  return { notify, toast };
}

/**
 * Press and hold to fire. For actions with a real cost and no undo.
 *
 * A native `confirm()` is a poor guard on a touchline: its default button is the
 * dangerous one, and it is dismissed by the same reflexive tap that opened it. A
 * hold cannot be produced by a mis-tap at all, and the fill shows the commitment
 * building, so letting go early is an obvious escape.
 */
export function HoldButton({
  onHold,
  disabled,
  className = '',
  holdMs = 700,
  children,
  ...rest
}: {
  onHold: () => void;
  disabled?: boolean;
  className?: string;
  holdMs?: number;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const stop = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      {...rest}
      type="button"
      className={`hold${holding ? ' holding' : ''} ${className}`}
      style={{ '--hold-ms': `${holdMs}ms` } as CSSProperties}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setHolding(true);
        const downX = e.clientX;
        const downY = e.clientY;
        timer.current = window.setTimeout(() => {
          stop();
          /*
           * onHold fires while the finger is still physically down — that is
           * what "hold" means — and it typically unmounts this button (the
           * caller closes a sheet, the screen changes). Pointer capture does
           * not survive the captured element leaving the DOM, so the eventual
           * lift-off is delivered fresh, by normal hit-testing, to whatever is
           * now on screen at that same point. Observed for real: ending a
           * half from this button in a sheet let the release land on a player
           * token on the pitch underneath and silently selected them.
           *
           * A capture-phase listener for the next release swallows exactly
           * that stray event — the same "the gesture is not over yet" guard
           * this codebase already uses for drag-vs-tap collisions, generalised
           * to survive the target disappearing mid-gesture. It is scoped to
           * the original touch point, not "the next release anywhere": a coach
           * who immediately taps a *different* control — Start, right after
           * Hold to end — means that tap, and an unscoped swallow ate it.
           */
          const NEAR = 16;
          const near = (ev: PointerEvent | MouseEvent) =>
            Math.hypot(ev.clientX - downX, ev.clientY - downY) < NEAR;
          const swallow = (ev: Event) => {
            if (!near(ev as PointerEvent)) return;
            ev.stopPropagation();
            ev.preventDefault();
            cleanup();
          };
          const cleanup = () => {
            window.removeEventListener('pointerup', swallow, { capture: true });
            window.removeEventListener('click', swallow, { capture: true });
          };
          window.addEventListener('pointerup', swallow, { capture: true });
          window.addEventListener('click', swallow, { capture: true });
          window.setTimeout(cleanup, 2000);
          onHold();
        }, holdMs);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      /* Keyboard users get a plain activation; a hold is a pointer affordance. */
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!disabled) onHold();
        }
      }}
    >
      {children}
    </button>
  );
}

/** Short WebAudio blip: the shift alarm, and the confirmation of an action. */
let audioCtx: AudioContext | null = null;

export function beep(times = 1, freq = 880): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    // iOS suspends the context until a user gesture resumes it; period start
    // and every sub are taps, so by the time an alarm fires it is running.
    void audioCtx.resume();
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = audioCtx.currentTime + i * 0.22;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    }
  } catch {
    // Audio is a convenience; never let it break the game screen.
  }
}

/**
 * "That registered" — a lower, single blip, deliberately unlike the two-note
 * shift alarm so the two are not confused while looking at the field.
 *
 * `navigator.vibrate` is not implemented in iOS Safari, so on the phone this
 * app is built for the haptic silently does nothing and the blip is the signal
 * that actually lands. It costs nothing to fire for the platforms that do.
 */
export function confirmCue(): void {
  beep(1, 620);
  try {
    navigator.vibrate?.(18);
  } catch {
    // Vibration is gated by user-activation rules on some platforms.
  }
}
