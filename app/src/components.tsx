import { formatClock } from '@subtime/core';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

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

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes, and the body must not scroll behind the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
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
    </div>
  );
}

export const mmss = (ms: number): string => formatClock(Math.max(0, ms));

/** Whole minutes, for tables where seconds are noise. */
export const mins = (ms: number): number => Math.round(ms / 60_000);

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

/** Short WebAudio blip for the shift alarm. */
let audioCtx: AudioContext | null = null;

export function beep(times = 1): void {
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
      osc.frequency.value = 880;
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
